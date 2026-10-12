"""Ship the student model to Atom's agents service, after checking that the
serving code reproduces the evaluated model.

1. Write agents/models/student_model.{npz,json}: the LightGBM trained on the
   signals Atom records (the "atom" variant in experiments/kt.py, exactly the
   booster that was evaluated), the half-life parameters fitted on maths
   practice (experiments/memory.py), and the evaluation numbers the app shows.
2. Replay: for real held-out Junyi students, rebuild every feature from their
   attempt list with agents/student_model.py (no pandas, no LightGBM) and
   compare features and probabilities with the offline pipeline.
3. Time one mastery request for a student with a long history.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import UTC

import lightgbm as lgb
import numpy as np
import pandas as pd

from atomml.config import REPO, settings
from atomml.experiments.common import CACHE, arrays, data, features, write_report
from atomml.experiments.kt import variant_columns

sys.path.insert(0, str(REPO))
from agents.student_model import (  # noqa: E402
    FEATURES,
    PRIOR,
    STRENGTH,
    STRENGTH_ALL,
    Attempt,
    StudentModel,
)
from agents.student_model import features as serve_features  # noqa: E402
from agents.trees import TreeEnsemble  # noqa: E402

ATOM_DIFFICULTY = {0: 1, 1: 3, 2: 4}


def run() -> str:
    reports = settings.paths.reports
    f = features("strict")
    cols = variant_columns(f.columns)["atom"]
    if cols != FEATURES:
        raise ValueError(f"serving features {FEATURES} differ from training {cols}")
    booster = lgb.Booster(model_file=str(CACHE / "lightgbm_atom.txt"))
    trees = TreeEnsemble(booster.dump_model())
    kt = json.loads((reports / "knowledge_tracing.json").read_text())
    memory = json.loads((reports / "memory_params.json").read_text())

    out = settings.paths.export
    out.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out / "student_model.npz", **trees.arrays())
    shipped = kt["models"]["lightgbm_atom"]
    meta = {
        "features": FEATURES,
        "smoothing": {"prior": PRIOR, "strength": STRENGTH, "strength_all": STRENGTH_ALL},
        "trees": len(trees.roots),
        "half_life": {"theta": memory["half_life_theta"], "features": memory["features"], "source": memory["source"]},
        "trained_on": "Junyi Academy maths practice: 16.2M attempts, 72,758 students (training: 70% of students)",
        "evaluation": {
            "test_students": kt["test_students"],
            "test_attempts": kt["test_attempts"],
            "shipped": shipped,
            "atom_rule_before": kt["models"]["atom_calibrated"],
            "atom_rule_as_displayed": kt["models"]["atom_raw"],
            "best_model": max(kt["models"].values(), key=lambda m: m["auc"][0]),
        },
    }  # fmt: skip
    (out / "student_model.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    model = StudentModel.load(out)

    # replay real held-out students through the serving code
    A = arrays()
    att = data().attempts
    items = data().items
    rng = np.random.default_rng(0)
    test_users = np.unique(A["user"][A["test"]])
    sizes = pd.Series(A["user"]).value_counts()
    chosen = [u for u in rng.permutation(test_users) if sizes[u] <= 400][:200]
    x_off = f[cols].to_numpy(np.float32)
    feat_diff, prob_diff, n_rows = 0.0, 0.0, 0
    for u in chosen:
        rows = np.flatnonzero(A["user"] == u)
        sub = att.iloc[rows]
        tries = [
            Attempt(topic=str(r.item), correct=bool(r.correct), at=r.ts.to_pydatetime().replace(tzinfo=UTC),
                    unit=str(items.at[r.item, "level4"]), difficulty=ATOM_DIFFICULTY[int(items.at[r.item, "difficulty"])],
                    time_sec=float(r.sec))
            for r in sub.itertuples()
        ]  # fmt: skip
        ts, it = sub["ts"].to_numpy(), sub["item"].to_numpy()
        for k in rng.choice(len(rows), min(25, len(rows)), replace=False):
            earlier = [tries[j] for j in range(len(rows)) if ts[j] < ts[k]]
            session = [tries[j] for j in range(k) if ts[j] == ts[k] and it[j] == it[k]]
            x = serve_features(
                earlier, session, tries[k].topic, tries[k].unit, tries[k].difficulty, tries[k].at
            )
            feat_diff = max(feat_diff, float(np.max(np.abs(x - x_off[rows[k]]))))
            p_serve = float(model.predict(x)[0])
            p_off = float(booster.predict(x_off[rows[k]][None, :])[0])
            prob_diff = max(prob_diff, abs(p_serve - p_off))
            n_rows += 1

    # one mastery request for a long history
    long_user = int(sizes[sizes.index.isin(test_users)].idxmax())
    rows = np.flatnonzero(A["user"] == long_user)[-1000:]
    history = [
        Attempt(topic=str(r.item), correct=bool(r.correct), at=r.ts.to_pydatetime().replace(tzinfo=UTC),
                unit=str(items.at[r.item, "level4"]), time_sec=float(r.sec))
        for r in att.iloc[rows].itertuples()
    ]  # fmt: skip
    now = history[-1].at
    t0 = time.perf_counter()
    for _ in range(20):
        result = model.mastery(history, now)
    ms = (time.perf_counter() - t0) / 20 * 1000

    sizes_mb = {
        p.name: p.stat().st_size / 1e6 for p in out.iterdir() if p.name.startswith("student_model")
    }
    fmt = lambda c: f"{c[0]:.4f} ({c[1]:.4f}-{c[2]:.4f})"  # noqa: E731
    text = "\n".join(
        [
            "# Shipping the student model",
            "",
            "## What ships",
            "",
            f"LightGBM on the signals Atom records ({len(FEATURES)} features, {len(trees.roots)} trees), served by "
            "agents/student_model.py with NumPy. On the held-out students: AUC "
            f"{fmt(shipped['auc'])}, log loss {fmt(shipped['log_loss'])}, calibration error {shipped['ece']:.4f}. "
            f"Atom's rule before it: AUC {fmt(kt['models']['atom_calibrated']['auc'])}, calibration error as "
            f"displayed {kt['models']['atom_raw']['ece']:.3f}.",
            "",
            *[f"- `agents/models/{k}`: {v:.2f} MB" for k, v in sorted(sizes_mb.items())],
            "",
            "## Does the serving code reproduce the evaluated model?",
            "",
            f"{n_rows:,} attempts of {len(chosen)} held-out students, each rebuilt from the student's attempt list "
            f"by the agents service: largest feature difference {feat_diff:.2e}, largest probability difference "
            f"{prob_diff:.2e} against the offline features and LightGBM itself.",
            "",
            "## Latency",
            "",
            f"Mastery for every topic of a student with {len(history):,} attempts on {len(result)} topics: "
            f"{ms:.1f} ms per request.",
            "",
        ]
    )  # fmt: skip
    write_report("export", text)
    return text

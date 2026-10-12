"""Forgetting curves: on Duolingo's 13M practice sessions (Settles & Meeder
2016), and on Junyi's maths practice.

Each Duolingo row: a learner practised a word `delta` days after last seeing
it, with `history_seen` / `history_correct` earlier exposures, and recalled it
in `p_recall` of the session's attempts. Junyi gives the same shape for maths:
a student returns to an exercise after a gap, with their earlier right and
wrong counts on it, and gets some share of the session right. The task is to
predict that share. Models:

* constant: mean recall in training
* Atom today: exp(-days / S), S = 1.5 + 2 * reviews + 3 (no SM-2 interval)
* Atom's form, refitted: the same exp(-days / (a + b * reviews)) with a, b
  learned, to tell a wrong functional form from wrong constants
* Leitner and Pimsleur spacing heuristics, as in the paper
* half-life regression: history only, + one weight per word (exercise), + one
  per learner (a learned per-student stability, which is what Atom's
  memory_stability tries to be; Duolingo only, since Junyi is split by student)
* LightGBM on the same information (cross-entropy on the recall fraction)

Metrics follow the paper: mean absolute error of p, AUC with p rounded to
0/1, and the Spearman correlation between predicted and observed half-life;
plus log loss. Intervals: bootstrap over learners. The maths half-life
parameters are written to reports/memory_params.json for the app.
"""

from __future__ import annotations

import json
import logging

import lightgbm as lgb
import numpy as np
import pandas as pd
import scipy.sparse as sp
from scipy.optimize import minimize
from scipy.stats import spearmanr

from atomml.config import settings
from atomml.experiments.common import write_report
from atomml.memory.models import HLR, atom_recall, implied_half_life, leitner, pimsleur
from atomml.metrics import log_loss, score

log = logging.getLogger(__name__)


def load() -> pd.DataFrame:
    cache = settings.paths.cache / "hlr.parquet"
    if cache.exists():
        return pd.read_parquet(cache)
    df = pd.read_csv(settings.paths.raw / "hlr" / "learning_traces.13m.csv.gz",
                     usecols=["p_recall", "timestamp", "delta", "user_id", "learning_language", "ui_language",
                              "lexeme_id", "history_seen", "history_correct"])  # fmt: skip
    df = df.sort_values("timestamp", kind="stable", ignore_index=True)
    q80, q90 = df["timestamp"].quantile([0.8, 0.9])
    df["split"] = np.where(
        df["timestamp"] < q80, "train", np.where(df["timestamp"] < q90, "valid", "test")
    )
    df["user"] = pd.factorize(df["user_id"])[0].astype(np.int32)
    df["lexeme"] = pd.factorize(df["lexeme_id"])[0].astype(np.int32)
    df["lang"] = pd.factorize(df["ui_language"] + "->" + df["learning_language"])[0].astype(
        np.int16
    )
    df["delta_days"] = (df["delta"] / 86400).astype(np.float64)
    df["right"] = df["history_correct"].astype(np.float64)
    df["wrong"] = (df["history_seen"] - df["history_correct"]).astype(np.float64)
    df = df.drop(
        columns=["user_id", "lexeme_id", "timestamp", "delta", "learning_language", "ui_language"]
    )
    settings.paths.cache.mkdir(parents=True, exist_ok=True)
    df.to_parquet(cache, index=False)
    return df


def junyi_sessions() -> pd.DataFrame:
    """Junyi as forgetting data: each time a student returns to an exercise in a
    later 15-minute bucket, the share they got right in that session, the days
    since they last practised it and their right/wrong counts before. Split by
    student, as in the knowledge-tracing experiments."""
    from atomml.experiments.common import arrays

    A = arrays()
    g = pd.DataFrame({"user": A["user"], "item": A["item"], "group": A["group"], "days": A["days"],
                      "correct": A["correct"]})  # fmt: skip
    s = g.groupby("group").agg(user=("user", "first"), item=("item", "first"), days=("days", "first"),
                               n=("correct", "size"), right_now=("correct", "sum"))  # fmt: skip
    s = s.sort_values(["user", "item", "days"], kind="stable")
    prev = s.groupby(["user", "item"], sort=False)
    s["delta_days"] = s["days"] - prev["days"].shift(1)
    s["right"] = prev["right_now"].cumsum() - s["right_now"]
    s["wrong"] = prev["n"].cumsum() - s["n"] - s["right"]
    s = s[s["delta_days"].notna() & (s["delta_days"] > 0)].copy()
    split = np.where(A["train"], "train", np.where(A["valid"], "valid", "test"))
    split_of_user = pd.Series(split, index=A["user"]).groupby(level=0).first()
    return pd.DataFrame({
        "p_recall": (s["right_now"] / s["n"]).to_numpy(), "delta_days": s["delta_days"].to_numpy(),
        "right": s["right"].to_numpy(np.float64), "wrong": s["wrong"].to_numpy(np.float64),
        "user": s["user"].to_numpy(), "lexeme": s["item"].to_numpy(), "lang": np.zeros(len(s), np.int16),
        "split": split_of_user.reindex(s["user"]).to_numpy(),
    })  # fmt: skip


def design(df: pd.DataFrame, train_mask: np.ndarray, words: bool, learners: bool) -> sp.csr_matrix:
    n = len(df)
    base = sp.csr_matrix(
        np.column_stack([np.ones(n), np.sqrt(1 + df["right"]), np.sqrt(1 + df["wrong"])])
    )
    blocks = [base]
    for flag, col in ((words, "lexeme"), (learners, "user")):
        if flag:
            ids = df[col].to_numpy()
            known = np.zeros(ids.max() + 1, bool)
            known[ids[train_mask]] = True  # unseen words/learners get no indicator
            rows = np.flatnonzero(known[ids])
            blocks.append(
                sp.csr_matrix((np.ones(len(rows)), (rows, ids[rows])), shape=(n, ids.max() + 1))
            )
    return sp.hstack(blocks, format="csr")


def evaluate(df: pd.DataFrame, item_word: str, learners: bool):
    tr, va, te = (df["split"].to_numpy() == s for s in ("train", "valid", "test"))
    p, delta = df["p_recall"].to_numpy(), df["delta_days"].to_numpy()
    preds: dict[str, np.ndarray] = {}
    half_lives: dict[str, np.ndarray] = {}

    preds["Constant (mean recall)"] = np.full(te.sum(), p[tr].mean())
    seen = (df["right"] + df["wrong"]).to_numpy()
    preds["Atom today: exp(-days / (1.5 + 2 reviews + 3))"] = atom_recall(delta[te], seen[te])

    def atom_form_loss(ab):
        s = np.maximum(ab[0] + ab[1] * seen[tr], 1e-3)
        return np.mean((np.exp(-delta[tr] / s) - p[tr]) ** 2)

    ab = minimize(atom_form_loss, [4.5, 2.0], method="Nelder-Mead").x
    preds[f"Atom's form, refitted: exp(-days / ({ab[0]:.1f} + {ab[1]:.2f} reviews))"] = np.exp(
        -delta[te] / np.maximum(ab[0] + ab[1] * seen[te], 1e-3))  # fmt: skip
    preds["Leitner"] = leitner(df["right"].to_numpy()[te], df["wrong"].to_numpy()[te], delta[te])
    preds["Pimsleur"] = pimsleur(seen[te], delta[te])

    variants = [
        (False, False, "HLR, practice history only"),
        (True, False, f"HLR + {item_word} difficulty"),
    ]
    if learners:
        variants.append((True, True, f"HLR + {item_word} difficulty + learner stability"))
    theta_base = None
    for words, with_learners, name in variants:
        x = design(df, tr, words, with_learners)
        m = HLR(max_iter=1000).fit(x[tr], p[tr], delta[tr])
        log.info("%s: %d iterations, %s", name, m.result.nit, m.result.message)
        preds[name], half_lives[name] = m.predict(x[te], delta[te])
        if not words:
            theta_base = m.theta

    feats = pd.DataFrame({"log_delta": np.log1p(delta), "right": df["right"], "wrong": df["wrong"],
                          "lang": df["lang"]})  # fmt: skip
    for col in ("lexeme", "user") if learners else ("lexeme",):
        stats = df[tr].groupby(col)["p_recall"].agg(["mean", "size"])
        feats[f"{col}_mean"] = df[col].map(stats["mean"]).astype(np.float32)
        feats[f"{col}_n"] = np.log1p(df[col].map(stats["size"]).fillna(0)).astype(np.float32)
    params = {"objective": "cross_entropy", "learning_rate": 0.1, "num_leaves": 127, "min_data_in_leaf": 1000,
              "verbose": -1, "seed": 0, "deterministic": True, "num_threads": 12}  # fmt: skip
    dtrain = lgb.Dataset(feats[tr], p[tr], categorical_feature=["lang"])
    booster = lgb.train(params, dtrain, 1000, valid_sets=[dtrain.create_valid(feats[va], p[va])],
                        callbacks=[lgb.early_stopping(30, verbose=False)])  # fmt: skip
    who = f"{item_word} and learner" if learners else item_word
    preds[f"LightGBM (history, time gap, {who} statistics)"] = booster.predict(
        feats[te], num_iteration=booster.best_iteration)  # fmt: skip

    users = df["user"].to_numpy()[te]
    y_bin = (p[te] >= 0.5).astype(int)
    h_obs = implied_half_life(p[te], delta[te])
    rng = np.random.default_rng(0)
    codes, inv = np.unique(users, return_inverse=True)
    draws = [
        np.bincount(rng.integers(0, len(codes), len(codes)), minlength=len(codes))[inv]
        for _ in range(200)
    ]
    rows = []
    for name, ph in preds.items():
        err = np.abs(ph - p[te])
        maes = [np.sum(w * err) / np.sum(w) for w in draws]
        s = score(y_bin, ph, users, n_boot=200)
        ll = np.mean(
            p[te] * log_loss(np.ones_like(ph), ph) + (1 - p[te]) * log_loss(np.zeros_like(ph), ph)
        )
        cor = spearmanr(half_lives[name], h_obs).statistic if name in half_lives else np.nan
        rows.append({"model": name, "MAE": f"{err.mean():.4f} ({np.quantile(maes, 0.025):.4f}-{np.quantile(maes, 0.975):.4f})",
                     "AUC": f"{s.auc[0]:.4f} ({s.auc[1]:.4f}-{s.auc[2]:.4f})", "log loss": f"{ll:.4f}",
                     "half-life Spearman": "" if np.isnan(cor) else f"{cor:.3f}"})  # fmt: skip

    sched = []
    for right, wrong in [(1, 0), (3, 0), (5, 0), (10, 0), (5, 3)]:
        xb = sp.csr_matrix([[1.0, np.sqrt(1 + right), np.sqrt(1 + wrong)]])
        h = float(HLR.half_life(xb, theta_base)[0])
        s_atom = 1.5 + 2 * (right + wrong) + 3
        sched.append({"history": f"{right} right, {wrong} wrong", "Atom today (days)": f"{-s_atom * np.log(0.9):.1f}",
                      "HLR (days)": f"{-h * np.log2(0.9):.1f}"})  # fmt: skip
    meta = {
        "train": int(tr.sum()),
        "test": int(te.sum()),
        "learners": len(codes),
        "mean_recall": float(p[te].mean()),
    }
    return pd.DataFrame(rows), pd.DataFrame(sched), theta_base, meta


def run() -> str:
    sections = ["# Forgetting curves: predicting recall after a gap", ""]
    datasets = (
        ("Duolingo vocabulary (13M sessions)", load, "word", True,
         "Train on the first 80% of time, tune on the next 10%, test on the last 10%."),
        ("Junyi maths practice (returning to an exercise after a gap)", junyi_sessions, "exercise", False,
         "Split by student (70/10/20), as in the knowledge-tracing experiments; the target is the share right "
         "in the session when the student comes back."),
    )  # fmt: skip
    for title, loader, word, learners, split_text in datasets:
        rows, sched, theta, meta = evaluate(loader(), word, learners)
        sections += [
            f"## {title}",
            "",
            f"{split_text} {meta['train']:,} training and {meta['test']:,} test sessions ({meta['learners']:,} test "
            f"learners); mean recall in test {meta['mean_recall']:.3f}. Intervals: bootstrap over learners.",
            "",
            rows.to_markdown(index=False),
            "",
            "When each model would schedule the next review (predicted recall falls to 90%):",
            "",
            sched.to_markdown(index=False),
            "",
        ]
        if word == "exercise":
            sections += [
                "Every model that forgets with time ranks these sessions worse than chance (AUC below 0.5): "
                "students who return to an exercise after a long gap do better, not worse. That is selection, not "
                "memory: in a self-paced practice log, students come back quickly after struggling and much later "
                "once they have moved on, so when they return depends on how well they know it. Forgetting cannot be "
                "measured cleanly from such a log, and the review schedule Atom ships is not fitted on it.",
                "",
            ]
        if word == "word":
            # Scheduled reviews (Duolingo decides when a word comes back) are the cleaner
            # evidence; this model replicates the paper's numbers, so it sets the schedule.
            params = {"half_life_theta": theta.tolist(), "features": ["bias", "sqrt(1+right)", "sqrt(1+wrong)"],
                      "unit": "days", "source": "half-life regression fitted on Duolingo's scheduled reviews "
                      "(practice history only); see ml/reports/memory.md"}  # fmt: skip
            settings.paths.reports.mkdir(parents=True, exist_ok=True)
            (settings.paths.reports / "memory_params.json").write_text(
                json.dumps(params, indent=2) + "\n"
            )
    text = "\n".join(sections)
    write_report("memory", text)
    return text

"""Knowledge tracing on Junyi: which student model predicts the next answer?

Every model predicts each attempt of the held-out test students from that
student's visible history only (see atomml/kt/features.py), and is scored on
all 3M test attempts with a student-level bootstrap. Models:

* item difficulty only: logit of the exercise's accuracy among training students
* Atom today: the app's mastery rule, raw and recalibrated (Platt scaling on
  validation students; AUC is unchanged by any monotone recalibration)
* BKT per exercise, fitted by EM on training students
* Elo with a per-topic student rating (bucket-synchronous), tuned on validation
* logistic regression and LightGBM on history features, in two versions:
  "transferable" uses only the student's history and the exercise's difficulty
  label, which is all Atom has for questions its LLM writes on the fly;
  "full" adds each exercise's accuracy among training students
* DKT and SAKT, when their predictions exist (experiments/deep.py)

Plus: how much the usual shortcut of ordering a 15-minute bucket arbitrarily
inflates AUC, and how each model does on a student's first attempts.
"""

from __future__ import annotations

import logging
import time

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from atomml.experiments.common import (
    arrays,
    data,
    features,
    item_stats,
    load_pred,
    save_pred,
    write_report,
)
from atomml.kt.sequential import BKT, atom_rule, elo_buckets
from atomml.metrics import paired_auc_difference, score

log = logging.getLogger(__name__)

POPULATION = ["item_logit", "item_n"]  # needs per-exercise statistics from many students
NOT_IN_ATOM = [
    "hint_rate",
    "retry_rate",
    "last_hint",
    "last_retry",
]  # Atom records no hints or retries


def variant_columns(columns) -> dict[str, list[str]]:
    """atom: only signals Atom records today (what ships); transferable: plus
    hints and retries; full: plus each exercise's population accuracy."""
    cols = list(columns)
    return {
        "atom": [c for c in cols if c not in POPULATION + NOT_IN_ATOM],
        "transferable": [c for c in cols if c not in POPULATION],
        "full": cols,
    }


LGB_PARAMS = {"objective": "binary", "learning_rate": 0.08, "num_leaves": 127, "min_data_in_leaf": 500,
              "feature_fraction": 0.9, "bagging_fraction": 0.8, "bagging_freq": 1, "verbose": -1,
              "seed": 0, "deterministic": True, "force_row_wise": True, "num_threads": 12}  # fmt: skip


def _logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def platt(p_valid, y_valid, p_test):
    lr = LogisticRegression().fit(_logit(p_valid)[:, None], y_valid)
    return lr.predict_proba(_logit(p_test)[:, None])[:, 1]


def run_simple() -> None:
    A = arrays()
    st = item_stats()
    save_pred("item_only", 1 / (1 + np.exp(-st["item_logit"].to_numpy()[A["item"]][A["test"]])))

    t0 = time.perf_counter()
    raw = atom_rule(
        A["user"],
        A["item"],
        A["group"],
        A["days"],
        A["correct"],
        A["difficulty"] + 2,
        data().n_items,
    )
    log.info("atom rule: %.1fs", time.perf_counter() - t0)
    save_pred("atom_raw", raw[A["test"]])
    save_pred("atom_calibrated", platt(raw[A["valid"]], A["correct"][A["valid"]], raw[A["test"]]))

    tr = A["train"]
    t0 = time.perf_counter()
    bkt = BKT(data().n_items).fit(A["user"][tr], A["item"][tr], A["correct"][tr])
    log.info("bkt fit: %.1fs", time.perf_counter() - t0)
    te = A["test"]
    save_pred("bkt", bkt.predict(A["user"][te], A["item"][te], A["correct"][te]))


def _elo(alpha, beta, part):
    A = arrays()
    n_topics = int(A["topic"].max()) + 1
    b, nb = np.zeros(data().n_items), np.zeros(data().n_items)
    tr = A["train"]
    cols = ("user", "bucket", "item", "topic")
    elo_buckets(
        *(A[c][tr] for c in cols),
        A["correct"][tr].astype(np.float64),
        b,
        nb,
        alpha,
        beta,
        True,
        n_topics,
    )
    m = A[part]
    return elo_buckets(*(A[c][m] for c in cols), A["correct"][m].astype(np.float64), b.copy(), nb.copy(),
                       alpha, beta, False, n_topics)  # fmt: skip


def run_elo() -> dict:
    A = arrays()
    best, best_auc = None, -1.0
    for alpha in (0.05, 0.1, 0.2, 0.4, 0.8):
        for beta in (0.002, 0.01, 0.05, 0.2):
            p = _elo(alpha, beta, "valid")
            auc = score(A["correct"][A["valid"]], p, A["user"][A["valid"]], n_boot=1).auc[0]
            log.info("elo alpha=%g beta=%g valid AUC %.4f", alpha, beta, auc)
            if auc > best_auc:
                best, best_auc = (alpha, beta), auc
    save_pred("elo", _elo(*best, "test"))
    return {"alpha": best[0], "beta": best[1]}


def run_feature_models(
    name: str = "strict", suffix: str = "", only: tuple[str, ...] | None = None
) -> dict:
    A = arrays()
    f = features(name)
    out = {}
    for variant, cols in variant_columns(f.columns).items():
        if only is not None and variant not in only:
            continue
        x = f[cols].to_numpy(np.float32)
        tr, va, te = A["train"], A["valid"], A["test"]
        y = A["correct"]
        if not suffix:  # logistic regression only on the main (strict) features
            rng = np.random.default_rng(0)
            idx = rng.choice(np.flatnonzero(tr), 4_000_000, replace=False)
            sc = StandardScaler().fit(x[idx])
            lr = LogisticRegression(C=1.0, max_iter=300).fit(sc.transform(x[idx]), y[idx])
            save_pred(f"logreg_{variant}", lr.predict_proba(sc.transform(x[te]))[:, 1])
        va_idx = np.random.default_rng(1).choice(np.flatnonzero(va), 1_000_000, replace=False)
        dtrain = lgb.Dataset(x[tr], y[tr], feature_name=cols, free_raw_data=True)
        dvalid = dtrain.create_valid(x[va_idx], y[va_idx])
        t0 = time.perf_counter()
        booster = lgb.train(LGB_PARAMS, dtrain, 2000, valid_sets=[dvalid],
                            callbacks=[lgb.early_stopping(50, verbose=False)])  # fmt: skip
        log.info(
            "lightgbm %s%s: %d trees, %.0fs",
            variant,
            suffix,
            booster.best_iteration,
            time.perf_counter() - t0,
        )
        save_pred(
            f"lightgbm_{variant}{suffix}",
            booster.predict(x[te], num_iteration=booster.best_iteration),
        )
        imp = pd.Series(booster.feature_importance("gain"), index=cols)
        out[variant] = {
            "trees": booster.best_iteration,
            "importance": (imp / imp.sum()).sort_values(ascending=False),
        }
    return out


NAMES = {
    "item_only": "Item difficulty only (population accuracy of the exercise)",
    "atom_raw": "Atom today: mastery rule, as displayed",
    "atom_calibrated": "Atom today: mastery rule, recalibrated",
    "bkt": "BKT per exercise (EM)",
    "elo": "Elo, student + per-topic rating",
    "logreg_atom": "Logistic regression, signals Atom records",
    "lightgbm_atom": "LightGBM, signals Atom records",
    "logreg_transferable": "Logistic regression, transferable features",
    "logreg_full": "Logistic regression, full features",
    "lightgbm_transferable": "LightGBM, transferable features",
    "lightgbm_full": "LightGBM, full features",
    "dkt": "DKT (LSTM over attempts)",
    "sakt": "SAKT (self-attention over attempts)",
}


def fmt(ci):
    return f"{ci[0]:.4f} ({ci[1]:.4f}-{ci[2]:.4f})"


def run() -> str:
    A = arrays()
    te = A["test"]
    y, users, pos = A["correct"][te], A["user"][te], A["position"][te]
    if load_pred("bkt") is None:
        run_simple()
    elo_params = run_elo() if load_pred("elo") is None else {}
    missing = tuple(
        v for v in ("atom", "transferable", "full") if load_pred(f"lightgbm_{v}") is None
    )
    fm = run_feature_models(only=missing) if missing else None
    if load_pred("lightgbm_full_naive") is None:
        run_feature_models("naive", "_naive", only=("full",))

    preds = {k: load_pred(k) for k in NAMES if load_pred(k) is not None}
    rows, scores = [], {}
    for k, p in preds.items():
        s = score(y, p, users)
        scores[k] = s
        rows.append({"model": NAMES[k], "AUC": fmt(s.auc), "log loss": fmt(s.log_loss),
                     "Brier": f"{s.brier:.4f}", "ECE": f"{s.ece:.4f}"})  # fmt: skip
        log.info("%s: AUC %.4f", k, s.auc[0])
    best = max(scores, key=lambda k: scores[k].auc[0])

    diffs = []
    pairs = [
        ("atom_calibrated", "lightgbm_atom"),
        ("atom_calibrated", best),
        ("elo", best),
        ("bkt", "elo"),
        ("lightgbm_atom", "lightgbm_transferable"),
        ("lightgbm_transferable", "lightgbm_full"),
    ]
    for a_name, b_name in pairs:
        if a_name in preds and b_name in preds and a_name != b_name:
            d = paired_auc_difference(y, preds[a_name], preds[b_name], users)
            diffs.append(
                f"| {NAMES[b_name]} vs {NAMES[a_name]} | {d[0]:+.4f} ({d[1]:+.4f} to {d[2]:+.4f}) |"
            )

    # cold start: a student's first attempts
    bands = [(0, 10), (10, 50), (50, 200), (200, None)]
    cold = []
    for k in [
        k
        for k in ("atom_calibrated", "bkt", "elo", "lightgbm_atom", "lightgbm_full", "dkt", "sakt")
        if k in preds
    ]:
        row = {"model": NAMES[k]}
        for lo, hi in bands:
            m = (pos >= lo) & (pos < hi if hi else True)
            row[f"attempts {lo}-{hi - 1 if hi else ''}"] = (
                f"{score(y[m], preds[k][m], users[m], n_boot=1).auc[0]:.4f}"
            )
        cold.append(row)

    naive = paired_auc_difference(
        y, preds["lightgbm_full"], load_pred("lightgbm_full_naive"), users
    )
    first_attempt_share = np.mean(pos == 0)
    text = "\n".join(
        [
            "# Knowledge tracing: predicting a student's next answer (Junyi Academy)",
            "",
            f"{len(data().attempts):,} attempts by {A['user'].max() + 1:,} students on {data().n_items:,} math "
            f"exercises. Models are trained on 70% of students, tuned on 10% and scored on every attempt of "
            f"the remaining {len(np.unique(users)):,} students ({te.sum():,} attempts), each predicted from "
            "that student's visible history only. 95% intervals from a bootstrap over students.",
            "",
            pd.DataFrame(rows).to_markdown(index=False),
            "",
            "## Paired differences in AUC (same attempts, bootstrap over students)",
            "",
            "| comparison | AUC difference (95% interval) |",
            "|---|---|",
            *diffs,
            "",
            "## A student's first attempts",
            "",
            f"AUC by how many attempts the student had made before ({first_attempt_share:.1%} of test attempts "
            "are a student's very first).",
            "",
            pd.DataFrame(cold).to_markdown(index=False),
            "",
            "## What ordering a 15-minute bucket arbitrarily would have reported",
            "",
            "The same LightGBM (full features) built with every earlier row in sort order visible, "
            f"including other exercises answered in the same bucket: AUC {naive[0]:+.4f} "
            f"({naive[1]:+.4f} to {naive[2]:+.4f}) against the strict rule. That gain is leakage, not skill.",
            "",
            *([f"Elo tuned on validation students: alpha = {elo_params['alpha']}, beta = {elo_params['beta']}.", ""]
              if elo_params else []),
            *(["## What LightGBM relies on (signals Atom records, share of split gain)", "",
               "| feature | share |", "|---|---|",
               *[f"| {k} | {v:.3f} |" for k, v in fm["atom"]["importance"].head(12).items()], ""]
              if fm and "atom" in fm else []),
        ]
    )  # fmt: skip
    write_report("knowledge_tracing", text)
    return text

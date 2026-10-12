"""Metrics for probability forecasts of right/wrong answers.

* AUC: does the model rank the attempts a student gets right above the ones
  they get wrong? Insensitive to calibration.
* Log loss and Brier score: are the probabilities themselves right?
* ECE (expected calibration error): average gap between predicted and actual
  accuracy over 15 equal-count bins. Atom shows mastery as a percentage, so a
  student reading "70%" should get about 70% of such questions right.

Attempts by the same student are not independent, so intervals come from a
*clustered* bootstrap that resamples whole students. AUC does not decompose
per student, so every resample is the weighted Mann-Whitney statistic with
each student's rows weighted by how often the student was drawn; the scores
are sorted once and reused for every resample.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def _tie_groups(sorted_scores: np.ndarray) -> np.ndarray:
    """Group id per position of an ascending array; equal scores share one."""
    return np.concatenate([[0], np.cumsum(np.diff(sorted_scores) != 0)])


def weighted_auc(y: np.ndarray, p: np.ndarray, w: np.ndarray | None = None, order=None) -> float:
    """AUC with row weights (ties count one half). `order` = argsort(p), reusable."""
    order = np.argsort(p, kind="stable") if order is None else order
    ys, ps = y[order], p[order]
    ws = np.ones(len(ys)) if w is None else w[order]
    pos, neg = ws * (ys == 1), ws * (ys == 0)
    g = _tie_groups(ps)
    neg_in_group = np.bincount(g, weights=neg)
    pos_in_group = np.bincount(g, weights=pos)
    neg_below = np.concatenate([[0.0], np.cumsum(neg_in_group)[:-1]])
    num = np.sum(pos_in_group * (neg_below + 0.5 * neg_in_group))
    den = pos.sum() * neg.sum()
    return float(num / den) if den > 0 else float("nan")


def log_loss(y: np.ndarray, p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def ece(y: np.ndarray, p: np.ndarray, bins: int = 15) -> float:
    edges = np.quantile(p, np.linspace(0, 1, bins + 1))
    idx = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, bins - 1)
    count = np.bincount(idx, minlength=bins)
    gap = np.abs(
        np.bincount(idx, weights=p, minlength=bins) - np.bincount(idx, weights=y, minlength=bins)
    )
    return float(gap.sum() / max(count.sum(), 1))


@dataclass
class Scores:
    auc: tuple[float, float, float]  # estimate, 2.5%, 97.5%
    log_loss: tuple[float, float, float]
    brier: float
    ece: float
    n: int


def _user_draws(users: np.ndarray, n_boot: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Per-row weights for each bootstrap resample of users: (n_boot, n_rows)."""
    codes, inv = np.unique(users, return_inverse=True)
    rng = np.random.default_rng(seed)
    counts = np.stack([np.bincount(rng.integers(0, len(codes), len(codes)), minlength=len(codes))
                       for _ in range(n_boot)])  # fmt: skip
    return counts, inv


def score(
    y: np.ndarray, p: np.ndarray, users: np.ndarray, n_boot: int = 200, seed: int = 0
) -> Scores:
    y = y.astype(np.float64)
    order = np.argsort(p, kind="stable")
    counts, inv = _user_draws(users, n_boot, seed)
    ll_rows = log_loss(y, p)
    aucs, lls = [], []
    for c in counts:
        w = c[inv].astype(np.float64)
        aucs.append(weighted_auc(y, p, w, order))
        lls.append(np.sum(w * ll_rows) / np.sum(w))
    auc = weighted_auc(y, p, None, order)
    return Scores(
        (auc, *np.quantile(aucs, [0.025, 0.975])),
        (float(ll_rows.mean()), *np.quantile(lls, [0.025, 0.975])),
        float(np.mean((p - y) ** 2)),
        ece(y, p),
        len(y),
    )


def paired_auc_difference(
    y: np.ndarray,
    p_a: np.ndarray,
    p_b: np.ndarray,
    users: np.ndarray,
    n_boot: int = 200,
    seed: int = 0,
) -> tuple[float, float, float]:
    """AUC(b) - AUC(a) on the same attempts, with a clustered-bootstrap interval."""
    y = y.astype(np.float64)
    oa, ob = np.argsort(p_a, kind="stable"), np.argsort(p_b, kind="stable")
    counts, inv = _user_draws(users, n_boot, seed)
    diffs = []
    for c in counts:
        w = c[inv].astype(np.float64)
        diffs.append(weighted_auc(y, p_b, w, ob) - weighted_auc(y, p_a, w, oa))
    d = weighted_auc(y, p_b, None, ob) - weighted_auc(y, p_a, None, oa)
    return float(d), *map(float, np.quantile(diffs, [0.025, 0.975]))

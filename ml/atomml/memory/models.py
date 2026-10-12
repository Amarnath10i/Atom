"""Forgetting-curve models: how likely is a student to recall something
`delta` days after last practising it, given their history with it?

Atom today (src/lib/memory-map.ts) predicts recall = exp(-days / S) with a
hand-set stability S = 1.5 * max(1, sm2_interval) + 2 * reviews + 3 days.

Half-life regression (Settles & Meeder, ACL 2016) learns the half-life
instead: h = 2^(theta . x) days, recall p = 2^(-delta / h), where x holds the
practice history (sqrt of right and wrong counts), optionally an indicator
per item and per student. It minimizes
    sum (p - p_hat)^2 + alpha * (h - h_hat)^2 + lambda * ||theta||^2,
where h_hat = -delta / log2(p) is the half-life implied by the observed
recall. The gradient is written out below and the whole thing is fitted with
full-batch L-BFGS on a sparse design matrix.
"""

from __future__ import annotations

import numpy as np
import scipy.sparse as sp
from scipy.optimize import minimize

LN2 = np.log(2.0)
MIN_H, MAX_H = 15.0 / (24 * 60), 274.0  # half-life bounds from the paper, in days


def atom_recall(
    delta_days: np.ndarray,
    reviews: np.ndarray,
    sm2_interval: float = 1.0,
    stability_mul: float = 1.0,
):
    stability = (max(1.0, sm2_interval) * 1.5 + reviews * 2 + 3) * stability_mul
    return np.exp(-delta_days / stability)


def implied_half_life(p: np.ndarray, delta: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-4, 0.9999)
    return np.clip(-delta / np.log2(p), MIN_H, MAX_H)


class HLR:
    def __init__(self, alpha: float = 0.01, lam: float = 0.1, max_iter: int = 300):
        self.alpha, self.lam, self.max_iter = alpha, lam, max_iter

    @staticmethod
    def half_life(x: sp.csr_matrix, theta: np.ndarray) -> np.ndarray:
        z = np.clip(x @ theta, np.log2(MIN_H), np.log2(MAX_H))
        return np.exp2(z)

    def loss_and_grad(self, theta, x, p, delta, h_hat):
        z = x @ theta
        inside = (z > np.log2(MIN_H)) & (z < np.log2(MAX_H))
        h = np.exp2(np.clip(z, np.log2(MIN_H), np.log2(MAX_H)))
        p_hat = np.exp2(-delta / h)
        r_p, r_h = p_hat - p, h - h_hat
        n = len(p)
        loss = (np.sum(r_p**2) + self.alpha * np.sum(r_h**2)) / n + self.lam * theta @ theta / n
        # d p_hat / dz = p_hat * ln2^2 * delta / h ;  d h / dz = h * ln2 ; zero where z is clipped
        dz = (2 * r_p * p_hat * LN2**2 * delta / h + 2 * self.alpha * r_h * h * LN2) * inside
        grad = (x.T @ dz) / n + 2 * self.lam * theta / n
        return loss, grad

    def fit(self, x: sp.csr_matrix, p: np.ndarray, delta: np.ndarray) -> HLR:
        h_hat = implied_half_life(p, delta)
        res = minimize(self.loss_and_grad, np.zeros(x.shape[1]), args=(x, p, delta, h_hat), jac=True,
                       method="L-BFGS-B", options={"maxiter": self.max_iter})  # fmt: skip
        self.theta = res.x
        self.result = res
        return self

    def predict(self, x: sp.csr_matrix, delta: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        h = self.half_life(x, self.theta)
        return np.exp2(-delta / h), h


def leitner(right: np.ndarray, wrong: np.ndarray, delta: np.ndarray) -> np.ndarray:
    return np.exp2(-delta / np.exp2(np.clip(right - wrong, -10, 10)))


def pimsleur(seen: np.ndarray, delta: np.ndarray) -> np.ndarray:
    return np.exp2(-delta / np.exp2(np.clip(2.35 * seen - 16.46, -10, 10)))

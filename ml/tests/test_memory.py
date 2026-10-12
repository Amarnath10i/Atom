import numpy as np
import pytest
import scipy.sparse as sp

from atomml.memory.models import HLR, atom_recall, implied_half_life


def test_hlr_gradient_matches_finite_differences():
    rng = np.random.default_rng(0)
    n, d = 200, 4
    x = sp.csr_matrix(rng.normal(size=(n, d)))
    p = rng.uniform(0.2, 1.0, n)
    delta = rng.uniform(0.1, 20, n)
    m = HLR(alpha=0.01, lam=0.1)
    theta = rng.normal(scale=0.3, size=d)
    h_hat = implied_half_life(p, delta)
    _, g = m.loss_and_grad(theta, x, p, delta, h_hat)
    eps = 1e-6
    num = np.array([(m.loss_and_grad(theta + eps * e, x, p, delta, h_hat)[0]
                     - m.loss_and_grad(theta - eps * e, x, p, delta, h_hat)[0]) / (2 * eps) for e in np.eye(d)])  # fmt: skip
    np.testing.assert_allclose(g, num, rtol=1e-4, atol=1e-8)


def test_hlr_recovers_a_planted_half_life_law():
    rng = np.random.default_rng(1)
    n = 20000
    right = rng.integers(0, 20, n)
    wrong = rng.integers(0, 10, n)
    x = sp.csr_matrix(np.column_stack([np.ones(n), np.sqrt(1 + right), np.sqrt(1 + wrong)]))
    theta_true = np.array([1.0, 1.2, -0.8])
    h = np.exp2(x @ theta_true)
    delta = rng.uniform(0.5, 30, n)
    p = np.exp2(-delta / h)
    m = HLR(alpha=0.01, lam=1e-6, max_iter=500).fit(x, p, delta)
    np.testing.assert_allclose(m.theta, theta_true, atol=0.05)


def test_atom_recall_formula():
    assert atom_recall(np.array([0.0]), np.array([0]))[0] == pytest.approx(1.0)
    # S = 1.5 + 2*2 + 3 = 8.5 days
    assert atom_recall(np.array([8.5]), np.array([2]))[0] == pytest.approx(np.exp(-1))

"""The sequential student models, checked against their definitions."""

import itertools

import numpy as np
import pytest

from atomml.kt.sequential import BKT, _bkt_pass, atom_rule, elo


def brute_force_bkt(y, prior, learn, guess, slip):
    """Posterior marginals by enumerating every hidden path (2^m of them)."""
    m = len(y)
    z = 0.0
    gamma = np.zeros(m)  # P(learned at t | y)
    xi = 0.0  # expected 0 -> 1 transitions
    unlearned_before_last = 0.0  # expected count of "unlearned" at t < m
    for path in itertools.product([0, 1], repeat=m):
        if any(path[t] == 1 and path[t + 1] == 0 for t in range(m - 1)):
            continue  # no forgetting in BKT
        p = prior if path[0] else 1 - prior
        for t in range(1, m):
            if path[t - 1] == 0:
                p *= learn if path[t] else 1 - learn
        for t in range(m):
            pc = 1 - slip if path[t] else guess
            p *= pc if y[t] else 1 - pc
        z += p
        gamma += p * np.array(path)
        xi += p * sum(path[t] == 0 and path[t + 1] == 1 for t in range(m - 1))
        unlearned_before_last += p * sum(path[t] == 0 for t in range(m - 1))
    return gamma / z, xi / z, unlearned_before_last / z


@pytest.mark.parametrize("y", [[1, 0, 1, 1], [0, 0, 0, 1, 1], [1, 1, 0, 1, 0, 1], [0]])
def test_bkt_expected_counts_match_brute_force(y):
    prior, learn, guess, slip = 0.3, 0.2, 0.25, 0.1
    n = len(y)
    _, st = _bkt_pass(
        np.zeros(n, np.int64), np.zeros(n, np.int64), np.array(y, np.int64),
        np.array([prior]), np.array([learn]), np.array([guess]), np.array([slip]), True,
    )  # fmt: skip
    gamma, xi, unlearned = brute_force_bkt(y, prior, learn, guess, slip)
    assert st[0, 0] == pytest.approx(gamma[0])  # P(learned at the start)
    assert st[0, 2] == pytest.approx(xi)
    assert st[0, 3] == pytest.approx(unlearned)
    yy = np.array(y)
    assert st[0, 4] == pytest.approx(np.sum((1 - gamma) * yy))  # correct while unlearned
    assert st[0, 6] == pytest.approx(np.sum(gamma * (1 - yy)))  # wrong while learned


def test_bkt_predictions_are_forward_filtering():
    # one wrong answer then one right: hand-computed
    prior, learn, guess, slip = 0.5, 0.1, 0.2, 0.1
    pred, _ = _bkt_pass(np.zeros(2, np.int64), np.zeros(2, np.int64), np.array([0, 1]),
                        np.array([prior]), np.array([learn]), np.array([guess]), np.array([slip]), False)  # fmt: skip
    assert pred[0] == pytest.approx(0.5 * 0.9 + 0.5 * 0.2)
    post = 0.5 * 0.1 / (1 - pred[0])
    lt = post + (1 - post) * learn
    assert pred[1] == pytest.approx(lt * 0.9 + (1 - lt) * 0.2)


def test_bkt_em_recovers_parameters_from_simulated_students():
    rng = np.random.default_rng(0)
    true = dict(prior=0.3, learn=0.15, guess=0.2, slip=0.1)
    users, items, ys = [], [], []
    for u in range(3000):
        learned = rng.random() < true["prior"]
        for _ in range(12):
            p = 1 - true["slip"] if learned else true["guess"]
            users.append(u)
            items.append(0)
            ys.append(int(rng.random() < p))
            if not learned:
                learned = rng.random() < true["learn"]
    m = BKT(1, iterations=60).fit(np.array(users), np.array(items), np.array(ys))
    for k, v in true.items():
        assert getattr(m, k)[0] == pytest.approx(v, abs=0.04), k


def test_elo_learns_item_difficulty_order_on_rasch_data():
    rng = np.random.default_rng(1)
    b_true = np.array([-1.5, 0.0, 1.5])
    users, items, ys = [], [], []
    for u in range(4000):
        theta = rng.normal()
        for _ in range(15):
            k = rng.integers(3)
            users.append(u)
            items.append(k)
            ys.append(int(rng.random() < 1 / (1 + np.exp(-(theta - b_true[k])))))
    b, nb = np.zeros(3), np.zeros(3)
    topic = np.zeros(len(users), np.int64)
    elo(
        np.array(users), np.array(items), topic, np.array(ys, np.float64), b, nb, 0.4, 0.05, True, 1
    )
    assert np.argsort(b).tolist() == [0, 1, 2]
    assert np.corrcoef(b, b_true)[0, 1] > 0.99


def test_atom_rule_matches_the_app():
    # Topic seen in two sessions a day apart: 1/1 right, then 1/2 right; difficulty 3.
    user = np.zeros(3, np.int64)
    item = np.zeros(3, np.int64)
    group = np.array([0, 1, 1])
    days = np.array([0.0, 1.0, 1.0])
    correct = np.array([1, 1, 0])
    difficulty = np.full(3, 3)
    pred = atom_rule(user, item, group, days, correct, difficulty, 1)
    mult = 0.6 + 2 * 0.1
    assert pred[0] == pytest.approx(0.35)  # no atom yet
    s1 = min(0.5, 0.35 + 0.05 * mult)  # new atom after a perfect session
    stability = 1.5 + 2 * 1 + 3
    assert pred[1] == pred[2] == pytest.approx(s1 * (0.55 + 0.45 * np.exp(-1 / stability)))


def test_bucketed_elo_ignores_other_exercises_in_the_same_bucket():
    from atomml.kt.sequential import elo_buckets

    # one student, two buckets; bucket 0 has exercises 0 and 1, bucket 1 has exercise 0
    user = np.zeros(4, np.int64)
    bucket = np.array([0, 0, 0, 1])
    item = np.array([0, 0, 1, 0])
    topic = np.zeros(4, np.int64)

    def run(correct):
        b, nb = np.zeros(2), np.zeros(2)
        return elo_buckets(
            user, bucket, item, topic, np.array(correct, np.float64), b, nb, 0.4, 0.05, False, 1
        )

    a, b = run([1, 0, 1, 1]), run([1, 0, 0, 1])  # only exercise 1's answer differs
    assert a[:3].tolist() == b[:3].tolist()  # nothing in bucket 0 saw it
    assert a[1] != a[0]  # same-exercise history inside the bucket is visible
    assert a[3] != b[3]  # the next bucket does see it

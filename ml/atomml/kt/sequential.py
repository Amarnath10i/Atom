"""Student models that read a student's attempts one at a time, in order.

All three run over arrays sorted by (user, time) and return, for every
attempt, the predicted probability of a correct answer made *before* seeing
that attempt. They are compiled with numba: 16M sequential updates in Python
would take minutes per pass, which rules out tuning.

* `atom_rule` is what Atom does today (src/lib/learning-os.functions.ts and
  src/lib/memory-map.ts), reproduced line by line: per topic and session,
  accuracy >= 80% adds 0.05, 50-80% subtracts 0.08 and below 50% subtracts
  0.18, all scaled by a difficulty multiplier and clamped; the displayed
  mastery decays as strength * (0.55 + 0.45 * exp(-days / S)) with
  S = 1.5 + 2 * reviews + 3 (no SM-2 interval is set by tests).
* `elo` is the Elo rating system for learners (Pelanek 2016): P(correct) =
  sigmoid(theta_user + theta_user,topic - b_item); every answer moves the
  ratings by K * (y - P), with K = alpha / (1 + beta * n) shrinking as an
  entity accumulates answers. Item difficulties come from training students;
  a new student's ratings start at 0 and adapt online.
* `bkt` is Bayesian Knowledge Tracing (Corbett & Anderson 1995): a two-state
  hidden Markov model per exercise (learned / not learned) with prior,
  learning, guess and slip probabilities, fitted by EM (Baum-Welch).
"""

from __future__ import annotations

import numpy as np
from numba import njit


@njit(cache=True)
def atom_rule(user, item, group, days, correct, difficulty, n_items):
    """Predictions of Atom's current rule. `group` changes whenever (user,
    15-minute bucket, item) changes: one mock-test topic update."""
    n = len(user)
    out = np.empty(n)
    strength = np.full(n_items, -1.0)  # -1 = no atom yet
    reviews = np.zeros(n_items)
    last = np.zeros(n_items)
    seen = np.zeros(n_items, dtype=np.int64)  # epoch counter per user
    epoch = 0
    i = 0
    while i < n:
        if i == 0 or user[i] != user[i - 1]:
            epoch += 1
        j = i
        while j < n and group[j] == group[i]:
            j += 1
        k = item[i]
        if seen[k] != epoch:  # first time this student meets the topic
            seen[k] = epoch
            strength[k] = -1.0
            reviews[k] = 0.0
        if strength[k] < 0:
            pred = 0.35
        else:
            stability = 1.5 + 2.0 * reviews[k] + 3.0
            recall = np.exp(-max(0.0, days[i] - last[k]) / stability)
            pred = strength[k] * (0.55 + 0.45 * recall)
        acc = 0.0
        for r in range(i, j):
            out[r] = pred
            acc += correct[r]
        acc /= j - i
        mult = 0.6 + (difficulty[i] - 1) * 0.1
        if acc >= 0.8:
            delta = 0.05 * mult
        elif acc >= 0.5:
            delta = -0.08 * mult
        else:
            delta = -0.18 * mult
        if strength[k] < 0:
            strength[k] = max(0.05, min(0.5, 0.35 + delta))
        else:
            strength[k] = max(0.05, min(0.98, strength[k] + delta))
        reviews[k] += 1.0
        last[k] = days[j - 1]
        i = j
    return out


@njit(cache=True)
def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


@njit(cache=True)
def elo(user, item, topic, correct, b, nb, alpha, beta, learn_items, n_topics):
    """One pass in the given order. `b`/`nb` (item difficulty and its update
    count) are updated in place when `learn_items`; student ratings always
    adapt. Returns predictions made before each update."""
    n = len(user)
    out = np.empty(n)
    theta = 0.0
    n_theta = 0.0
    theta_t = np.zeros(n_topics)
    n_t = np.zeros(n_topics)
    seen = np.zeros(n_topics, dtype=np.int64)
    epoch = 0
    for i in range(n):
        if i == 0 or user[i] != user[i - 1]:
            epoch += 1
            theta = 0.0
            n_theta = 0.0
        t = topic[i]
        if seen[t] != epoch:
            seen[t] = epoch
            theta_t[t] = 0.0
            n_t[t] = 0.0
        k = item[i]
        p = _sigmoid(theta + theta_t[t] - b[k])
        out[i] = p
        err = correct[i] - p
        theta += alpha / (1.0 + beta * n_theta) * err
        theta_t[t] += alpha / (1.0 + beta * n_t[t]) * err
        n_theta += 1.0
        n_t[t] += 1.0
        if learn_items:
            b[k] -= alpha / (1.0 + beta * nb[k]) * err
            nb[k] += 1.0
    return out


@njit(cache=True)
def _bkt_pass(user, item, correct, prior, learn, guess, slip, collect):
    """Forward filtering (predictions) and, when `collect`, the forward-backward
    expected counts for one EM step, for all (user, item) sequences at once.
    Rows must be sorted by (user, time); sequences are per (user, item)."""
    n = len(user)
    n_items = len(prior)
    pred = np.empty(n)
    # expected counts: [prior_learned, prior_total, learn_num, learn_den,
    #                   guess_num, guess_den, slip_num, slip_den]
    stats = np.zeros((n_items, 8))
    # group rows of each (user, item) sequence: walk each user's block per item
    start = 0
    while start < n:
        end = start
        while end < n and user[end] == user[start]:
            end += 1
        # indices of this user's rows, bucketed by item, in time order
        block = np.arange(start, end)
        items_here = item[start:end]
        order = np.argsort(items_here, kind="mergesort")
        s = 0
        while s < len(order):
            e = s
            k = items_here[order[s]]
            while e < len(order) and items_here[order[e]] == k:
                e += 1
            rows = block[order[s:e]]
            m = len(rows)
            alpha_f = np.empty(m)  # P(learned at t | obs < t)
            filt = np.empty(m)  # P(learned at t | obs <= t)
            lt = prior[k]
            for r in range(m):
                alpha_f[r] = lt
                pc = lt * (1 - slip[k]) + (1 - lt) * guess[k]
                pred[rows[r]] = pc
                y = correct[rows[r]]
                post = lt * (1 - slip[k]) / pc if y == 1 else lt * slip[k] / (1 - pc)
                filt[r] = post
                lt = post + (1 - post) * learn[k]
            if collect:
                # backward smoothing of P(learned at t | all obs)
                smooth = np.empty(m)
                smooth[m - 1] = filt[m - 1]
                for r in range(m - 2, -1, -1):
                    nxt = alpha_f[r + 1]
                    # P(L_t | L_{t+1}) mixes: learned stays learned; unlearned learns w.p. learn
                    p_l_and_next = filt[r]
                    p_u_to_l = (1 - filt[r]) * learn[k]
                    frac_from_learned = p_l_and_next / nxt if nxt > 0 else 0.0
                    learned_next = smooth[r + 1]
                    unlearned_next = 1 - smooth[r + 1]
                    smooth[r] = learned_next * frac_from_learned
                    # transitions out of "unlearned" at r into "learned" at r+1
                    trans = learned_next * (p_u_to_l / nxt if nxt > 0 else 0.0)
                    stats[k, 2] += trans
                    stats[k, 3] += trans + unlearned_next  # was unlearned at r
                stats[k, 0] += smooth[0]
                stats[k, 1] += 1.0
                for r in range(m):
                    y = correct[rows[r]]
                    stats[k, 4] += (1 - smooth[r]) * y
                    stats[k, 5] += 1 - smooth[r]
                    stats[k, 6] += smooth[r] * (1 - y)
                    stats[k, 7] += smooth[r]
            s = e
        start = end
    return pred, stats


class BKT:
    def __init__(
        self, n_items: int, iterations: int = 25, max_guess: float = 0.3, max_slip: float = 0.3
    ):
        self.n_items = n_items
        self.iterations = iterations
        self.max_guess, self.max_slip = max_guess, max_slip
        self.prior = np.full(n_items, 0.4)
        self.learn = np.full(n_items, 0.1)
        self.guess = np.full(n_items, 0.2)
        self.slip = np.full(n_items, 0.1)

    def fit(self, user, item, correct) -> BKT:
        for _ in range(self.iterations):
            _, st = _bkt_pass(
                user, item, correct, self.prior, self.learn, self.guess, self.slip, True
            )
            has = st[:, 1] > 0
            # light Beta(2, 2)-style smoothing keeps rarely practised exercises sane
            self.prior[has] = (st[has, 0] + 1) / (st[has, 1] + 2)
            self.learn[has] = (st[has, 2] + 0.1) / (st[has, 3] + 1)
            self.guess[has] = np.minimum((st[has, 4] + 0.2) / (st[has, 5] + 1), self.max_guess)
            self.slip[has] = np.minimum((st[has, 6] + 0.1) / (st[has, 7] + 1), self.max_slip)
        return self

    def predict(self, user, item, correct) -> np.ndarray:
        pred, _ = _bkt_pass(
            user, item, correct, self.prior, self.learn, self.guess, self.slip, False
        )
        return pred


@njit(cache=True)
def elo_buckets(user, bucket, item, topic, correct, b, nb, alpha, beta, learn_items, n_topics):
    """`elo` under the visibility rule: every attempt in a 15-minute bucket is
    predicted from the ratings at the start of the bucket plus the earlier
    attempts on its own exercise; the bucket's updates are applied together
    when it ends. Rows: sorted by (user, bucket, item, session, number)."""
    n = len(user)
    out = np.empty(n)
    theta = 0.0
    n_theta = 0.0
    theta_t = np.zeros(n_topics)
    n_t = np.zeros(n_topics)
    d_t = np.zeros(n_topics)
    c_t = np.zeros(n_topics)
    seen = np.zeros(n_topics, dtype=np.int64)
    touched = np.empty(n_topics, dtype=np.int64)
    epoch = 0
    i = 0
    while i < n:
        if i == 0 or user[i] != user[i - 1]:
            epoch += 1
            theta = 0.0
            n_theta = 0.0
        j = i
        while j < n and bucket[j] == bucket[i]:
            j += 1
        d_theta = 0.0
        c_theta = 0.0
        n_touched = 0
        r = i
        while r < j:
            s = r
            while r < j and item[r] == item[s]:
                r += 1
            k = item[s]
            t = topic[s]
            if seen[t] != epoch:
                seen[t] = epoch
                theta_t[t] = 0.0
                n_t[t] = 0.0
            th, nth, tht, ntt = theta, n_theta, theta_t[t], n_t[t]
            for q in range(s, r):
                p = _sigmoid(th + tht - b[k])
                out[q] = p
                err = correct[q] - p
                th += alpha / (1.0 + beta * nth) * err
                tht += alpha / (1.0 + beta * ntt) * err
                nth += 1.0
                ntt += 1.0
                if learn_items:
                    b[k] -= alpha / (1.0 + beta * nb[k]) * err
                    nb[k] += 1.0
            d_theta += th - theta
            c_theta += r - s
            if c_t[t] == 0:
                touched[n_touched] = t
                n_touched += 1
            d_t[t] += tht - theta_t[t]
            c_t[t] += r - s
        theta += d_theta
        n_theta += c_theta
        for z in range(n_touched):
            t = touched[z]
            theta_t[t] += d_t[t]
            n_t[t] += c_t[t]
            d_t[t] = 0.0
            c_t[t] = 0.0
        i = j
    return out

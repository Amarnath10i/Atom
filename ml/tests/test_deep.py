"""The deep models obey the visibility rule: nothing from another exercise in
the same 15-minute bucket reaches a prediction."""

import numpy as np
import torch

from atomml.kt.deep import DKT, SAKT, session_counts

# one student: bucket 0 = exercise 3 twice, exercise 5 once; bucket 1 = exercise 3
ITEM = torch.tensor([3, 3, 5, 3])
BUCKET = torch.tensor([0, 0, 0, 1])
GROUP = np.array([0, 0, 1, 2])


def _session(correct):
    n, c = session_counts(GROUP, np.array(correct))
    return torch.tensor(n), torch.tensor(c)


def dkt_predict(model, correct):
    n, c = _session(correct)
    gap = torch.zeros(1, 2)
    with torch.no_grad():
        return model(
            1, 2, torch.zeros(4, dtype=torch.long), BUCKET, ITEM, torch.tensor(correct), gap, n, c
        )


def sakt_predict(model, correct):
    n, c = _session(correct)
    with torch.no_grad():
        return model(ITEM[None], torch.tensor(correct)[None], BUCKET[None], torch.ones(1, 4, dtype=torch.bool),
                     n[None], c[None])[0]  # fmt: skip


def test_session_counts():
    n, c = session_counts(GROUP, np.array([1, 0, 1, 1]))
    assert n.tolist() == [0, 1, 0, 0] and c.tolist() == [0, 1, 0, 0]


def test_deep_models_ignore_other_exercises_in_the_same_bucket():
    torch.manual_seed(0)
    for model in (DKT(10, d=16).eval(), SAKT(10, d=16, heads=2, window=8).eval()):
        predict = dkt_predict if isinstance(model, DKT) else sakt_predict
        a = predict(model, [1, 0, 1, 1])
        b = predict(model, [1, 0, 0, 1])  # flip exercise 5 (row 2) only
        assert torch.allclose(a[:3], b[:3]), type(model).__name__  # its own bucket never sees it
        assert not torch.allclose(a[3], b[3]), type(model).__name__  # the next bucket does
        c = predict(model, [0, 0, 1, 1])  # flip the first exercise-3 answer
        assert not torch.allclose(a[1], c[1]), type(
            model
        ).__name__  # visible within its own session

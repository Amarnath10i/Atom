"""The agents service computes the same features as training, row by row.

agents/student_model.py rebuilds the shipped feature set ("atom" variant of
atomml/kt/features.py) from a list of attempts, with no pandas. For every
attempt of a synthetic log, the serving features computed from its visible
history must equal the training features."""

import sys
from datetime import UTC

import numpy as np
import pandas as pd
import pytest
from test_features import toy

from atomml.config import REPO
from atomml.experiments.kt import variant_columns
from atomml.kt.features import build, item_stats

sys.path.insert(0, str(REPO))
from agents.student_model import FEATURES, Attempt, features  # noqa: E402

ATOM_DIFFICULTY = {0: 1, 1: 3, 2: 4}  # Junyi level -> an Atom difficulty that maps back to it


def attempts_of(a: pd.DataFrame, items: pd.DataFrame) -> list[Attempt]:
    return [
        Attempt(topic=str(r.item), correct=bool(r.correct), at=r.ts.to_pydatetime().replace(tzinfo=UTC),
                unit=str(items.at[r.item, "level4"]), difficulty=ATOM_DIFFICULTY[int(items.at[r.item, "difficulty"])],
                time_sec=float(r.sec))
        for r in a.itertuples()
    ]  # fmt: skip


@pytest.mark.parametrize("seed", [0, 5])
def test_serving_features_equal_training_features(seed):
    a, items, _ = toy(seed=seed)
    items = items.assign(difficulty=np.arange(len(items)) % 3)
    offline = build(a, items, item_stats(a, len(items)))
    cols = variant_columns(offline.columns)["atom"]
    assert cols == FEATURES
    offline = offline[cols].to_numpy(np.float32)
    rows = attempts_of(a, items)
    for r in range(len(a)):
        u, t, i = a.at[r, "user"], a.at[r, "ts"], a.at[r, "item"]
        mine = np.flatnonzero(a["user"].to_numpy() == u)
        earlier = [rows[j] for j in mine if a.at[j, "ts"] < t]
        session = [rows[j] for j in mine if a.at[j, "ts"] == t and a.at[j, "item"] == i and j < r]
        served = features(earlier, session, str(i), str(items.at[i, "level4"]),
                          ATOM_DIFFICULTY[int(items.at[i, "difficulty"])], rows[r].at)  # fmt: skip
        np.testing.assert_allclose(served, offline[r], rtol=1e-5, atol=1e-6, err_msg=f"row {r}")


def test_atom_difficulty_maps_onto_junyi_levels():
    from agents.student_model import difficulty_level

    assert [difficulty_level(d) for d in (1, 2, 3, 4, 5)] == [0, 0, 1, 2, 2]

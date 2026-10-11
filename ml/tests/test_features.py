"""History features must only see what was visible when the student answered."""

import numpy as np
import pandas as pd
import pytest
import scipy.sparse as sp

from atomml.kt.features import Graph, build, item_stats


def toy(seed=0, n_users=30, n_rows=400, n_items=6):
    rng = np.random.default_rng(seed)
    a = pd.DataFrame({
        "user": rng.integers(0, n_users, n_rows),
        "ts": pd.Timestamp("2019-01-01") + pd.to_timedelta(rng.integers(0, 40, n_rows) * 15, unit="min"),
        "item": rng.integers(0, n_items, n_rows).astype(np.int16),
        "session": rng.integers(1, 3, n_rows),
        "number": rng.integers(1, 6, n_rows),
        "correct": rng.integers(0, 2, n_rows).astype(np.int8),
        "sec": rng.integers(5, 200, n_rows), "tries": rng.integers(1, 3, n_rows), "hints": rng.integers(0, 2, n_rows),
    }).drop_duplicates(["user", "ts", "item", "session", "number"])  # fmt: skip
    a = a.sort_values(["user", "ts", "item", "session", "number"], ignore_index=True)
    items = pd.DataFrame({"difficulty": np.zeros(n_items, np.int8), "level4": np.arange(n_items) // 2})
    graph = Graph("ring", sp.csr_matrix((np.ones(n_items), (np.arange(n_items), (np.arange(n_items) + 1) % n_items)),
                                        shape=(n_items, n_items)))  # fmt: skip
    return a, items, graph


def features(a, items, graph, naive=False):
    return build(a, items, item_stats(a, len(items)), [graph], naive=naive)


def test_features_ignore_the_future_and_same_bucket_other_exercises():
    a, items, graph = toy()
    stats = item_stats(a, len(items))  # held fixed: population stats are not history
    base = build(a, items, stats, [graph])
    rng = np.random.default_rng(1)
    for r in rng.choice(len(a), 25, replace=False):
        later = (a["user"] == a.at[r, "user"]) & (a["ts"] > a.at[r, "ts"])
        same_bucket_other = (a["user"] == a.at[r, "user"]) & (a["ts"] == a.at[r, "ts"]) & (a["item"] != a.at[r, "item"])
        changed = a.copy()
        mask = (later | same_bucket_other).to_numpy()
        changed.loc[mask, "correct"] = 1 - changed.loc[mask, "correct"]
        changed.loc[mask, "hints"] = 5 - changed.loc[mask, "hints"]
        again = build(changed, items, stats, [graph])
        pd.testing.assert_series_equal(base.loc[r], again.loc[r], check_names=False)


def test_naive_ordering_leaks_same_bucket_answers():
    a, items, graph = toy(seed=2)
    stats = item_stats(a, len(items))
    base = build(a, items, stats, [graph], naive=True)
    # find a row whose bucket has another exercise sorted before it
    for r in range(1, len(a)):
        prev = a.loc[r - 1]
        if prev["user"] == a.at[r, "user"] and prev["ts"] == a.at[r, "ts"] and prev["item"] != a.at[r, "item"]:
            break
    changed = a.copy()
    changed.loc[r - 1, "correct"] = 1 - changed.loc[r - 1, "correct"]
    again = build(changed, items, stats, [graph], naive=True)
    assert base.at[r, "acc_all"] != pytest.approx(again.at[r, "acc_all"])


def test_counts_match_a_direct_scan():
    a, items, graph = toy(seed=3)
    f = features(a, items, graph)
    topic = items["level4"].to_numpy()
    nb = {i: set(graph.adj[i].indices) for i in range(len(items))}
    for r in range(0, len(a), 7):
        u, t, i = a.at[r, "user"], a.at[r, "ts"], a.at[r, "item"]
        mine = a[a["user"] == u]
        earlier = mine[mine["ts"] < t]
        same_session = mine[(mine["ts"] == t) & (mine["item"] == i) & (mine.index < r)]
        n_item = (earlier["item"] == i).sum() + len(same_session)
        n_topic = ((topic[earlier["item"]] == topic[i]) & (earlier["item"] != i)).sum()
        n_all = len(earlier) + len(same_session)
        n_nb = earlier["item"].isin(nb[i]).sum()
        assert f.at[r, "n_item"] == pytest.approx(np.log1p(n_item))
        assert f.at[r, "n_topic"] == pytest.approx(np.log1p(n_topic))
        assert f.at[r, "n_all"] == pytest.approx(np.log1p(n_all))
        assert f.at[r, "n_nb_ring"] == pytest.approx(np.log1p(n_nb))
        assert f.at[r, "n_in_session"] == len(same_session)

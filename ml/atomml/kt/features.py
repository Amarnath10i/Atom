"""History features for every attempt, under a strict visibility rule.

Attempt t of student u on exercise i in 15-minute bucket B may see:
  * every attempt of u in buckets before B, and
  * attempts on exercise i earlier in bucket B (same session, known order).
It may not see other exercises answered in bucket B: their order relative
to t is unknown, and 71% of attempts share a bucket with another exercise.
`naive=True` drops the rule (every earlier row in sort order is visible), to
measure how much that common shortcut inflates the metrics.

All counts are computed with grouped cumulative sums, never a Python loop:
attempts are first aggregated per (student, bucket, exercise), cumulated over
buckets, and the running counts inside the current bucket are added back.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import scipy.sparse as sp

DAY = np.timedelta64(1, "D")


@dataclass
class Graph:
    """Directed neighbour lists: evidence on exercise j counts for i if j in N(i)."""

    name: str
    adj: sp.csr_matrix  # (n_items, n_items), adj[i, j] = 1 when j informs i


def _prior_sums(df: pd.DataFrame, keys: list[str], cols: list[str]) -> pd.DataFrame:
    """For rows sorted within `keys` groups: sums of `cols` over strictly earlier rows."""
    cum = df.groupby(keys, sort=False)[cols].cumsum()
    return cum - df[cols]


def build(attempts: pd.DataFrame, items: pd.DataFrame, item_stats: pd.DataFrame,
          graphs: list[Graph] = (), naive: bool = False) -> pd.DataFrame:  # fmt: skip
    """Feature table aligned with `attempts` rows (same index and order).

    item_stats: per-exercise population statistics estimated on training
    students only (columns item_logit, n_train).
    """
    a = attempts
    out = pd.DataFrame(index=a.index)
    topic = items["level4"].to_numpy()[a["item"].to_numpy()]
    a = a.assign(topic=topic, wrong=1 - a["correct"].astype(np.int32), one=1,
                 hint_any=(a["hints"] > 0).astype(np.int32), retry=(a["tries"] > 1).astype(np.int32),
                 log_sec=np.log1p(a["sec"].to_numpy(np.float32)))  # fmt: skip

    if naive:
        # every earlier row in (user, ts, item, session, number) order is history
        within_user = _prior_sums(a, ["user"], ["one", "correct"])
        same_item = _prior_sums(a.sort_values(["user", "item", "ts", "session", "number"], kind="stable"),
                                ["user", "item"], ["one", "correct"]).reindex(a.index)  # fmt: skip
        same_topic = _prior_sums(a.sort_values(["user", "topic", "ts", "item", "session", "number"], kind="stable"),
                                 ["user", "topic"], ["one", "correct"]).reindex(a.index)  # fmt: skip
        n_all, c_all = within_user["one"], within_user["correct"]
        n_item, c_item = same_item["one"], same_item["correct"]
        n_topic, c_topic = same_topic["one"] - n_item, same_topic["correct"] - c_item
        behav = _prior_sums(a, ["user"], ["hint_any", "retry", "log_sec"])
    else:
        # 1. per (user, bucket, item) totals, cumulated over earlier buckets
        g = (a.groupby(["user", "ts", "item"], sort=False)
               .agg(one=("one", "sum"), correct=("correct", "sum"), topic=("topic", "first"),
                    hint_any=("hint_any", "sum"), retry=("retry", "sum"), log_sec=("log_sec", "sum"))
               .reset_index())  # fmt: skip
        # earlier buckets, all items
        b = (
            g.groupby(["user", "ts"], sort=False)[
                ["one", "correct", "hint_any", "retry", "log_sec"]
            ]
            .sum()
            .reset_index()
        )
        b_prev = _prior_sums(b, ["user"], ["one", "correct", "hint_any", "retry", "log_sec"])
        b = pd.concat([b[["user", "ts"]], b_prev], axis=1)
        # earlier buckets, same item
        gi = g.sort_values(["user", "item", "ts"], kind="stable")
        gi_prev = _prior_sums(gi, ["user", "item"], ["one", "correct"]).rename(
            columns=lambda c: c + "_item"
        )
        g = g.join(gi_prev)
        # earlier buckets, same topic (all its items)
        gt = g.groupby(["user", "topic", "ts"], sort=False)[["one", "correct"]].sum().reset_index()
        gt = gt.sort_values(["user", "topic", "ts"], kind="stable")
        gt_prev = _prior_sums(gt, ["user", "topic"], ["one", "correct"]).rename(
            columns=lambda c: c + "_topic"
        )
        gt = pd.concat([gt[["user", "topic", "ts"]], gt_prev], axis=1)
        # 2. back to rows, plus running counts on this item inside this bucket
        keys = a[["user", "ts", "item", "topic"]]
        row = (keys.merge(g[["user", "ts", "item", "one_item", "correct_item"]], on=["user", "ts", "item"], how="left")
                   .merge(gt, on=["user", "topic", "ts"], how="left")
                   .merge(b, on=["user", "ts"], how="left"))  # fmt: skip
        inb = _prior_sums(a, ["user", "ts", "item"], ["one", "correct"])
        row.index = a.index
        n_item = row["one_item"] + inb["one"]
        c_item = row["correct_item"] + inb["correct"]
        n_topic = (
            row["one_topic"] - row["one_item"]
        )  # other exercises of the topic, earlier buckets
        c_topic = row["correct_topic"] - row["correct_item"]
        n_all = row["one"] + inb["one"]
        c_all = row["correct"] + inb["correct"]
        behav = row[["hint_any", "retry", "log_sec"]]
        out["n_in_session"] = inb["one"].to_numpy(np.float32)
        out["acc_in_session"] = _smoothed(inb["correct"], inb["one"], 0.7, 2.0)

    out["n_item"] = np.log1p(n_item.to_numpy(np.float32))
    out["acc_item"] = _smoothed(c_item, n_item, 0.7, 2.0)
    out["n_topic"] = np.log1p(n_topic.to_numpy(np.float32))
    out["acc_topic"] = _smoothed(c_topic, n_topic, 0.7, 2.0)
    out["n_all"] = np.log1p(n_all.to_numpy(np.float32))
    out["acc_all"] = _smoothed(c_all, n_all, 0.7, 5.0)
    denom = np.maximum(n_all.to_numpy(np.float32), 1)
    out["hint_rate"] = behav["hint_any"].to_numpy(np.float32) / denom
    out["retry_rate"] = behav["retry"].to_numpy(np.float32) / denom
    out["mean_log_sec"] = behav["log_sec"].to_numpy(np.float32) / denom

    # last visible attempt on this item: the previous row in (user, item) order is
    # either an earlier bucket or earlier in this item's session, both visible
    order = a.sort_values(["user", "item", "ts", "session", "number"], kind="stable")
    prev = order.groupby(["user", "item"], sort=False)[
        ["correct", "ts", "hints", "tries", "log_sec"]
    ].shift(1)
    prev = prev.reindex(a.index)
    out["last_correct"] = prev["correct"].fillna(-1).to_numpy(np.float32)
    out["last_hint"] = (
        (prev["hints"] > 0).astype(np.float32).where(prev["hints"].notna(), -1).to_numpy(np.float32)
    )
    out["last_retry"] = (
        (prev["tries"] > 1).astype(np.float32).where(prev["tries"].notna(), -1).to_numpy(np.float32)
    )
    out["last_log_sec"] = prev["log_sec"].fillna(-1).to_numpy(np.float32)
    gap = ((a["ts"] - prev["ts"]) / DAY).to_numpy(np.float32)
    out["log_days_item"] = np.where(np.isnan(gap), -1.0, np.log1p(np.maximum(gap, 0))).astype(
        np.float32
    )

    # population difficulty of the exercise (training students only) and its label
    st = item_stats.reindex(a["item"].to_numpy())
    out["item_logit"] = st["item_logit"].to_numpy(np.float32)
    out["item_n"] = np.log1p(st["n_train"].to_numpy(np.float32))
    out["difficulty"] = items["difficulty"].to_numpy()[a["item"].to_numpy()].astype(np.float32)

    for graph in graphs:
        n_nb, c_nb = neighbour_counts(a, graph, naive)
        out[f"n_nb_{graph.name}"] = np.log1p(n_nb)
        out[f"acc_nb_{graph.name}"] = _smoothed(pd.Series(c_nb), pd.Series(n_nb), 0.7, 2.0)
    return out


def _smoothed(correct: pd.Series, n: pd.Series, prior: float, strength: float) -> np.ndarray:
    c = np.asarray(correct, dtype=np.float32)
    m = np.asarray(n, dtype=np.float32)
    return (c + prior * strength) / (m + strength)


def neighbour_counts(a: pd.DataFrame, graph: Graph, naive: bool) -> tuple[np.ndarray, np.ndarray]:
    """Attempts and corrects on N(i) before each row (earlier buckets only;
    with `naive`, also earlier rows of the same bucket)."""
    adj_t = graph.adj.T.tocsr()  # j -> items i it informs
    if naive:
        g = a[["user", "ts", "item", "correct"]].assign(one=1, seq=np.arange(len(a)))
    else:
        g = (a.groupby(["user", "ts", "item"], sort=False)
               .agg(one=("correct", "size"), correct=("correct", "sum")).reset_index())  # fmt: skip
        g["seq"] = np.arange(len(g))
    # expand every (user, time, j) event into one contribution per informed item i
    deg = np.diff(adj_t.indptr)[g["item"].to_numpy()]
    src = np.repeat(np.arange(len(g)), deg)
    starts = adj_t.indptr[g["item"].to_numpy()]
    targets = adj_t.indices[np.repeat(starts - np.cumsum(deg) + deg, deg) + np.arange(deg.sum())]
    ev = pd.DataFrame({"user": g["user"].to_numpy()[src], "item": targets.astype(np.int32),
                       "time": g["seq"].to_numpy()[src] if naive else g["ts"].to_numpy()[src],
                       "one": g["one"].to_numpy()[src], "correct": g["correct"].to_numpy()[src], "q": 0})  # fmt: skip
    q = pd.DataFrame({"user": a["user"].to_numpy(), "item": a["item"].to_numpy().astype(np.int32),
                      "time": np.arange(len(a)) if naive else a["ts"].to_numpy(),
                      "one": 0, "correct": 0, "q": 1, "row": np.arange(len(a))})  # fmt: skip
    ev["row"] = -1
    allv = pd.concat([ev, q], ignore_index=True)
    # events strictly before the query: sort ties so queries come first
    allv = allv.sort_values(
        ["user", "item", "time", "q"], ascending=[True, True, True, False], kind="stable"
    )
    cum = allv.groupby(["user", "item"], sort=False)[["one", "correct"]].cumsum()
    is_q = allv["q"].to_numpy() == 1
    n_nb = np.empty(len(a), np.float32)
    c_nb = np.empty(len(a), np.float32)
    rows = allv["row"].to_numpy()[is_q]
    n_nb[rows] = cum["one"].to_numpy()[is_q]
    c_nb[rows] = cum["correct"].to_numpy()[is_q]
    return n_nb, c_nb


def item_stats(train: pd.DataFrame, n_items: int, prior_strength: float = 20.0) -> pd.DataFrame:
    """Smoothed log-odds of a correct answer per exercise, from training students."""
    n = np.bincount(train["item"], minlength=n_items).astype(np.float64)
    c = np.bincount(train["item"], weights=train["correct"], minlength=n_items)
    base = c.sum() / n.sum()
    p = (c + base * prior_strength) / (n + prior_strength)
    return pd.DataFrame({"item_logit": np.log(p / (1 - p)), "n_train": n})

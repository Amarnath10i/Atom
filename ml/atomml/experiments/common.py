"""Shared state for the experiments: data loaded once, cached features and
predictions, report writing."""

from __future__ import annotations

import logging
from functools import cache

import numpy as np
import pandas as pd

from atomml.config import settings
from atomml.data import junyi
from atomml.kt import features as F

log = logging.getLogger(__name__)
CACHE = settings.paths.cache


@cache
def data() -> junyi.Junyi:
    return junyi.load()


@cache
def arrays() -> dict[str, np.ndarray]:
    """Columns as contiguous arrays in (user, ts, item, session, number) order."""
    d = data()
    a = d.attempts
    user, item, ts = a["user"].to_numpy(), a["item"].to_numpy().astype(np.int64), a["ts"].to_numpy()
    new_user = np.r_[True, user[1:] != user[:-1]]
    new_bucket = new_user | np.r_[True, ts[1:] != ts[:-1]]
    new_group = new_bucket | np.r_[True, item[1:] != item[:-1]]
    split = d.split.to_numpy()[user]
    return {
        "user": user.astype(np.int64),
        "item": item,
        "topic": d.items["level4"].to_numpy()[item].astype(np.int64),
        "difficulty": d.items["difficulty"].to_numpy()[item].astype(np.int64),
        "correct": a["correct"].to_numpy().astype(np.int64),
        "days": ((ts - ts.min()) / np.timedelta64(1, "D")).astype(np.float64),
        "bucket": np.cumsum(new_bucket) - 1,
        "group": np.cumsum(new_group) - 1,
        # position of the attempt in the student's history (cold-start analysis)
        "position": a.groupby("user").cumcount().to_numpy(),
        "train": split == "train",
        "valid": split == "valid",
        "test": split == "test",
    }


@cache
def item_stats() -> pd.DataFrame:
    a = data().attempts
    return F.item_stats(a[arrays()["train"]], data().n_items)


def features(name: str = "strict", graphs: tuple = ()) -> pd.DataFrame:
    path = CACHE / f"features_{name}.parquet"
    if path.exists():
        return pd.read_parquet(path)
    log.info("building %s features", name)
    d = data()
    f = F.build(d.attempts, d.items, item_stats(), list(graphs), naive=name == "naive")
    f.to_parquet(path, index=False)
    return f


def save_pred(name: str, p: np.ndarray) -> None:
    (CACHE / "preds").mkdir(parents=True, exist_ok=True)
    np.save(CACHE / "preds" / f"{name}.npy", p.astype(np.float32))


def load_pred(name: str) -> np.ndarray | None:
    path = CACHE / "preds" / f"{name}.npy"
    return np.load(path) if path.exists() else None


def write_report(name: str, text: str) -> None:
    settings.paths.reports.mkdir(parents=True, exist_ok=True)
    (settings.paths.reports / f"{name}.md").write_text(text, encoding="utf-8")

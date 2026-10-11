"""Junyi Academy's public practice log: 16M attempts by 72k students.

Each row is one student answering one problem of one exercise ("content"),
with the exercise's place in a 4-level topic tree, its difficulty, whether the
answer was right, how long it took and whether hints were used. Those are the
same fields Atom's mock tests produce for a JEE/NEET question.

Two properties of the log decide what a model may look at:

* Several columns describe the attempt's outcome, not its context:
  `is_upgrade` / `is_downgrade` / `level` change *because* the answer was
  right or wrong, and the attempt's own time, retries and hints happen during
  it. They are only ever used as history of later attempts.
* Timestamps are rounded to 15 minutes. Inside one exercise session the order
  is known (`exercise_problem_repeat_session`, `problem_number`), but two
  different exercises answered in the same 15-minute bucket have no known
  order, so either could have come first. An attempt is `clean` when its
  student did nothing else in that bucket; for clean attempts every earlier
  row really is earlier, so metrics on them cannot be inflated by peeking.
  Headline numbers are reported on clean attempts, and all attempts as well.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

from atomml.config import settings

log = logging.getLogger(__name__)

RAW = settings.paths.raw / "junyi"
DIFFICULTY = {"easy": 0, "normal": 1, "hard": 2, "unset": 1}


@dataclass
class Junyi:
    attempts: pd.DataFrame  # one row per attempt, sorted by (user, order)
    items: pd.DataFrame  # one row per exercise (content), indexed by its code
    split: pd.Series  # user code -> "train" | "valid" | "test"

    @property
    def n_items(self) -> int:
        return len(self.items)


def _read_log() -> pd.DataFrame:
    log.info("reading Log_Problem.csv (16M rows)")
    cols = ["timestamp_TW", "uuid", "ucid", "upid", "problem_number",
            "exercise_problem_repeat_session", "is_correct", "total_sec_taken",
            "total_attempt_cnt", "used_hint_cnt"]  # fmt: skip
    df = pd.read_csv(RAW / "Log_Problem.csv", usecols=cols, engine="pyarrow")
    df["ts"] = pd.to_datetime(df["timestamp_TW"].str.removesuffix(" UTC"), format="%Y-%m-%d %H:%M:%S")
    return df.drop(columns="timestamp_TW")


def load() -> Junyi:
    cache = settings.paths.cache
    files = {name: cache / f"junyi_{name}.parquet" for name in ("attempts", "items", "split")}
    if all(f.exists() for f in files.values()):
        split = pd.read_parquet(files["split"])["split"]
        return Junyi(pd.read_parquet(files["attempts"]), pd.read_parquet(files["items"]), split)

    content = pd.read_csv(RAW / "Info_Content.csv")
    content = content[content["content_kind"] == "Exercise"].reset_index(drop=True)
    items = pd.DataFrame(
        {
            "ucid": content["ucid"],
            "name": content["content_pretty_name"],
            "difficulty": content["difficulty"].map(DIFFICULTY).fillna(1).astype("int8"),
            "stage": content["learning_stage"],
            # topic tree: level1 (broadest) .. level4 (finest group of exercises)
            **{f"level{k}": pd.factorize(content[f"level{k}_id"])[0].astype("int32") for k in (1, 2, 3, 4)},
        }
    )
    items.index.name = "item"

    df = _read_log()
    item_of = pd.Series(items.index.to_numpy(), index=items["ucid"])
    df = df[df["ucid"].isin(item_of.index)]
    users, user_codes = pd.factorize(df["uuid"])
    a = pd.DataFrame(
        {
            "user": users.astype("int32"),
            "item": item_of.loc[df["ucid"].to_numpy()].to_numpy().astype("int16"),
            "problem": pd.factorize(df["upid"])[0].astype("int32"),
            "ts": df["ts"].to_numpy(),
            "session": df["exercise_problem_repeat_session"].fillna(0).astype("int32").to_numpy(),
            "number": df["problem_number"].fillna(0).astype("int32").to_numpy(),
            "correct": df["is_correct"].astype("int8").to_numpy(),
            # outcome-side columns: history only, never features of their own row
            "sec": df["total_sec_taken"].fillna(0).clip(0, 3600).astype("int32").to_numpy(),
            "tries": df["total_attempt_cnt"].fillna(1).clip(1, 50).astype("int16").to_numpy(),
            "hints": df["used_hint_cnt"].fillna(0).clip(0, 50).astype("int16").to_numpy(),
        }
    )
    # Known order inside a student's 15-minute bucket only within one exercise
    # session; across exercises in the same bucket the order is arbitrary.
    a = a.sort_values(["user", "ts", "item", "session", "number"], kind="stable", ignore_index=True)
    items_in_bucket = a.groupby(["user", "ts"])["item"].transform("nunique")
    a["clean"] = (items_in_bucket == 1).to_numpy()

    rng = np.random.default_rng(settings.protocol.seed)
    p = settings.protocol
    u = rng.random(len(user_codes))
    split = pd.Series(
        np.where(u < p.train_share, "train", np.where(u < p.train_share + p.valid_share, "valid", "test")),
        name="split",
    )
    split.index.name = "user"

    cache.mkdir(parents=True, exist_ok=True)
    a.to_parquet(files["attempts"], index=False)
    items.to_parquet(files["items"])
    split.to_frame().to_parquet(files["split"])
    log.info("junyi: %d attempts, %d users, %d exercises, %.1f%% clean",
             len(a), len(user_codes), len(items), 100 * a["clean"].mean())  # fmt: skip
    return Junyi(a, items, split)

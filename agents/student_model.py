"""Learned student model: how likely is this student to answer a question on
a topic correctly if asked now, and when should the topic be reviewed?

Replaces the hand-set mastery rule (+0.05 / -0.08 / -0.18 per mock-test topic)
and recall curve (exp(-days / (1.5 + 2 * reviews + 3))). The model is a
LightGBM classifier trained offline in ml/ (`uv run atomml export`) on Junyi
Academy's 16M maths practice attempts, using only the signals Atom records,
and evaluated on 14k students it never saw: ml/reports/knowledge_tracing.md.
It is served here with NumPy (trees.py). The review schedule comes from a
half-life regression fitted on Duolingo's scheduled reviews, which reproduces
the published results; on self-paced maths practice forgetting cannot be
measured cleanly, because students choose when to return (ml/reports/memory.md).

A Junyi exercise is a skill practised through many different problems, as an
Atom topic is practised through many generated questions; Junyi's level-4
topic group plays the part of Atom's exam unit. Every feature below must mean
exactly what it meant in training (ml/atomml/kt/features.py, "atom" set);
ml/tests/test_student_model.py checks that row by row.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np

from .trees import TreeEnsemble

MODEL_DIR = Path(__file__).resolve().parent / "models"
FEATURES = [
    "n_in_session", "acc_in_session", "n_item", "acc_item", "n_topic", "acc_topic", "n_all",
    "acc_all", "mean_log_sec", "last_correct", "last_log_sec", "log_days_item", "difficulty",
]  # fmt: skip
PRIOR, STRENGTH, STRENGTH_ALL = 0.7, 2.0, 5.0  # smoothing used in training
BUCKET = timedelta(minutes=15)  # training timestamps are 15-minute buckets
MIN_HALF_LIFE, MAX_HALF_LIFE = 15 / (24 * 60), 274.0
TARGET_RECALL = 0.9


@dataclass(frozen=True)
class Attempt:
    topic: str
    correct: bool
    at: datetime
    unit: str | None = None
    difficulty: int = 3  # Atom's 1..5
    time_sec: float = 0.0


def difficulty_level(d: int) -> float:
    """Atom's 1-5 onto Junyi's easy / normal / hard."""
    return 0.0 if d <= 2 else 1.0 if d == 3 else 2.0


def _bucket(t: datetime) -> datetime:
    t = t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    return epoch + (t - epoch) // BUCKET * BUCKET


def _log_sec(a: Attempt) -> float:
    return math.log1p(int(min(max(a.time_sec, 0.0), 3600.0)))


def _acc(c: float, n: float, strength: float = STRENGTH) -> float:
    return (c + PRIOR * strength) / (n + strength)


def features(earlier: list[Attempt], session: list[Attempt], topic: str, unit: str | None,
             difficulty: int, now: datetime) -> np.ndarray:  # fmt: skip
    """Features for one question.

    earlier: the student's attempts in earlier 15-minute buckets, any topic.
    session: their attempts on this same topic earlier in the current bucket.
    For "mastery now" pass every past attempt as `earlier` and no session.
    """
    on_topic = [a for a in earlier if a.topic == topic] + list(session)
    in_unit = [a for a in earlier if unit is not None and a.unit == unit and a.topic != topic]
    n_all = len(earlier) + len(session)
    c_all = sum(a.correct for a in earlier) + sum(a.correct for a in session)
    log_sec = sum(_log_sec(a) for a in earlier) + sum(_log_sec(a) for a in session)
    last = on_topic[-1] if on_topic else None
    gap = (_bucket(now) - _bucket(last.at)).total_seconds() / 86400 if last else None
    n_item, c_item = len(on_topic), sum(a.correct for a in on_topic)
    n_sess, c_sess = len(session), sum(a.correct for a in session)
    n_unit, c_unit = len(in_unit), sum(a.correct for a in in_unit)
    return np.array([
        n_sess, _acc(c_sess, n_sess),
        math.log1p(n_item), _acc(c_item, n_item),
        math.log1p(n_unit), _acc(c_unit, n_unit),
        math.log1p(n_all), _acc(c_all, n_all, STRENGTH_ALL),
        log_sec / max(n_all, 1),
        float(last.correct) if last else -1.0,
        _log_sec(last) if last else -1.0,
        math.log1p(max(gap, 0.0)) if last else -1.0,
        difficulty_level(difficulty),
    ], dtype=np.float32)  # fmt: skip


class StudentModel:
    def __init__(self, meta: dict, trees: TreeEnsemble) -> None:
        if meta["features"] != FEATURES:
            raise ValueError("model was trained with different features; re-export from ml/")
        if meta["smoothing"] != {"prior": PRIOR, "strength": STRENGTH, "strength_all": STRENGTH_ALL}:
            raise ValueError("feature smoothing differs from training; re-export from ml/")
        self.meta = meta
        self.trees = trees
        self.theta = np.array(meta["half_life"]["theta"])

    @classmethod
    def load(cls, directory: Path = MODEL_DIR) -> StudentModel:
        meta = json.loads((Path(directory) / "student_model.json").read_text(encoding="utf-8"))
        with np.load(Path(directory) / "student_model.npz") as z:
            trees = TreeEnsemble.from_arrays({k: z[k] for k in z.files}, meta["features"])
        return cls(meta, trees)

    def predict(self, x: np.ndarray) -> np.ndarray:
        return 1.0 / (1.0 + np.exp(-self.trees.predict(np.atleast_2d(x))))

    def half_life_days(self, right: int, wrong: int) -> float:
        z = self.theta @ np.array([1.0, math.sqrt(1 + right), math.sqrt(1 + wrong)])
        return float(np.clip(2.0**z, MIN_HALF_LIFE, MAX_HALF_LIFE))

    def mastery(self, history: list[Attempt], now: datetime | None = None) -> dict[str, dict]:
        """Per practised topic: chance of a right answer to a medium question now,
        and when recall is predicted to fall to 90%."""
        now = now or datetime.now(timezone.utc)
        past = sorted((a for a in history if _bucket(a.at) < _bucket(now)), key=lambda a: a.at)
        topics: dict[str, str | None] = {}
        for a in past:
            topics[a.topic] = a.unit
        if not topics:
            return {}
        x = np.stack([features(past, [], t, u, 3, now) for t, u in topics.items()])
        p = self.predict(x)
        out = {}
        for (topic, unit), prob in zip(topics.items(), p, strict=True):
            mine = [a for a in past if a.topic == topic]
            right = sum(a.correct for a in mine)
            h = self.half_life_days(right, len(mine) - right)
            since = (now - mine[-1].at).total_seconds() / 86400
            out[topic] = {
                "unit": unit,
                "mastery": round(float(prob), 4),
                "attempts": len(mine),
                "accuracy": round(right / len(mine), 4),
                "recall": round(2.0 ** (-max(since, 0.0) / h), 4),
                "half_life_days": round(h, 2),
                "review_in_days": round(max(0.0, -h * math.log2(TARGET_RECALL) - since), 2),
            }
        return out


@lru_cache(maxsize=1)
def model() -> StudentModel | None:
    try:
        return StudentModel.load()
    except FileNotFoundError:
        return None

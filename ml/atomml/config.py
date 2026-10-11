"""Paths and evaluation settings, in one place."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
REPO = ML.parent


@dataclass(frozen=True)
class Paths:
    raw: Path = ML / "data" / "raw"
    cache: Path = ML / "data" / "cache"
    reports: Path = ML / "reports"
    export: Path = REPO / "agents" / "models"


@dataclass(frozen=True)
class Protocol:
    """Knowledge tracing is evaluated on students the models never saw.

    Students are split at random (70% train, 10% validation for model
    selection and early stopping, 20% test). Every attempt of a test student
    is predicted from that student's earlier attempts only, which is exactly
    Atom's situation: a new student arrives with no history.
    """

    train_share: float = 0.7
    valid_share: float = 0.1
    seed: int = 42
    n_boot: int = 500


@dataclass(frozen=True)
class Settings:
    paths: Paths = field(default_factory=Paths)
    protocol: Protocol = field(default_factory=Protocol)


settings = Settings()

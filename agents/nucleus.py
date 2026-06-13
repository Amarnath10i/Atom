"""Nucleus / Atomic Shell memory.

User message → nucleus_text → 384-d embedding → cosine search →
shells of related atoms → bonds at sim >= BOND_MIN_SIM → semantic_mass,
recency, gravity computed and persisted.

This module is pure-Python (numpy) — no FAISS required, fits hackathon scope.
Bonds are persisted by the caller (TypeScript layer) using the returned plan."""
from __future__ import annotations
import math
from datetime import datetime, timezone
from typing import Any
import numpy as np
from . import llm

BOND_MIN_SIM = 0.65
DECAY = 0.97
INNER, MIDDLE, OUTER = 0.75, 0.55, 0.40


def _vec(v) -> np.ndarray:
    if v is None:
        return np.zeros(384, dtype="float32")
    if isinstance(v, str):
        import json
        try: v = json.loads(v)
        except Exception: return np.zeros(384, dtype="float32")
    a = np.array(v, dtype="float32")
    if a.size < 384:
        a = np.concatenate([a, np.zeros(384 - a.size, dtype="float32")])
    n = float(np.linalg.norm(a)) or 1.0
    return a / n


def _age_days(iso: Any) -> float:
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        # Normalise naive datetimes to UTC so subtraction below never raises.
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 86400.0)
    except Exception:
        return 0.0


def ingest(nucleus_text: str, atoms: list[dict]) -> dict[str, Any]:
    """Embed the new nucleus, find shells + bond plan."""
    nv = np.array(llm.embed(nucleus_text), dtype="float32")
    n = float(np.linalg.norm(nv)) or 1.0
    nv = nv / n
    inner, middle, outer, bonds = [], [], [], []
    for a in atoms:
        av = _vec(a.get("nucleus_vector"))
        sim = float(nv @ av)
        if sim >= INNER:    inner.append({"id": a["id"], "sim": sim, "topic": a.get("topic")})
        elif sim >= MIDDLE: middle.append({"id": a["id"], "sim": sim, "topic": a.get("topic")})
        elif sim >= OUTER:  outer.append({"id": a["id"], "sim": sim, "topic": a.get("topic")})
        if sim >= BOND_MIN_SIM:
            bonds.append({"target_atom": a["id"], "weight": round(sim, 3)})
    for arr in (inner, middle, outer):
        arr.sort(key=lambda x: -x["sim"])
    semantic_mass = round(0.3 + 0.7 * (1 - math.exp(-len(bonds) / 5.0)), 3)
    gravity = round(0.6 * semantic_mass + 0.4 * 1.0, 3)  # fresh atom → recency=1
    return {
        "nucleus_vector": nv.tolist(),
        "shells": {"inner": inner[:6], "middle": middle[:10], "outer": outer[:14]},
        "bonds": bonds,
        "semantic_mass": semantic_mass,
        "recency": 1.0,
        "gravity": gravity,
    }


def search(query: str, atoms: list[dict], k: int = 8) -> list[dict]:
    qv = np.array(llm.embed(query), dtype="float32")
    qv = qv / (float(np.linalg.norm(qv)) or 1.0)
    out = []
    for a in atoms:
        av = _vec(a.get("nucleus_vector"))
        sim = float(qv @ av)
        out.append({"id": a["id"], "topic": a.get("topic"), "subject": a.get("subject"),
                    "sim": round(sim, 3), "gravity": a.get("gravity")})
    out.sort(key=lambda x: -x["sim"])
    return out[:k]


def decay(atoms: list[dict]) -> list[dict]:
    """Apply recency decay each session and recompute gravity."""
    updates = []
    for a in atoms:
        days = _age_days(a.get("last_reviewed"))
        recency = max(0.05, (DECAY ** days))
        mass = a.get("semantic_mass") or 0.5
        gravity = round(0.6 * mass + 0.4 * recency, 3)
        updates.append({
            "id": a["id"],
            "recency": round(recency, 3),
            "gravity": gravity,
        })
    return updates

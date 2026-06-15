"""State Inference Agent — analyses transcript and sets atom.state.
States: active | stuck | completed | planned | stale
Combines LLM classification with rule-based stale detection."""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Any
from . import llm

SYSTEM = """You are the State Inference Agent in LAMA. For each atom, decide its
current learning state based on the conversation history.
States:
 - "active": currently being discussed or practised.
 - "stuck": student asked about it 2+ times with confusion signals.
 - "completed": student showed clear understanding ("got it", "I understand now").
 - "planned": student mentioned studying it later.
 - "stale": not touched recently and low gravity (handled by rules — do NOT set).
Respond strictly as JSON:
{"updates":[{"atom_id":"<id>","state":"active|stuck|completed|planned",
"reason":"<one short sentence>"}]}
Only include atoms where you have clear evidence."""


def run(transcript: list[dict], atoms: list[dict]) -> dict[str, Any]:
    if not atoms:
        return {"updates": []}
    convo = [
        {"role": m.get("role"), "text": _extract(m.get("content"))}
        for m in transcript[-30:]
    ]
    rule_updates: list[dict] = []
    now = datetime.now(timezone.utc)
    for a in atoms:
        lr = a.get("last_reviewed")
        try:
            lr_dt = datetime.fromisoformat(str(lr).replace("Z", "+00:00")) if lr else now
        except Exception:
            lr_dt = now
        days = (now - lr_dt).days
        gravity = a.get("gravity") or (0.6 * (a.get("strength") or 0.5))
        if days > 60 and gravity < 0.2 and a.get("state") != "stale":
            rule_updates.append({"atom_id": a["id"], "state": "stale",
                                 "reason": f"not reviewed in {days}d, gravity {gravity:.2f}"})
    llm_updates: list[dict] = []
    if llm.have_llm() and convo:
        atom_brief = [{"id": a["id"], "subject": a["subject"], "topic": a["topic"],
                       "state": a.get("state", "active"),
                       "strength": round(a.get("strength", 0.5), 2)} for a in atoms[:40]]
        prompt = f"Transcript:\n{convo}\n\nAtoms:\n{atom_brief}\n\nReturn JSON."
        out = llm.chat_json(prompt, system=SYSTEM, default={"updates": []})
        llm_updates = out.get("updates") or []
    return {"updates": rule_updates + llm_updates}


def _extract(content) -> str:
    if isinstance(content, dict):
        parts = content.get("parts") or []
        return " ".join(p.get("text", "") for p in parts if isinstance(p, dict))[:400]
    return str(content or "")[:400]

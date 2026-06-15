"""Diagnostic Agent — analyses recent transcript + atom strengths to flag weak topics."""
from __future__ import annotations
from typing import Any
from . import llm

SYSTEM = """You are the Diagnostic Agent in LAMA. Given a JEE/NEET student's recent
chat transcript and current memory atoms, identify the topics where the student
shows confusion, repeated questions, or low recall.
Respond strictly as JSON:
{"weak_topics":[{"subject":"Physics|Chemistry|Maths|Biology","topic":"<short topic>",
"severity":0.0-1.0,"evidence":"<one short sentence>"}]}
Limit to the top 5 most actionable weaknesses."""


def run(transcript: list[dict], atoms: list[dict]) -> dict[str, Any]:
    if not llm.have_llm():
        return {"weak_topics": [], "note": "no LLM key"}
    convo = [
        {"role": m.get("role"), "text": _extract(m.get("content"))}
        for m in transcript[-40:]
    ]
    atom_brief = [
        {"subject": a["subject"], "topic": a["topic"],
         "strength": round(a.get("strength", 0.5), 2)}
        for a in atoms[:40]
    ]
    prompt = f"Transcript (latest first cleared):\n{convo}\n\nAtoms:\n{atom_brief}\n\nReturn JSON."
    out = llm.chat_json(prompt, system=SYSTEM, default={"weak_topics": []})
    out.setdefault("weak_topics", [])
    return out


def _extract(content) -> str:
    if isinstance(content, dict):
        parts = content.get("parts") or []
        return " ".join(p.get("text", "") for p in parts if isinstance(p, dict))[:400]
    return str(content or "")[:400]

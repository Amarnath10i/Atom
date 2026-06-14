"""Curator Agent — cleans, merges, prunes atoms; proposes new bonds.
Powered by Claude (or Gemini fallback). All keys read from .env."""
from __future__ import annotations
from typing import Any
from . import llm

SYSTEM = """You are the Curator Agent in LAMA (Layered Atomic Memory Architecture).
You receive a list of memory atoms for a JEE/NEET student and must:
 1. Identify duplicate or near-duplicate atoms to MERGE.
 2. Identify stale atoms (low strength, not reviewed in 60+ days) to PRUNE.
 3. Propose new BONDS between atoms in the same subject when topics are related.
Respond strictly as JSON: {"merges":[{"keep":"<id>","drop":"<id>","reason":"..."}],
"prunes":[{"id":"<id>","reason":"..."}],
"bonds":[{"source":"<id>","target":"<id>","relation":"prerequisite|related|application","weight":0.0-1.0,"reason":"..."}]}
Be conservative — only act when you are >80% confident."""


def run(atoms: list[dict]) -> dict[str, Any]:
    if not atoms:
        return {"merges": [], "prunes": [], "bonds": [], "note": "no atoms"}
    payload = [
        {"id": a["id"], "subject": a["subject"], "topic": a["topic"],
         "summary": a["summary"][:200], "strength": round(a.get("strength", 0.5), 2),
         "reviews": a.get("reviews", 0),
         "last_reviewed": str(a.get("last_reviewed", ""))[:10]}
        for a in atoms[:60]
    ]
    prompt = f"Atoms:\n{payload}\n\nReturn the JSON plan."
    if not llm.have_llm():
        return {"merges": [], "prunes": [], "bonds": [], "note": "no LLM key"}
    out = llm.chat_json(prompt, system=SYSTEM,
                       default={"merges": [], "prunes": [], "bonds": []})
    out.setdefault("merges", []); out.setdefault("prunes", []); out.setdefault("bonds", [])
    return out

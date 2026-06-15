"""Planner Agent — generates a personalised 6-week study schedule from weak topics."""
from __future__ import annotations
from typing import Any
from . import llm

SYSTEM = """You are the Planner Agent in LAMA. Given a student's exam (JEE or NEET),
weak topics, and current plan progress, generate a fresh 6-week study plan.
Each item targets ONE topic with ONE concrete activity per week.
Respond strictly as JSON:
{"plan":[{"week":1-6,"subject":"...","topic":"...","activity":"<one sentence task>",
"priority":"high|medium|low"}]}
Aim for 8-15 items total. Front-load the highest-severity weaknesses to weeks 1-2."""


def run(exam: str, weak: list[dict], current_plan: list[dict]) -> dict[str, Any]:
    if not llm.have_llm():
        return {"plan": [], "note": "no LLM key"}
    prompt = (f"Exam: {exam}\nWeak topics: {weak[:10]}\n"
              f"Current plan progress: "
              f"{[{'week':p.get('week'),'topic':p.get('topic'),'status':p.get('status')} for p in current_plan[:20]]}\n\n"
              "Return JSON.")
    out = llm.chat_json(prompt, system=SYSTEM, default={"plan": []})
    out.setdefault("plan", [])
    return out

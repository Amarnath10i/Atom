"""AI-Powered Question Generation Agent for LAMA.

Generated questions feed mock tests, and mock-test answers are the labels the
learned student model (student_model.py) reads: a wrong answer key marks a
student who answered correctly as wrong. So each generated question is checked
before use. The model solves it again `QUESTION_VERIFY_K` times (default 3) in a
fresh context, without the key or the explanation, and the question is kept
only if a majority of those solves agree with its key. ml/reports/keys.md
measures how often keys are wrong and how much this check removes.
"""
from __future__ import annotations

import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import llm

SYSTEM = """You are an expert JEE/NEET faculty member. Generate high-quality, NCERT-aligned multiple choice questions.
The questions must be conceptually sound, mathematically rigorous (use LaTeX for math), and test deep understanding, not just rote memorization.
For each question, provide 4 options (A, B, C, D), specify the correct option, and write a clear, step-by-step explanation.

Return STRICTLY JSON matching this schema:
{"questions": [
  {
    "id": "generated-<uuid>",
    "subject": "Physics|Chemistry|Maths|Biology",
    "topic": "topic name",
    "subtopic": "subtopic name",
    "difficulty": 1-5,
    "expectedTimeSec": 60-180,
    "question": "The question text with LaTeX...",
    "options": [
      {"key": "A", "text": "Option A text"},
      {"key": "B", "text": "Option B text"},
      {"key": "C", "text": "Option C text"},
      {"key": "D", "text": "Option D text"}
    ],
    "correct": "A|B|C|D",
    "explanation": "Step-by-step solution..."
  }
]}
"""

SOLVER_SYSTEM = "You are a careful JEE/NEET problem solver. Work the problem out yourself before choosing."


def prompt_for(subject: str, topics: list[str], difficulty_range: list[int], count: int) -> str:
    return f"""Generate {count} distinct MCQ(s) for the subject '{subject}'.
Focus on these topics: {topics}.
Target difficulty level(s) (1-5): {difficulty_range}.
Ensure the questions are unique and do not overlap conceptually with standard textbook examples.
"""


def solve_prompt(q: dict) -> str:
    options = "\n".join(f"({o.get('key')}) {o.get('text')}" for o in q.get("options", []))
    return (
        "Solve this multiple-choice question. Exactly one option is correct.\n\n"
        f"{q.get('question', '')}\n\n{options}\n\n"
        "End with a final line of the form 'Final Answer: <letter>'."
    )


def parse_letter(text: str) -> str | None:
    """The chosen option: the last 'Final Answer: X', else the last boxed letter."""
    m = re.findall(r"final answer[\s*_`]*[:：][\s*_`(]*([ABCD])\b", text, flags=re.IGNORECASE)
    if m:
        return m[-1].upper()
    start = text.rfind("boxed{")
    if start < 0:
        return None
    depth, i = 1, start + len("boxed{")
    for j in range(i, len(text)):  # the boxed content may nest braces: boxed{text{(A)}}
        depth += {"{": 1, "}": -1}.get(text[j], 0)
        if depth == 0:
            letters = re.findall(r"\b([ABCD])\b", text[i:j])
            return letters[-1] if letters else None
    return None


def well_formed(q: Any) -> bool:
    keys = [o.get("key") for o in q.get("options", []) if isinstance(o, dict)] if isinstance(q, dict) else []
    return sorted(keys) == ["A", "B", "C", "D"] and q.get("correct") in keys and bool(q.get("question"))


def verify(q: dict, k: int) -> dict[str, Any]:
    """k independent solves without the key; how many agree with it."""
    with ThreadPoolExecutor(max_workers=k) as pool:
        answers = list(pool.map(lambda _: parse_letter(llm.chat(solve_prompt(q), system=SOLVER_SYSTEM)), range(k)))
    return {"k": k, "answers": answers, "agree": sum(a == q.get("correct") for a in answers)}


def generate(subject: str, topics: list[str], difficulty_range: list[int], count: int = 3,
             exclude_ids: list[str] | None = None, verify_k: int | None = None) -> dict[str, Any]:
    if not llm.have_llm():
        return {"questions": []}

    out = llm.chat_json(prompt_for(subject, topics, difficulty_range, count), system=SYSTEM,
                        default={"questions": []})
    questions = [q for q in out.get("questions", []) if well_formed(q)]
    for q in questions:
        if "id" not in q or not str(q["id"]).startswith("generated-"):
            q["id"] = f"generated-{uuid.uuid4().hex[:8]}"

    k = int(os.getenv("QUESTION_VERIFY_K", "3")) if verify_k is None else verify_k
    if k <= 0:
        return {"questions": questions, "dropped": 0}
    kept = []
    for q in questions:
        try:
            q["verification"] = verify(q, k)
        except Exception as e:  # a failed check must not block the paper: keep, marked unverified
            q["verification"] = {"k": k, "error": str(e)}
            kept.append(q)
            continue
        if 2 * q["verification"]["agree"] > k:
            kept.append(q)
    return {"questions": kept, "dropped": len(questions) - len(kept)}

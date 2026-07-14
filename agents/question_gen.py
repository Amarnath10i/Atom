"""AI-Powered Question Generation Agent for LAMA."""
from __future__ import annotations
from typing import Any
import uuid
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

def generate(subject: str, topics: list[str], difficulty_range: list[int], count: int = 3, exclude_ids: list[str] = None) -> dict[str, Any]:
    if not llm.have_llm():
        return {"questions": []}
    
    prompt = f"""Generate {count} distinct MCQ(s) for the subject '{subject}'.
Focus on these topics: {topics}.
Target difficulty level(s) (1-5): {difficulty_range}.
Ensure the questions are unique and do not overlap conceptually with standard textbook examples.
"""
    
    out = llm.chat_json(prompt, system=SYSTEM, default={"questions": []})
    
    # Ensure IDs are set and valid
    questions = out.get("questions", [])
    for q in questions:
        if "id" not in q or not str(q["id"]).startswith("generated-"):
            q["id"] = f"generated-{uuid.uuid4().hex[:8]}"
            
    return {"questions": questions}

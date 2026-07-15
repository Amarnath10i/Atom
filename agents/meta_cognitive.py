"""Meta-Cognitive Agent — predicts user intents and validates them using reinforcement learning principles."""
from __future__ import annotations
from typing import Any
from . import llm
import uuid

PREDICT_SYSTEM = """You are the Meta-Cognitive Agent in LAMA. Your job is to predict the student's NEXT interaction based on the current transcript and their known thinking patterns.
Given the transcript and their current pattern_atoms, predict exactly 1 thing the student is likely to struggle with or ask next.
Identify if this prediction relates to an existing pattern_atom (by providing its pattern_type) or if it's a new pattern (leave related_pattern_type empty).
Respond STRICTLY as JSON:
{"prediction": {"predicted_intent": "...", "related_pattern_type": "..."}}
"""

EVALUATE_SYSTEM = """You are the Meta-Cognitive Agent in LAMA. You previously made a prediction about what the student would say or struggle with next.
Now you have the student's ACTUAL new message.
Compare the "predicted_intent" with the "actual_message". 
Respond STRICTLY as JSON:
{"status": "correct"} if the student's message strongly matches the prediction (they asked what you thought, or made the mistake you predicted).
{"status": "incorrect"} if the student went in a completely different direction or the prediction was wrong.
{"status": "ignored"} if there is not enough information to judge.
"""

def predict(transcript: list[dict], patterns: list[dict]) -> dict[str, Any]:
    if not llm.have_llm() or not transcript:
        return {"prediction": None}
        
    convo = [
        {"role": m.get("role"), "text": str(m.get("content", ""))[:400]}
        for m in transcript[-20:]
    ]
    pattern_brief = [{"type": p["pattern_type"], "desc": p["description"], "conf": p["confidence"]} for p in patterns]
    
    prompt = f"Transcript:\n{convo}\n\nCurrent Patterns:\n{pattern_brief}\n\nReturn JSON prediction."
    out = llm.chat_json(prompt, system=PREDICT_SYSTEM, default={"prediction": None})
    return out

def evaluate(actual_message: str, predicted_intent: str) -> dict[str, Any]:
    if not llm.have_llm() or not actual_message or not predicted_intent:
        return {"status": "ignored"}
        
    prompt = f"Prediction made: {predicted_intent}\nActual user message: {actual_message}\n\nEvaluate and return JSON status."
    out = llm.chat_json(prompt, system=EVALUATE_SYSTEM, default={"status": "ignored"})
    return out

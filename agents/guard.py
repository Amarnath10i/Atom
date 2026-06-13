"""Safety / topic guardrails. Real NeMo Guardrails if installed + SAFETY_MODE=nemo,
otherwise built-in regex pass. Both return the same shape."""
from __future__ import annotations
import os, re
from typing import Literal, TypedDict

SAFETY_MODE = os.getenv("SAFETY_MODE", "builtin").lower()

HARMFUL_RE = re.compile(
    r"\b(suicide|kill (myself|him|her|yourself)|self[- ]harm|bomb|weapon|explosiv|poison recipe)\b",
    re.I,
)
OFFTOPIC_RE = re.compile(
    r"\b(politics|election|stock tip|crypto pump|adult|nsfw|gambling)\b", re.I,
)
HELPLINE = "iCall: 9152987821 · Vandrevala Foundation: 1860-2662-345"

class GuardResult(TypedDict):
    allowed: bool
    reason: str
    category: Literal["safe", "self_harm", "violence", "off_topic", "blocked"]
    helpline: str | None
    mode: str

_nemo_rails = None

def _try_nemo():
    global _nemo_rails
    if _nemo_rails is not None:
        return _nemo_rails
    try:
        from nemoguardrails import LLMRails, RailsConfig
        cfg_path = os.path.join(os.path.dirname(__file__), "guardrails_config")
        config = RailsConfig.from_path(cfg_path)
        _nemo_rails = LLMRails(config)
        print("[guard] NeMo Guardrails active")
        return _nemo_rails
    except Exception as e:
        print(f"[guard] NeMo unavailable, using builtin: {e}")
        _nemo_rails = False
        return False


def check(text: str) -> GuardResult:
    if SAFETY_MODE == "nemo":
        rails = _try_nemo()
        if rails:
            try:
                res = rails.generate(messages=[{"role": "user", "content": text}])
                content = (res.get("content") if isinstance(res, dict) else getattr(res, "content", "")) or ""
                if "BLOCKED" in content.upper() or "I can't" in content:
                    return {"allowed": False, "reason": content[:300],
                            "category": "blocked", "helpline": HELPLINE, "mode": "nemo"}
                return {"allowed": True, "reason": "", "category": "safe",
                        "helpline": None, "mode": "nemo"}
            except Exception as e:
                print(f"[guard] nemo runtime error, falling back: {e}")
    # Built-in regex
    if HARMFUL_RE.search(text):
        return {"allowed": False,
                "reason": "Detected self-harm or violence language. Please reach out for help.",
                "category": "self_harm", "helpline": HELPLINE, "mode": "builtin"}
    if OFFTOPIC_RE.search(text):
        return {"allowed": False,
                "reason": "This tutor only covers JEE/NEET academic topics.",
                "category": "off_topic", "helpline": None, "mode": "builtin"}
    return {"allowed": True, "reason": "", "category": "safe",
            "helpline": None, "mode": "builtin"}



def guardrails_active() -> bool:
    """True iff NeMo Guardrails are configured AND loaded successfully.
    Used by /health and the chat prompt so we never overclaim safety."""
    if SAFETY_MODE != "nemo":
        return False
    return bool(_try_nemo())

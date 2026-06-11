"""Unified LLM wrapper. Uses Gemini if GEMINI_API_KEY present, else Claude.
Nothing hardcoded — all keys & model IDs from environment."""
from __future__ import annotations
import os, json, hashlib
from typing import Any

GEMINI_KEY = os.getenv("GEMINI_API_KEY")
CLAUDE_KEY = os.getenv("ANTHROPIC_API_KEY")
# Embeddings are semantically meaningful only when a real embedding model is
# available. Decouple it from the chat LLM key so projects running on Claude
# or NVIDIA Nemotron for chat can still use Gemini embeddings (or any future
# embedding backend) for the LAMA nucleus / shells / bonds / gravity graph.
EMBED_KEY = os.getenv("EMBEDDING_API_KEY") or os.getenv("GEMINI_EMBED_API_KEY") or GEMINI_KEY
EMBED_MODEL = os.getenv("EMBEDDING_MODEL", "models/text-embedding-004")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")

def embedding_provider() -> str:
    return "gemini" if EMBED_KEY else "hash-fallback"

def embeddings_real() -> bool:
    return bool(EMBED_KEY)


def have_llm() -> bool:
    return bool(GEMINI_KEY or CLAUDE_KEY)


def provider_name() -> str:
    return "gemini" if GEMINI_KEY else ("claude" if CLAUDE_KEY else "none")


def chat(prompt: str, system: str | None = None, json_mode: bool = False) -> str:
    """Return raw text. If json_mode, strip code fences before returning."""
    if GEMINI_KEY:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_KEY)
        model = genai.GenerativeModel(GEMINI_MODEL, system_instruction=system)
        cfg = {"response_mime_type": "application/json"} if json_mode else {}
        resp = model.generate_content(prompt, generation_config=cfg)
        text = (resp.text or "").strip()
    elif CLAUDE_KEY:
        import anthropic
        client = anthropic.Anthropic(api_key=CLAUDE_KEY)
        msg = client.messages.create(
            model=CLAUDE_MODEL, max_tokens=2048,
            system=system or "You are a helpful assistant.",
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in msg.content if hasattr(b, "text")).strip()
    else:
        raise RuntimeError("No LLM key configured (GEMINI_API_KEY or ANTHROPIC_API_KEY)")
    if json_mode:
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
            text = text.strip()
    return text


def chat_json(prompt: str, system: str | None = None, default: Any = None) -> Any:
    try:
        raw = chat(prompt, system=system, json_mode=True)
        return json.loads(raw)
    except Exception as e:
        print(f"[llm] json parse failed: {e}")
        return default


def embed(text: str, dim: int = 384) -> list[float]:
    """384-dim unit-length vector. Uses a real embedding model when
    EMBEDDING_API_KEY (or GEMINI_EMBED_API_KEY / GEMINI_API_KEY) is set;
    otherwise falls back to a deterministic hash so the system keeps running
    but the nucleus/shells/bonds graph degrades to non-semantic noise.
    Callers should check llm.embeddings_real() and surface the degradation."""
    if EMBED_KEY:
        try:
            import google.generativeai as genai
            genai.configure(api_key=EMBED_KEY)
            r = genai.embed_content(model=EMBED_MODEL, content=text)
            v = r["embedding"] if isinstance(r, dict) else r.embedding
            # Pad/truncate to dim and unit-normalise
            import numpy as np
            arr = np.array(v[:dim] + [0.0] * max(0, dim - len(v)), dtype="float32")
            n = float(np.linalg.norm(arr)) or 1.0
            return (arr / n).tolist()
        except Exception as e:
            print(f"[embed] gemini failed, using hash fallback: {e}")
    # Hash fallback — deterministic, unit norm
    import numpy as np
    seed = int(hashlib.sha256(text.encode()).hexdigest()[:16], 16) % (2**32)
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(dim).astype("float32")
    v /= float(np.linalg.norm(v)) or 1.0
    return v.tolist()

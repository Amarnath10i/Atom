"""Unified LLM wrapper — every call goes to Ollama's native API.

  OLLAMA_BASE_URL  http://localhost:11434 (default) or https://ollama.com for Ollama Cloud
  OLLAMA_API_KEY   required for Ollama Cloud, ignored by a local daemon
  OLLAMA_MODEL     chat model (default gpt-oss:120b)
  OLLAMA_EMBED_MODEL  optional embedding model (e.g. nomic-embed-text on a local
                   daemon). Ollama Cloud has no embedding models, so leave it
                   unset there and the nucleus graph uses the hash fallback.

Nothing hardcoded — all endpoints & model IDs from environment."""
from __future__ import annotations
import os, json, hashlib
from typing import Any

import httpx

BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
API_KEY = os.getenv("OLLAMA_API_KEY")
MODEL = os.getenv("OLLAMA_MODEL", "gpt-oss:120b")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL")
TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT_S", "60"))

# Flipped off after the first embedding failure so a missing model doesn't
# cost a round trip on every request.
_embed_ok = bool(EMBED_MODEL)


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}


def embedding_provider() -> str:
    return f"ollama:{EMBED_MODEL}" if _embed_ok else "hash-fallback"


def embeddings_real() -> bool:
    return _embed_ok


def have_llm() -> bool:
    # Ollama Cloud needs a key; a local daemon doesn't.
    return bool(API_KEY) or "ollama.com" not in BASE_URL


def provider_name() -> str:
    return f"ollama:{MODEL}" if have_llm() else "none"


def chat(prompt: str, system: str | None = None, json_mode: bool = False) -> str:
    """Return raw text. If json_mode, ask Ollama for JSON and strip code fences."""
    if not have_llm():
        raise RuntimeError("OLLAMA_BASE_URL is Ollama Cloud but OLLAMA_API_KEY is not set")
    messages = ([{"role": "system", "content": system}] if system else []) + [
        {"role": "user", "content": prompt}
    ]
    body: dict[str, Any] = {"model": MODEL, "messages": messages, "stream": False}
    if json_mode:
        body["format"] = "json"
    r = httpx.post(f"{BASE_URL}/api/chat", json=body, headers=_headers(), timeout=TIMEOUT)
    r.raise_for_status()
    text = (r.json().get("message", {}).get("content") or "").strip()
    if json_mode and text.startswith("```"):
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
        print(f"[llm] json call failed: {e}")
        return default


def embed(text: str, dim: int = 384) -> list[float]:
    """384-dim unit-length vector. Uses OLLAMA_EMBED_MODEL when it's set and
    working; otherwise falls back to a deterministic hash so the system keeps
    running but the nucleus/shells/bonds graph degrades to non-semantic noise.
    Callers should check llm.embeddings_real() and surface the degradation."""
    global _embed_ok
    import numpy as np
    if _embed_ok:
        try:
            r = httpx.post(f"{BASE_URL}/api/embed", json={"model": EMBED_MODEL, "input": text},
                           headers=_headers(), timeout=TIMEOUT)
            r.raise_for_status()
            v = r.json()["embeddings"][0]
            # Pad/truncate to dim and unit-normalise
            arr = np.array(v[:dim] + [0.0] * max(0, dim - len(v)), dtype="float32")
            n = float(np.linalg.norm(arr)) or 1.0
            return (arr / n).tolist()
        except Exception as e:
            print(f"[embed] ollama embedding failed, switching to hash fallback: {e}")
            _embed_ok = False
    # Hash fallback — deterministic, unit norm
    seed = int(hashlib.sha256(text.encode()).hexdigest()[:16], 16) % (2**32)
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(dim).astype("float32")
    v /= float(np.linalg.norm(v)) or 1.0
    return v.tolist()

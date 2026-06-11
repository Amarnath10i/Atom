"""LAMA Agents — FastAPI service.

Endpoints (all POST unless noted):
  GET  /health
  POST /guard           → safety + topic check
  POST /curator         → merge/prune/bond plan
  POST /diagnostic      → weak_topics
  POST /planner         → 6-week plan
  POST /state           → atom state inferences
  POST /nucleus/ingest  → embed + shells + bonds for one message
  POST /nucleus/search  → top-k similar atoms
  POST /nucleus/decay   → recency decay updates

Run:  uvicorn agents.main:app --host 0.0.0.0 --port 8787 --reload
"""
from __future__ import annotations
from typing import Any
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os

load_dotenv()  # pull .env from cwd (project root when run from there)
# Also try parent dir in case launched from agents/
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from . import guard, curator, diagnostic, planner, state_inference, nucleus, llm

app = FastAPI(title="LAMA Agents", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "llm": llm.provider_name(),
        "embeddings": llm.embedding_provider(),
        "embeddings_real": llm.embeddings_real(),
        "safety_mode": os.getenv("SAFETY_MODE", "builtin"),
        # True only when a real guardrails layer is actually wired up at runtime.
        "guardrails_active": guard.guardrails_active(),
    }


class GuardIn(BaseModel):
    text: str

@app.post("/guard")
def guard_ep(body: GuardIn):
    return guard.check(body.text)


class CuratorIn(BaseModel):
    atoms: list[dict]

@app.post("/curator")
def curator_ep(body: CuratorIn):
    return curator.run(body.atoms)


class DiagIn(BaseModel):
    transcript: list[dict]
    atoms: list[dict]

@app.post("/diagnostic")
def diag_ep(body: DiagIn):
    return diagnostic.run(body.transcript, body.atoms)


class PlanIn(BaseModel):
    exam: str
    weak: list[dict]
    current_plan: list[dict] = []

@app.post("/planner")
def planner_ep(body: PlanIn):
    return planner.run(body.exam, body.weak, body.current_plan)


class StateIn(BaseModel):
    transcript: list[dict]
    atoms: list[dict]

@app.post("/state")
def state_ep(body: StateIn):
    return state_inference.run(body.transcript, body.atoms)


class NucleusIngestIn(BaseModel):
    nucleus_text: str
    atoms: list[dict] = []

@app.post("/nucleus/ingest")
def nucleus_ingest_ep(body: NucleusIngestIn):
    return nucleus.ingest(body.nucleus_text, body.atoms)


class NucleusSearchIn(BaseModel):
    query: str
    atoms: list[dict]
    k: int = 8

@app.post("/nucleus/search")
def nucleus_search_ep(body: NucleusSearchIn):
    return {"hits": nucleus.search(body.query, body.atoms, body.k)}


class NucleusDecayIn(BaseModel):
    atoms: list[dict]

@app.post("/nucleus/decay")
def nucleus_decay_ep(body: NucleusDecayIn):
    return {"updates": nucleus.decay(body.atoms)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("agents.main:app", host="0.0.0.0", port=8787, reload=True)

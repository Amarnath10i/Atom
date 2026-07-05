# LAMA — Patch notes

## Bug fixes
1. **Agentic tool loop** — `src/routes/api/chat.ts` uses `ai-sdk v4`, where
   `maxSteps: 10` is the correct API. Added a comment warning that if/when the
   project upgrades to `ai-sdk v6`, this must become
   `stopWhen: stepCountIs(10)` imported from `"ai"` — never shimmed locally as
   `(n) => ({ maxSteps: n })`, because `stopWhen` expects
   `({ steps }) => boolean` and the shim crashes the loop the first time any
   tool (`diagnose_weakness`, `generate_practice`, `update_plan`,
   `reflect_session`) executes.
2. **`/nucleus/decay` 500 on naive datetimes** — `agents/nucleus.py::_age_days`
   now normalises naive ISO timestamps to UTC before subtracting from
   `datetime.now(timezone.utc)`.
3. **Embedding key decoupled from chat-LLM key** — `agents/llm.py` now reads
   `EMBEDDING_API_KEY` (or `GEMINI_EMBED_API_KEY`, then `GEMINI_API_KEY`) for
   embeddings, so projects on Claude / NVIDIA Nemotron for chat can still get
   semantically meaningful nucleus/shells/bonds/gravity. `/health` now reports
   `embeddings` and `embeddings_real` so the hash-fallback degradation is
   visible instead of silent.
4. **Honest safety prompt** — the chat system prompt no longer unconditionally
   claims "NemoGuard / NemoClaw guardrails on every reply". It now switches on
   `guard.mode`: `nemo` (real), `builtin` (regex — explicitly flagged as not a
   sole net), or degraded. `/health` exposes `guardrails_active` so the UI can
   reflect reality.
5. **Hybrid retrieval (recency + relevance)** — chat context now merges the
   most-recent atoms with `/nucleus/search` hits for the current message, so a
   relevant-but-stale atom isn't lost outside a recency window.

## Extensions
6. **Cross-topic synthesis** — `generate_practice` accepts an optional
   `pair_topic` (a known-strong topic) to produce explicit integration-style
   problems instead of single-topic drills.
7. **Structured gap taxonomy** — `diagnose_weakness` accepts optional
   `last_approach_tried` and `worked` fields, persisted into `weak_topics.evidence`
   so re-explanation can be deterministic rather than LLM-judgment-dependent.
8. **Method-aware sequencing** — `generate_practice` accepts an optional
   `method`; memory summary surfaces `methods_seen` when present so the tutor
   can do "familiar method first, optimal method second" sequencing.

## Running locally in VS Code
```bash
npm install
# Backend agents service (terminal A)
cd agents && pip install -r requirements.txt && uvicorn main:app --port 8787 --reload
# Frontend + server functions (terminal B)
npm run dev
```
Environment variables (`.env`): `GEMINI_API_KEY` and/or `ANTHROPIC_API_KEY`,
optional `EMBEDDING_API_KEY`, `SAFETY_MODE=nemo|builtin`, `AGENTS_URL`,
Supabase keys. No keys are hardcoded.

---

## v5 — Knowledge Dependency Graph + Long-Term Learner Model

**New tables** (`supabase/migrations/20260616000000_mistake_patterns_and_mocks.sql`)
- `mistake_patterns` — recurring conceptual/procedural errors per topic
- `mock_tests` — full / sectional / chapter / previous-year tracking with subject scores
- Extends `learner_model_snapshots` with `learning_speed`, `retention_decay`, `stress_periods`, `preferred_explanations`

**New server functions** (`src/lib/learning-os.functions.ts`)
- `getRootCauseChain({ topic, subject })` — BFS through curriculum prerequisites and returns the weak ancestor chain + likely root causes
- `recordMistakePattern` / `getMistakePatterns` — log and aggregate mistake patterns
- `recordMockTest` / `getMockTests` — log mock tests; mirrors into `outcome_events` so existing dashboards stay in sync
- `getCriticInsights` — answers the critic's three questions:
  1. *"Will this create misconceptions?"* — recurring patterns ≥ 2 occurrences
  2. *"Will student forget in 7 days?"* — Ebbinghaus projection of every atom 7 days out
  3. *"Prerequisite gap?"* — curriculum nodes whose upstream prereqs are weak

**New route** — `/me/mock-tests` (`src/routes/_authenticated.me.mock-tests.tsx`)
- Log mock tests, see score trend sparkline, per-test weak-topic chips

**Enhanced curriculum** (`/me/curriculum`)
- Selecting any node fetches and displays the **root-cause chain** with mastery-coloured chips and explicit "Likely root cause" callouts

**Enhanced critic** (`/me/critic`)
- Three new insight panels (Misconceptions / Forgetting risk / Prereq gaps) above the per-subject grades

**Sidebar**
- New "Phase 4" section linking to Mock Tests

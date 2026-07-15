// @ts-nocheck
/**
 * HTTP bridge to the Python FastAPI agents service (agents/main.py).
 * Gracefully degrades when the service is down — every call returns a
 * predictable fallback so the app keeps working.
 *
 * AGENTS_URL is read from .env (default http://localhost:8787).
 */
import process from "node:process";

const BASE = (process.env.AGENTS_URL ?? "http://localhost:8787").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.AGENTS_TIMEOUT_MS ?? 30_000);

async function post<T>(path: string, body: unknown, fallback: T): Promise<T & { _degraded?: boolean; _error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[agents.bridge] ${path} degraded: ${msg}`);
    return { ...(fallback as object), _degraded: true, _error: msg } as T & { _degraded: true; _error: string };
  } finally {
    clearTimeout(t);
  }
}

export const agents = {
  async health() {
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3_000) });
      return r.ok ? await r.json() : { ok: false, _degraded: true };
    } catch {
      return { ok: false, _degraded: true };
    }
  },
  guard: (text: string) =>
    post("/guard", { text },
      { allowed: true, reason: "", category: "safe", helpline: null, mode: "fallback" }),
  curator: (atoms: unknown[]) =>
    post("/curator", { atoms }, { merges: [], prunes: [], bonds: [] }),
  diagnostic: (transcript: unknown[], atoms: unknown[]) =>
    post("/diagnostic", { transcript, atoms }, { weak_topics: [] }),
  planner: (exam: string, weak: unknown[], current_plan: unknown[]) =>
    post("/planner", { exam, weak, current_plan }, { plan: [] }),
  state: (transcript: unknown[], atoms: unknown[]) =>
    post("/state", { transcript, atoms }, { updates: [] }),
  nucleusIngest: (nucleus_text: string, atoms: unknown[]) =>
    post("/nucleus/ingest", { nucleus_text, atoms },
      { nucleus_vector: null, shells: { inner: [], middle: [], outer: [] },
        bonds: [], semantic_mass: 0.3, recency: 1.0, gravity: 0.5 }),
  nucleusSearch: (query: string, atoms: unknown[], k = 8) =>
    post("/nucleus/search", { query, atoms, k }, { hits: [] }),
  nucleusDecay: (atoms: unknown[]) =>
    post("/nucleus/decay", { atoms }, { updates: [] }),
  generateQuestions: (subject: string, topics: string[], difficulty_range: number[], count = 3, exclude_ids?: string[]) =>
    post("/generate-questions", { subject, topics, difficulty_range, count, exclude_ids }, { questions: [] }),
  metaCognitivePredict: (transcript: unknown[], patterns: unknown[]) =>
    post("/meta-cognitive/predict", { transcript, patterns }, { prediction: null }),
  metaCognitiveEvaluate: (actual_message: string, predicted_intent: string) =>
    post("/meta-cognitive/evaluate", { actual_message, predicted_intent }, { status: "ignored" }),
};

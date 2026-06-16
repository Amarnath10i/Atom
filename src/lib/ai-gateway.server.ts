/**
 * LAMA AI Gateway — model-agnostic, zero hardcoding,
 *  with **silent multi-key rotation + auto-failover** (5 Gemini, 5 Claude).
 *
 * Provider selection priority:
 *   1. Explicit `requested` argument passed to getAIProvider()  (UI model switcher)
 *   2. AI_PROVIDER env var
 *   3. First provider with at least one usable API key.
 *
 * Key rotation:
 *   Reads up to 5 numbered keys per provider:
 *     GEMINI_API_KEY_1 .. GEMINI_API_KEY_5      (also accepts GEMINI_API_KEY)
 *     ANTHROPIC_API_KEY_1 .. ANTHROPIC_API_KEY_5 (also accepts ANTHROPIC_API_KEY)
 *   A request-scoped custom `fetch` starts with key #1 and silently rotates
 *   to the next key on 401 / 403 / 429 / 5xx. No surface error until all keys
 *   in the active provider are exhausted.
 *
 *   NVIDIA NIM still supported (single key, legacy) for back-compat.
 */
import process from "node:process";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";

export type ProviderName = "nvidia" | "gemini" | "claude";

export interface AIProvider {
  name: ProviderName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any;
  modelId: string;
  /** Number of API keys currently rotating for this provider (UI debug). */
  keyCount: number;
}

/** Collect numbered keys: BASE, BASE_1 .. BASE_5  → de-duped, in order. */
function collectKeys(base: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string | undefined) => {
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  };
  push(process.env[base]);
  for (let i = 1; i <= 5; i++) push(process.env[`${base}_${i}`]);
  return out;
}

/**
 * Build a fetch wrapper that rotates `Authorization` / `x-goog-api-key` /
 * `x-api-key` across the supplied keys on auth/rate-limit/transient failure.
 *
 * `kind` selects which header to patch (gemini uses query-string + header,
 * anthropic uses `x-api-key`). The provider SDK still injects the first key
 * via its normal config; we override per-attempt here so retries are silent.
 */
function makeRotatingFetch(kind: "gemini" | "anthropic", keys: string[]): typeof fetch {
  return async (input, init) => {
    let lastResp: Response | null = null;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const key = keys[attempt];
      let url: string = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : (input as Request).url;
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

      if (kind === "gemini") {
        // Gemini accepts the key either as ?key= query param or x-goog-api-key header.
        headers.set("x-goog-api-key", key);
        try {
          const u = new URL(url);
          u.searchParams.set("key", key);
          url = u.toString();
        } catch { /* relative URL — header is enough */ }
      } else {
        headers.set("x-api-key", key);
        headers.delete("authorization");
      }

      try {
        const resp = await fetch(url, { ...init, headers });
        // Silently rotate on auth/rate/transient errors; succeed otherwise.
        if (resp.status === 401 || resp.status === 403 || resp.status === 429 || resp.status >= 500) {
          lastResp = resp;
          // Drain body so the underlying connection can be reused.
          try { await resp.clone().text(); } catch { /* ignore */ }
          continue;
        }
        return resp;
      } catch (err) {
        lastErr = err;
        continue;
      }
    }

    if (lastResp) return lastResp;
    throw lastErr ?? new Error(`All ${kind} API keys failed.`);
  };
}

/**
 * Returns the configured provider.
 * @param requested  Optional explicit provider override from the UI/body.
 */
export async function getAIProvider(requested?: ProviderName | string): Promise<AIProvider> {
  const preferred = (requested ?? process.env.AI_PROVIDER ?? "").toString().toLowerCase().trim();

  const geminiKeys = collectKeys("GEMINI_API_KEY");
  const claudeKeys = collectKeys("ANTHROPIC_API_KEY");
  const nvidiaKey = process.env.NVIDIA_API_KEY;

  if (!geminiKeys.length && !claudeKeys.length && !nvidiaKey) {
    throw new Error(
      "No LLM API key found.\n" +
        "Set GEMINI_API_KEY (or GEMINI_API_KEY_1..5), ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY_1..5),\n" +
        "or NVIDIA_API_KEY in your .env file.",
    );
  }

  // Explicit selection — fail fast if the chosen provider has no keys.
  if (preferred === "gemini") {
    if (!geminiKeys.length) throw new Error("Selected Gemini but no GEMINI_API_KEY[_1..5] is set.");
    return buildGemini(geminiKeys);
  }
  if (preferred === "claude") {
    if (!claudeKeys.length) throw new Error("Selected Claude but no ANTHROPIC_API_KEY[_1..5] is set.");
    return buildClaude(claudeKeys);
  }
  if (preferred === "nvidia") {
    if (!nvidiaKey) throw new Error("AI_PROVIDER=nvidia but NVIDIA_API_KEY is not set.");
    return await buildNvidia(nvidiaKey);
  }

  // Auto-detect default: Gemini → Claude → NVIDIA.
  if (geminiKeys.length) return buildGemini(geminiKeys);
  if (claudeKeys.length) return buildClaude(claudeKeys);
  return await buildNvidia(nvidiaKey!);
}

async function buildNvidia(apiKey: string): Promise<AIProvider> {
  const { createOpenAI } = await import("@ai-sdk/openai");
  const baseURL = process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
  const modelId = process.env.NVIDIA_MODEL ?? "nvidia/llama-3.1-nemotron-70b-instruct";
  const nim = createOpenAI({ baseURL, apiKey, compatibility: "compatible" });
  return { name: "nvidia", model: nim(modelId), modelId, keyCount: 1 };
}

function buildGemini(keys: string[]): AIProvider {
  const modelId = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const google = createGoogleGenerativeAI({
    apiKey: keys[0],
    fetch: makeRotatingFetch("gemini", keys),
  });
  return { name: "gemini", model: google(modelId), modelId, keyCount: keys.length };
}

function buildClaude(keys: string[]): AIProvider {
  const modelId = process.env.CLAUDE_MODEL ?? "claude-3-5-haiku-latest";
  const anthropic = createAnthropic({
    apiKey: keys[0],
    fetch: makeRotatingFetch("anthropic", keys),
  });
  return { name: "claude", model: anthropic(modelId), modelId, keyCount: keys.length };
}

/**
 * Server-only config helpers.
 *
 * All values are read from environment variables at request time — never at
 * module-load time — so this is safe on both Node and edge runtimes.
 *
 * Add new server-only values here. Never use VITE_ prefix for secrets.
 */
import process from "node:process";

export function getServerConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,

    // Supabase
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,

    // LLM
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    ollamaApiKey: process.env.OLLAMA_API_KEY,
    ollamaModel: process.env.OLLAMA_MODEL ?? "gpt-oss:120b",

    // Safety mode: "builtin" (default) or "nemo"
    safetyMode: process.env.SAFETY_MODE ?? "builtin",
  };
}

/** Validates all required env vars are present and throws a clear error if not. */
export function assertServerConfig() {
  const cfg = getServerConfig();
  const missing: string[] = [];
  if (!cfg.supabaseUrl) missing.push("SUPABASE_URL");
  if (!cfg.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (cfg.ollamaBaseUrl.includes("ollama.com") && !cfg.ollamaApiKey) {
    missing.push("OLLAMA_API_KEY");
  }
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        "Copy .env.example → .env and fill in your keys.",
    );
  }
}

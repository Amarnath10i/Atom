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
    geminiApiKey: process.env.GEMINI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-1.5-flash",
    claudeModel: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514",

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
  if (!cfg.geminiApiKey && !cfg.anthropicApiKey) {
    missing.push("GEMINI_API_KEY or ANTHROPIC_API_KEY");
  }
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        "Copy .env.example → .env and fill in your keys.",
    );
  }
}

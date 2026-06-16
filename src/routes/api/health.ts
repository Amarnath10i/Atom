/**
 * LAMA — /api/health  (GET)
 *
 * Open http://localhost:5173/api/health in your browser to verify your .env:
 *   - which LLM provider was detected (gemini / claude / nvidia)
 *   - whether a real test call to the LLM succeeds
 *   - whether Supabase env vars are present
 *
 * Nothing is hardcoded — it reads your .env at request time.
 */
import { createFileRoute } from "@tanstack/react-router";
import process from "node:process";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const report: Record<string, unknown> = {
          env: {
            GEMINI_API_KEY: process.env.GEMINI_API_KEY ? "set" : "MISSING",
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : "MISSING",
            NVIDIA_API_KEY: process.env.NVIDIA_API_KEY ? "set" : "MISSING",
            AI_PROVIDER: process.env.AI_PROVIDER || "(auto-detect)",
            SUPABASE_URL: process.env.SUPABASE_URL ? "set" : "MISSING",
            SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
              ? "set"
              : "MISSING",
          },
        };

        try {
          const { getAIProvider } = await import("@/lib/ai-gateway.server");
          const provider = await getAIProvider();
          report.provider = { name: provider.name, model: provider.modelId };

          // Live test call — proves the key + model actually work.
          const { generateText } = await import("ai");
          const { text } = await generateText({
            model: provider.model,
            prompt: "Reply with exactly: OK",
          });
          report.llm_test = { ok: true, reply: text.slice(0, 100) };
        } catch (e: unknown) {
          report.llm_test = {
            ok: false,
            error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
          };
        }

        const ok = (report.llm_test as { ok: boolean })?.ok === true;
        report.status = ok
          ? "✅ LLM is working — chat should respond"
          : "❌ LLM call failed — fix the error above in your .env";

        return new Response(JSON.stringify(report, null, 2), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});

/**
 * LAMA AI Gateway — every LLM call goes through Ollama.
 *
 * Uses Ollama's OpenAI-compatible endpoint, so the same code talks to:
 *   - a local Ollama daemon   OLLAMA_BASE_URL=http://localhost:11434 (default, no key)
 *   - Ollama Cloud            OLLAMA_BASE_URL=https://ollama.com + OLLAMA_API_KEY
 *
 * OLLAMA_MODEL picks the model (default gpt-oss:120b). Hosted deploys (Vercel)
 * can't reach a daemon on your own machine, so they need Ollama Cloud.
 */
import process from "node:process";
import { createOpenAI } from "@ai-sdk/openai";

export type ProviderName = "ollama";

export interface AIProvider {
  name: ProviderName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any;
  modelId: string;
  baseURL: string;
}

export function getOllamaConfig() {
  const baseURL = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, "");
  return {
    baseURL,
    apiKey: process.env.OLLAMA_API_KEY,
    modelId: process.env.OLLAMA_MODEL ?? "gpt-oss:120b",
  };
}

/** Returns the Ollama-backed model. The `_requested` argument is accepted for old callers and ignored. */
export async function getAIProvider(_requested?: string): Promise<AIProvider> {
  const { baseURL, apiKey, modelId } = getOllamaConfig();
  if (baseURL.includes("ollama.com") && !apiKey) {
    throw new Error(
      "OLLAMA_BASE_URL points at Ollama Cloud but OLLAMA_API_KEY is not set.\n" +
        "Create a key at https://ollama.com/settings/keys.",
    );
  }
  const ollama = createOpenAI({
    baseURL: `${baseURL}/v1`,
    // Local Ollama ignores the key, but the SDK requires a non-empty value.
    apiKey: apiKey || "ollama",
    compatibility: "compatible",
  });
  return { name: "ollama", model: ollama(modelId), modelId, baseURL };
}

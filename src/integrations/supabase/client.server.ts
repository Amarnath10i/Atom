/**
 * Server-side Supabase admin client (service role — bypasses RLS).
 * Keys are read from .env at request time, never hardcoded.
 *
 * Required .env vars:
 *   SUPABASE_URL              — e.g. https://xyz.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — from Supabase → Project Settings → API
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import process from "node:process";

function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length) {
    throw new Error(
      `Missing Supabase environment variable(s): ${missing.join(", ")}\n` +
        "Copy .env.example → .env and fill in your Supabase project keys.\n" +
        "Find them at: https://supabase.com/dashboard → your project → Settings → API",
    );
  }

  return createClient<Database>(url!, key!, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _client: ReturnType<typeof createSupabaseAdminClient> | undefined;

// Lazy singleton — created on first use, not at module load time
export const supabaseAdmin = new Proxy(
  {} as ReturnType<typeof createSupabaseAdminClient>,
  {
    get(_, prop, receiver) {
      if (!_client) _client = createSupabaseAdminClient();
      return Reflect.get(_client, prop, receiver);
    },
  },
);

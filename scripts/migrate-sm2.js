import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const envPath = resolve(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (val && !process.env[key]) process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const sql = `
ALTER TABLE memory_atoms 
ADD COLUMN IF NOT EXISTS sm2_ef REAL DEFAULT 2.5,
ADD COLUMN IF NOT EXISTS sm2_interval INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS sm2_repetitions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS sm2_next_review_date TIMESTAMPTZ;
`;

const projectRef = SUPABASE_URL.replace("https://", "").split(".")[0];
const mgmtUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function run() {
  try {
    const res = await fetch(mgmtUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    const body = await res.text();

    if (res.ok) {
      console.log("✅ SM2 Schema applied successfully!\\n");
    } else {
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
  } catch (err) {
    console.error("⚠️ Migration failed:", err.message);
  }
}

run();

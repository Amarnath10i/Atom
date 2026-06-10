#!/usr/bin/env node
/**
 * LAMA — Direct database setup script
 * Run: node scripts/setup-db.js
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env and
 * executes the full schema + seed migration via the Supabase SQL Editor API.
 * No Supabase CLI needed — works on any machine with Node.js 18+.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Load .env ─────────────────────────────────────────────────────────────────
const envPath = resolve(ROOT, ".env");
if (!existsSync(envPath)) {
  console.error("❌  .env not found. Run:  cp .env.example .env  then fill in your keys.");
  process.exit(1);
}
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (val && !process.env[key]) process.env[key] = val;
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL || SUPABASE_URL.includes("YOUR_PROJECT")) {
  console.error("❌  SUPABASE_URL not set in .env (still has placeholder).");
  console.error("    Get it from: Supabase dashboard → Settings → API");
  process.exit(1);
}
if (!SERVICE_KEY || SERVICE_KEY.includes("your_")) {
  console.error("❌  SUPABASE_SERVICE_ROLE_KEY not set in .env.");
  console.error("    Get it from: Supabase dashboard → Settings → API → service_role key");
  process.exit(1);
}

// ── Read migration SQL ────────────────────────────────────────────────────────
const migrDir = resolve(ROOT, "supabase", "migrations");
const sqlFiles = readdirSync(migrDir).filter((f) => f.endsWith(".sql")).sort();
if (!sqlFiles.length) {
  console.error("❌  No .sql files found in supabase/migrations/");
  process.exit(1);
}
const sql = sqlFiles.map((f) => readFileSync(resolve(migrDir, f), "utf-8")).join("\n\n");
console.log(`\n📄  Found ${sqlFiles.length} migration file(s)`);

// ── Push via Supabase REST ────────────────────────────────────────────────────
// Use the pg.query function available via the supabase-js REST API
const endpoint = `${SUPABASE_URL}/rest/v1/`;
console.log(`🔗  Supabase URL: ${SUPABASE_URL}`);

// Split SQL into individual statements and run via supabase-js @rpc or direct REST
// The simplest approach: use the /rest/v1/ with POST to a stored procedure.
// But since we can't guarantee exec_sql exists, we use the Management API.
const projectRef = SUPABASE_URL.replace("https://", "").split(".")[0];
const mgmtUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

console.log(`🚀  Pushing schema to project: ${projectRef}\n`);

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
    console.log("✅  Schema applied successfully!\n");
    console.log("\n▶️   Now run:  npm run dev\n");
  } else {
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
} catch (err) {
  console.error("\n⚠️   Automatic migration failed:", err.message);
  console.log("\n📋  MANUAL SETUP (2 minutes):");
  console.log("   1. Open https://supabase.com/dashboard");
  console.log("   2. Select your project → SQL Editor (left sidebar)");
  console.log("   3. Click 'New query'");
  console.log(`   4. Open this file in VS Code and copy-paste ALL contents:`);
  console.log(`      ${resolve(migrDir, sqlFiles[0])}`);
  console.log("   5. Click RUN in the SQL Editor");
  console.log("\n   Then run:  npm run dev\n");
}

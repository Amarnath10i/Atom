#!/usr/bin/env node
/**
 * One-time backfill: let the LLM place each existing topic in its exam unit
 * (memory_atoms.exam_unit). New topics are classified as they're created;
 * this only covers topics saved before that existed. Skips classified rows.
 *
 * Run: node --experimental-strip-types scripts/backfill-exam-units.mjs [--dry-run]
 * Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OLLAMA_* from .env.
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const { unitsFor } = await import(pathToFileURL(resolve(ROOT, "src/lib/exam-weightage.ts")).href);

const DRY = process.argv.includes("--dry-run");
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, "");
const OLLAMA_KEY = process.env.OLLAMA_API_KEY;
const MODEL = process.env.OLLAMA_MODEL ?? "gpt-oss:120b";
if (!SB || !KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

const sb = async (path, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", ...init.headers },
  });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return r.status === 204 || init.method === "PATCH" ? null : r.json();
};

async function classify(exam, atoms) {
  const units = ["Physics", "Chemistry", "Maths", "Biology"]
    .map((s) => `${s}: ${unitsFor(exam, s).join(", ") || "(n/a)"}`)
    .join("\n");
  const list = atoms.map((a, i) => `${i + 1}. ${a.subject}: ${a.topic}`).join("\n");
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(OLLAMA_KEY ? { authorization: `Bearer ${OLLAMA_KEY}` } : {}) },
    body: JSON.stringify({
      model: MODEL, stream: false, format: "json",
      messages: [{
        role: "user",
        content:
          `${exam} exam units by subject:\n${units}\n\nTopics:\n${list}\n\n` +
          'Put each topic in the unit of ITS OWN subject that it belongs to. Reply with JSON only: {"units":[{"n":<topic number>,"unit":"<unit copied exactly>"}]}. ' +
          "Leave a topic out if no unit fits.",
      }],
    }),
  });
  if (!r.ok) throw new Error(`Ollama: HTTP ${r.status} ${await r.text()}`);
  return JSON.parse((await r.json()).message?.content ?? "{}").units ?? [];
}

const students = await sb("students?select=id,name,exam");
let total = 0;
for (const st of students) {
  const exam = st.exam ?? "JEE";
  const atoms = await sb(`memory_atoms?student_id=eq.${st.id}&exam_unit=is.null&select=id,subject,topic`);
  if (!atoms.length) continue;
  let result;
  try { result = await classify(exam, atoms); } catch (e) { console.warn(`${st.name}: skipped (${e.message})`); continue; }
  console.log(`${st.name} (${exam}):`);
  for (const { n, unit } of result) {
    const a = atoms[Number(n) - 1];
    const valid = a && unitsFor(exam, a.subject).includes(unit);
    if (!valid) continue;
    console.log(`    ${a.subject}: ${a.topic} → ${unit}`);
    if (!DRY) await sb(`memory_atoms?id=eq.${a.id}`, { method: "PATCH", body: JSON.stringify({ exam_unit: unit }) });
    total++;
  }
}
console.log(`\n${DRY ? "Would classify" : "Classified"} ${total} topics.`);

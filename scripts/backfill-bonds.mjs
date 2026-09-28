#!/usr/bin/env node
/**
 * One-time backfill: ask the LLM which of each student's existing topics are
 * genuinely connected, and insert those links into memory_bonds.
 *
 * New chats create links automatically; this is only for atoms that were
 * saved before linking existed. Safe to re-run: existing pairs are skipped.
 *
 * Run: node scripts/backfill-bonds.mjs            (all students)
 *      node scripts/backfill-bonds.mjs --dry-run  (print, don't write)
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OLLAMA_* from .env.
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const DRY = process.argv.includes("--dry-run");
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, "");
const OLLAMA_KEY = process.env.OLLAMA_API_KEY;
const MODEL = process.env.OLLAMA_MODEL ?? "gpt-oss:120b";
const SUBJECTS = new Set(["Physics", "Chemistry", "Maths", "Biology"]);
const RELATIONS = new Set(["prerequisite", "application", "analogy"]);
if (!SB || !KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

const sb = async (path, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", ...init.headers },
  });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return r.status === 204 || init.method === "POST" ? null : r.json();
};

async function proposeLinks(atoms) {
  const list = atoms.map((a, i) => `${i + 1}. ${a.subject}: ${a.topic}`).join("\n");
  const prompt =
    `These are topics a JEE/NEET student has studied:\n${list}\n\n` +
    "List the pairs that are genuinely connected in the syllabus. Reply with JSON only: " +
    '{"links":[{"from":<number>,"to":<number>,"relation":"prerequisite|application|analogy","weight":<0.3-1.0>}]}. ' +
    "prerequisite: 'from' is the MORE ADVANCED topic and 'to' is the more basic topic it builds on " +
    "(e.g. from=Projectile motion, to=Kinematics; from=Integral calculus, to=Limits & differentiability). " +
    "application: 'from' uses the tools of 'to' (from=Rotational motion, to=Integral calculus). analogy: same underlying idea. " +
    "Cross-subject links are welcome when real (e.g. calculus used in kinematics). " +
    "Be strict: only direct, well-known NCERT connections a teacher would point out; skip anything loose or speculative, and skip topics that are not real syllabus topics. " +
    "weight = how essential the connection is (0.5 useful, 1.0 essential). " +
    `At most ${Math.ceil(atoms.length * 1.5)} links; [] if none.`;
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(OLLAMA_KEY ? { authorization: `Bearer ${OLLAMA_KEY}` } : {}) },
    body: JSON.stringify({ model: MODEL, stream: false, format: "json", messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Ollama: HTTP ${r.status} ${await r.text()}`);
  const content = (await r.json()).message?.content ?? "{}";
  return JSON.parse(content).links ?? [];
}

const students = await sb("students?select=id,name");
let total = 0;
for (const st of students) {
  const atoms = (await sb(`memory_atoms?student_id=eq.${st.id}&select=id,subject,topic&order=last_reviewed.desc&limit=80`))
    .filter((a) => SUBJECTS.has(a.subject));
  if (atoms.length < 2) continue;
  const existing = await sb(`memory_bonds?student_id=eq.${st.id}&select=source_atom,target_atom`);
  const have = new Set(existing.flatMap((b) => [`${b.source_atom}|${b.target_atom}`, `${b.target_atom}|${b.source_atom}`]));

  let proposed;
  try {
    proposed = await proposeLinks(atoms);
  } catch (e) {
    console.warn(`  ${st.name}: skipped (${e.message})`);
    continue;
  }
  const rows = [];
  for (const l of proposed) {
    const s = atoms[Number(l.from) - 1], t = atoms[Number(l.to) - 1];
    if (!s || !t || s.id === t.id || have.has(`${s.id}|${t.id}`)) continue;
    if ((Number(l.weight) || 0) < 0.5) continue; // drop low-confidence links
    have.add(`${s.id}|${t.id}`).add(`${t.id}|${s.id}`);
    rows.push({
      student_id: st.id, source_atom: s.id, target_atom: t.id,
      relation: RELATIONS.has(l.relation) ? l.relation : "application",
      weight: Math.max(0.2, Math.min(1, Number(l.weight) || 0.6)),
      _desc: `${s.topic} -[${l.relation}]-> ${t.topic}`,
    });
  }
  console.log(`${st.name}: ${atoms.length} topics, ${rows.length} new links`);
  for (const r of rows) console.log(`    ${r._desc}`);
  if (!DRY && rows.length) {
    await sb("memory_bonds", { method: "POST", body: JSON.stringify(rows.map(({ _desc, ...r }) => r)) });
  }
  total += rows.length;
}
console.log(`\n${DRY ? "Would add" : "Added"} ${total} links.`);

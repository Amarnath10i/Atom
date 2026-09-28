/**
 * Shared vocabulary for a student's memory map, used by both the graph UI and
 * the tutor prompt so they describe mastery the same way.
 */

export type MapAtom = { id: string; subject: string; topic: string; strength: number };
export type MapBond = { source_atom: string; target_atom: string; relation?: string | null; weight?: number | null };

export type Band = "strong" | "developing" | "weak";

export const BANDS: { band: Band; min: number; label: string }[] = [
  { band: "strong", min: 0.7, label: "Mastered" },
  { band: "developing", min: 0.45, label: "Developing" },
  { band: "weak", min: 0, label: "Needs work" },
];

export function bandFor(strength: number): Band {
  return (BANDS.find((b) => strength >= b.min) ?? BANDS[BANDS.length - 1]).band;
}

export const RELATION_LABEL: Record<string, string> = {
  prerequisite: "needs",
  application: "applies",
  analogy: "is like",
};

/**
 * Compact text map for the tutor: per-subject mastery, topics grouped by band,
 * and how topics connect. Lets the model build on strong topics, repair weak
 * prerequisites first, and bridge to linked topics.
 */
export function knowledgeMapText(atoms: MapAtom[], bonds: MapBond[], maxLinks = 25): string {
  if (!atoms.length) return "(empty — no topics studied yet)";
  const bySubject = new Map<string, MapAtom[]>();
  for (const a of atoms) {
    if (!bySubject.has(a.subject)) bySubject.set(a.subject, []);
    bySubject.get(a.subject)!.push(a);
  }

  const lines: string[] = [];
  for (const [subject, list] of bySubject) {
    const avg = list.reduce((s, a) => s + a.strength, 0) / list.length;
    lines.push(`${subject} — ${list.length} topics, average mastery ${Math.round(avg * 100)}%`);
    for (const { band, label } of BANDS) {
      const inBand = list.filter((a) => bandFor(a.strength) === band);
      if (inBand.length) {
        lines.push(`  ${label}: ${inBand.map((a) => `${a.topic} (${Math.round(a.strength * 100)}%)`).join(", ")}`);
      }
    }
  }

  const byId = new Map(atoms.map((a) => [a.id, a]));
  const links = bonds
    .filter((b) => byId.has(b.source_atom) && byId.has(b.target_atom))
    .slice(0, maxLinks)
    .map((b) => {
      const s = byId.get(b.source_atom)!;
      const t = byId.get(b.target_atom)!;
      return `  ${s.topic} ${RELATION_LABEL[b.relation ?? ""] ?? "relates to"} ${t.topic}`;
    });
  if (links.length) lines.push("Connections:", ...links);
  return lines.join("\n");
}

// ── Learning preferences ────────────────────────────────────────────────────
// A fixed vocabulary so repeated signals reinforce one pattern_atoms row
// (unique per student + pattern_type) instead of creating near-duplicates.
export const PREFERENCES = [
  { type: "prefers_visuals", label: "Learns with diagrams", instruction: "show a diagram or image (search_images) whenever it helps" },
  { type: "prefers_simple_language", label: "Likes simple words", instruction: "use plain everyday language and define every technical term" },
  { type: "prefers_step_by_step", label: "Likes step-by-step", instruction: "break solutions into small numbered steps" },
  { type: "prefers_derivations", label: "Asks why / derivations", instruction: "show where formulas come from, not just the result" },
  { type: "prefers_examples", label: "Learns from examples", instruction: "anchor each idea in a concrete or real-life example" },
  { type: "prefers_practice", label: "Wants practice", instruction: "end with one short practice question" },
  { type: "prefers_brief", label: "Prefers short answers", instruction: "keep replies short and to the point" },
] as const;
export const PREFERENCE_TYPES = PREFERENCES.map((p) => p.type) as string[];

export type Pattern = { pattern_type: string; description?: string | null; confidence: number };

export function learningProfileText(patterns: Pattern[]): string {
  const prefs = patterns
    .map((p) => ({ p, def: PREFERENCES.find((d) => d.type === p.pattern_type) }))
    .filter((x) => x.def && x.p.confidence >= 0.6);
  if (!prefs.length) return "(no clear preferences yet — watch how they respond and adapt)";
  return prefs
    .map(({ p, def }) => `- ${def!.label} (${Math.round(p.confidence * 100)}% sure): ${def!.instruction}`)
    .join("\n");
}

// ── Focus topic: where the current question sits in the graph ───────────────

/** Atoms the message is about: exact topic mentions first, then semantic hits. */
export function findFocusAtoms<A extends MapAtom>(message: string, atoms: A[], semanticHits: A[] = [], max = 2): A[] {
  const text = ` ${message.toLowerCase().replace(/[^a-z0-9&]+/g, " ")} `;
  const mentioned = atoms.filter((a) => {
    const t = a.topic.toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();
    if (!t) return false;
    if (text.includes(` ${t} `)) return true;
    // Multi-word topics: the first two words are usually distinctive ("chemical bonding").
    const lead = t.split(" ").slice(0, 2).join(" ");
    return lead.includes(" ") && text.includes(` ${lead} `);
  });
  const out: A[] = [];
  for (const a of [...mentioned, ...semanticHits]) {
    if (!out.some((o) => o.id === a.id)) out.push(a);
    if (out.length >= max) break;
  }
  return out;
}

const DEPTH: Record<Band, string> = {
  strong: "they know this well: move faster, skip basics, and stretch them with an exam-level twist",
  developing: "partly understood: explain normally, then check understanding with a quick question",
  weak: "shaky: start from basics with an analogy and one fully worked example before anything advanced",
};

/**
 * For each focus topic: how well it's known, how deep to go, and the state of
 * its prerequisites and connected topics — so weak foundations get fixed first.
 */
export function focusNeighbourhoodText(focus: MapAtom[], atoms: MapAtom[], bonds: MapBond[]): string {
  if (!focus.length) return "(new topic for this student — no history yet; start from fundamentals and gauge their level)";
  const byId = new Map(atoms.map((a) => [a.id, a]));
  const pct = (a: MapAtom) => `${Math.round(a.strength * 100)}%`;
  return focus
    .map((f) => {
      const lines = [`${f.subject}: ${f.topic} — mastery ${pct(f)}; ${DEPTH[bandFor(f.strength)]}.`];
      const needs: string[] = [];
      const related: string[] = [];
      for (const b of bonds) {
        const other =
          b.source_atom === f.id ? byId.get(b.target_atom) : b.target_atom === f.id ? byId.get(b.source_atom) : undefined;
        if (!other) continue;
        const flag = bandFor(other.strength) === "weak" ? " ← WEAK, repair briefly first" : "";
        if (b.relation === "prerequisite" && b.source_atom === f.id) needs.push(`${other.topic} (${pct(other)})${flag}`);
        else related.push(`${other.topic} (${pct(other)})`);
      }
      if (needs.length) lines.push(`  Builds on: ${needs.join(", ")}`);
      if (related.length) lines.push(`  Connected to: ${related.join(", ")}`);
      return lines.join("\n");
    })
    .join("\n");
}

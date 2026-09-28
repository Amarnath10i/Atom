/**
 * Shared vocabulary for a student's memory map, used by both the graph UI and
 * the tutor prompt so they describe mastery the same way.
 */

export type MapAtom = {
  id: string;
  subject: string;
  topic: string;
  strength: number;
  reviews?: number | null;
  last_reviewed?: string | null;
  sm2_interval?: number | null;
  /** The student's learned memory_stability (1 = default forgetting speed). */
  stability_mul?: number | null;
};
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
    const avg = list.reduce((s, a) => s + effectiveStrength(a), 0) / list.length;
    lines.push(`${subject} — ${list.length} topics, average mastery ${Math.round(avg * 100)}%`);
    for (const { band, label } of BANDS) {
      const inBand = list.filter((a) => bandFor(effectiveStrength(a)) === band);
      if (inBand.length) {
        lines.push(`  ${label}: ${inBand
          .map((a) => `${a.topic} (${Math.round(effectiveStrength(a) * 100)}%${isFading(a) ? ", fading" : ""})`)
          .join(", ")}`);
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

// ── Learning preferences (learned, open-ended) ──────────────────────────────
// The extractor model names whatever preference it observes and how to adapt
// to it. Stored in pattern_atoms as pattern_type "pref:<key>" with
// description "<label> | <how to adapt>"; confidence rises with supporting
// evidence and falls with contradicting evidence.

export const PREF_PREFIX = "pref:";
export type Pattern = { pattern_type: string; description?: string | null; confidence: number };
export type LearnedPreference = { key: string; label: string; instruction: string; confidence: number };

export function learnedPreferences(patterns: Pattern[], minConfidence = 0.6): LearnedPreference[] {
  return patterns
    .filter((p) => p.pattern_type.startsWith(PREF_PREFIX) && p.confidence >= minConfidence)
    .map((p) => {
      const [label, instruction] = (p.description ?? "").split(" | ");
      const key = p.pattern_type.slice(PREF_PREFIX.length);
      return { key, label: label || key.replace(/_/g, " "), instruction: instruction ?? "", confidence: p.confidence };
    });
}

export function learningProfileText(patterns: Pattern[]): string {
  const prefs = learnedPreferences(patterns);
  if (!prefs.length) return "(nothing learned yet — notice how they respond and adapt)";
  return prefs
    .map((p) => `- ${p.label} (${Math.round(p.confidence * 100)}% sure)${p.instruction ? `: ${p.instruction}` : ""}`)
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
  const pct = (a: MapAtom) => `${Math.round(effectiveStrength(a) * 100)}%`;
  return focus
    .map((f) => {
      const r = recall(f);
      const lines = [
        `${f.subject}: ${f.topic} — mastery ${pct(f)}${r < 0.5 ? ` (fading: ~${Math.round(r * 100)}% recall since last review)` : ""}; ${DEPTH[bandFor(effectiveStrength(f))]}.`,
      ];
      const needs: string[] = [];
      const related: string[] = [];
      for (const b of bonds) {
        const other =
          b.source_atom === f.id ? byId.get(b.target_atom) : b.target_atom === f.id ? byId.get(b.source_atom) : undefined;
        if (!other) continue;
        const flag = bandFor(effectiveStrength(other)) === "weak" ? " ← WEAK, repair briefly first" : "";
        if (b.relation === "prerequisite" && b.source_atom === f.id) needs.push(`${other.topic} (${pct(other)})${flag}`);
        else related.push(`${other.topic} (${pct(other)})`);
      }
      if (needs.length) lines.push(`  Builds on: ${needs.join(", ")}`);
      if (related.length) lines.push(`  Connected to: ${related.join(", ")}`);
      const path = prerequisitePath(f, atoms, bonds);
      if (path.length > 2) lines.push(`  Weak foundation chain (fix in this order): ${path.map((a) => a.topic).join(" → ")}`);
      return lines.join("\n");
    })
    .join("\n");
}

// ── Forgetting: recall decays between reviews ───────────────────────────────

const DAY = 86_400_000;

/**
 * Estimated chance the student can still recall a topic right now, using an
 * exponential forgetting curve R = e^(-t/S). Stability S grows with the SM-2
 * interval and with repeated reviews, so well-practised topics fade slowly,
 * scaled by the student's own learned memory stability.
 */
export function recall(a: MapAtom, now = Date.now()): number {
  if (!a.last_reviewed) return 1;
  const days = Math.max(0, (now - new Date(a.last_reviewed).getTime()) / DAY);
  const stability = (Math.max(1, a.sm2_interval ?? 1) * 1.5 + (a.reviews ?? 0) * 2 + 3) * (a.stability_mul ?? 1);
  return Math.exp(-days / stability);
}

/** Mastery discounted by forgetting: what the student could show today. */
export function effectiveStrength(a: MapAtom, now = Date.now()): number {
  return a.strength * (0.55 + 0.45 * recall(a, now));
}

export const isFading = (a: MapAtom, now = Date.now()) => a.strength >= 0.45 && recall(a, now) < 0.5;

// ── Exam priority: weightage × knowledge gap ────────────────────────────────

export type Priority<A> = { atom: A; score: number; weight: number };

/** Topics ranked by exam value lost to the current gap (highest first). */
export function examPriorities<A extends MapAtom>(
  atoms: A[],
  weightOf: (a: A) => number,
  now = Date.now(),
): Priority<A>[] {
  return atoms
    .map((atom) => {
      const weight = weightOf(atom);
      return { atom, weight, score: weight * (1 - effectiveStrength(atom, now)) };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Learning path: weak prerequisites behind a topic ────────────────────────

/**
 * Walk prerequisite links back from `target` (up to `depth` hops) and return
 * the weak or fading foundations in the order they should be fixed: deepest
 * first, ending at the target.
 */
export function prerequisitePath(target: MapAtom, atoms: MapAtom[], bonds: MapBond[], depth = 3): MapAtom[] {
  const byId = new Map(atoms.map((a) => [a.id, a]));
  const needs = new Map<string, string[]>();
  for (const b of bonds) {
    if (b.relation !== "prerequisite") continue;
    if (!needs.has(b.source_atom)) needs.set(b.source_atom, []);
    needs.get(b.source_atom)!.push(b.target_atom);
  }
  const order: MapAtom[] = [];
  const seen = new Set([target.id]);
  const visit = (id: string, d: number) => {
    if (d >= depth) return;
    for (const pre of needs.get(id) ?? []) {
      if (seen.has(pre)) continue;
      seen.add(pre);
      visit(pre, d + 1);
      const a = byId.get(pre);
      if (a && bandFor(effectiveStrength(a)) !== "strong") order.push(a);
    }
  };
  visit(target.id, 0);
  return order.length ? [...order, target] : [];
}

// ── Misconceptions ──────────────────────────────────────────────────────────

export type Misconception = { subject: string; topic: string; pattern: string; description?: string | null; occurrences?: number | null };

export function misconceptionsText(list: Misconception[]): string {
  if (!list.length) return "(none recorded)";
  return list
    .map((m) => `- ${m.subject}/${m.topic}: "${m.pattern}"${m.description ? ` — ${m.description}` : ""}${(m.occurrences ?? 1) > 1 ? ` (seen ${m.occurrences}×)` : ""}`)
    .join("\n");
}

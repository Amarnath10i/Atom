/**
 * Bonds between memory atoms: how a student's topics relate to each other.
 *
 * Relations (source → target):
 *   prerequisite  target must be understood before source   (Kinematics ← Projectile motion)
 *   application   source applies target in a new setting    (Projectile motion → Vectors)
 *   analogy       same underlying idea in another area       (Cutaneous respiration ~ Alveolar diffusion)
 *
 * Weight 0..1 is how strongly the two topics depend on each other.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const RELATIONS = ["prerequisite", "application", "analogy"] as const;
export type Relation = (typeof RELATIONS)[number];

export type ProposedLink = { topic: string; relation: string; weight?: number };

/** The JSON fragment the extractor LLM is asked to return, shared with the backfill script. */
export const LINKS_INSTRUCTIONS =
  '"links": up to 3 objects {"topic":"<an EXISTING topic copied exactly from the list>","relation":"prerequisite|application|analogy","weight":<0.3-1.0>} ' +
  "naming existing topics that are genuinely connected to this one in the JEE/NEET syllabus " +
  "(prerequisite = the listed topic is a more basic topic this one builds on, e.g. this=Projectile motion, listed=Kinematics; " +
  "application = this topic uses the tools of the listed one, e.g. this=Rotational motion, listed=Integral calculus; " +
  "analogy = same underlying idea in another area). " +
  "Use [] when nothing in the list is truly related. Never invent topics that are not in the list.";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Insert bonds from `atomId` to the existing atoms named in `links`.
 * Unknown topics, self-links and duplicates (in either direction) are skipped.
 * Returns how many bonds were added.
 */
export async function linkAtom(
  db: SupabaseClient,
  studentId: string,
  atomId: string,
  links: ProposedLink[] | undefined,
): Promise<number> {
  if (!Array.isArray(links) || links.length === 0) return 0;

  const [{ data: atoms }, { data: existing }] = await Promise.all([
    db.from("memory_atoms").select("id, topic").eq("student_id", studentId),
    db.from("memory_bonds").select("source_atom, target_atom").eq("student_id", studentId),
  ]);
  const idByTopic = new Map((atoms ?? []).map((a) => [norm(a.topic), a.id as string]));
  const have = new Set((existing ?? []).flatMap((b) => [
    `${b.source_atom}|${b.target_atom}`,
    `${b.target_atom}|${b.source_atom}`,
  ]));

  const rows = [];
  for (const l of links.slice(0, 3)) {
    const target = idByTopic.get(norm(String(l?.topic ?? "")));
    const relation = RELATIONS.includes(l?.relation as Relation) ? l.relation : "application";
    if (!target || target === atomId || have.has(`${atomId}|${target}`)) continue;
    have.add(`${atomId}|${target}`).add(`${target}|${atomId}`);
    rows.push({
      student_id: studentId,
      source_atom: atomId,
      target_atom: target,
      relation,
      weight: Math.max(0.2, Math.min(1, Number(l.weight) || 0.6)),
    });
  }
  if (rows.length) await db.from("memory_bonds").insert(rows as never);
  return rows.length;
}

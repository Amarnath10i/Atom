// @ts-nocheck
/**
 * learning-os.functions.ts
 * Server functions for Phase 1, 2, and 3 of the Learning OS roadmap.
 *
 *  Phase 1 (highest ROI): curriculum graph, forgetting curves,
 *                          outcome tracking, learner model
 *  Phase 2:               learning simulator, enhanced critic,
 *                          personal learning twin
 *  Phase 3 (aspirational): counterfactual, exam strategy,
 *                           dynamic agents
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const StudentId = z.object({ studentId: z.string().uuid() });

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ebbinghaus(strength: number, reviewCount: number, daysSince: number): number {
  // Simplified power-law forgetting: R = S^(1 + 0.1*reviews) * e^(-0.07 * days)
  const stabilityFactor = 1 + 0.1 * reviewCount;
  const decayed = strength * Math.exp(-0.07 * daysSince / stabilityFactor);
  return Math.max(0.05, Math.min(1, decayed));
}

function daysBetween(a: string | Date, b: string | Date = new Date()): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Forgetting Curves
// Returns per-atom forgetting curve data points (next 30 days projection)
// ─────────────────────────────────────────────────────────────────────────────

export const getForgettingCurves = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;

    const { data: student } = await supabaseAdmin
      .from("students").select("id").eq("auth_user_id", uid).maybeSingle();
    if (!student) return { curves: [], atoms: [] };

    const { data: atoms } = await supabaseAdmin
      .from("memory_atoms").select("*").eq("student_id", student.id).order("strength", { ascending: true });

    const curves = (atoms ?? []).map((a) => {
      const daysSinceReview = daysBetween(a.last_reviewed);
      const points: Array<{ day: number; strength: number }> = [];
      // Past 7 days + future 30 days
      for (let d = -7; d <= 30; d++) {
        const dFrom = Math.max(0, daysSinceReview + d);
        points.push({
          day: d,
          strength: parseFloat(ebbinghaus(a.strength, a.reviews, dFrom).toFixed(3)),
        });
      }
      return { atomId: a.id, topic: a.topic, subject: a.subject, currentStrength: a.strength, points };
    });

    return { curves, atoms: atoms ?? [] };
  });

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Outcome Tracking
// ─────────────────────────────────────────────────────────────────────────────

export const getOutcomeHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;

    const { data: student } = await supabaseAdmin
      .from("students").select("id").eq("auth_user_id", uid).maybeSingle();
    if (!student) return { events: [], bySubject: {}, byDay: [] };

    const sid = student.id;
    const { data: events } = await supabaseAdmin
      .from("outcome_events").select("*")
      .eq("student_id", sid).order("created_at", { ascending: true });

    // Also pull reflections as pseudo-outcome events
    const { data: reflections } = await supabaseAdmin
      .from("reflections").select("*")
      .eq("student_id", sid).order("created_at", { ascending: true });

    const { data: atoms } = await supabaseAdmin
      .from("memory_atoms").select("subject, strength").eq("student_id", sid);

    // Aggregate by subject from atoms
    const bySubject: Record<string, { count: number; avgStrength: number }> = {};
    for (const a of atoms ?? []) {
      if (!bySubject[a.subject]) bySubject[a.subject] = { count: 0, avgStrength: 0 };
      bySubject[a.subject].count++;
      bySubject[a.subject].avgStrength += a.strength;
    }
    for (const s of Object.keys(bySubject)) {
      bySubject[s].avgStrength = parseFloat((bySubject[s].avgStrength / bySubject[s].count).toFixed(3));
    }

    // Sessions by day (from reflections)
    const byDay: Array<{ date: string; sessions: number; atomsAdded: number }> = [];
    const dayMap: Record<string, { sessions: number; atomsAdded: number }> = {};
    for (const r of reflections ?? []) {
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      if (!dayMap[day]) dayMap[day] = { sessions: 0, atomsAdded: 0 };
      dayMap[day].sessions++;
      dayMap[day].atomsAdded += r.atoms_added ?? 0;
    }
    for (const [date, val] of Object.entries(dayMap)) {
      byDay.push({ date, ...val });
    }
    byDay.sort((a, b) => a.date.localeCompare(b.date));

    return { events: events ?? [], bySubject, byDay, reflections: reflections ?? [] };
  });

export const recordOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      studentId: z.string().uuid(),
      subject: z.string(),
      topic: z.string(),
      score: z.number().min(0).max(1),
      eventType: z.enum(["quiz", "practice", "recall", "simulation"]).default("quiz"),
      threadId: z.string().uuid().optional(),
    }).parse(i)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("outcome_events")
      .insert({
        student_id: data.studentId,
        thread_id: data.threadId ?? null,
        subject: data.subject,
        topic: data.topic,
        score: data.score,
        event_type: data.eventType,
      }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Curriculum Graph
// ─────────────────────────────────────────────────────────────────────────────

export const getCurriculumGraph = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => (i ?? {}) as { exam?: "JEE" | "NEET" })
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;

    const { data: student } = await supabaseAdmin
      .from("students").select("*").eq("auth_user_id", uid).maybeSingle();
    if (!student) return { nodes: [], edges: [], student: null };

    // Exam toggle: preview any exam's curriculum without touching stored progress.
    const viewExam = data?.exam === "JEE" || data?.exam === "NEET" ? data.exam : null;
    if (viewExam && viewExam !== student.exam) {
      const { data: atoms } = await supabaseAdmin
        .from("memory_atoms").select("*").eq("student_id", student.id);
      const syllabusMap = buildSyllabus(viewExam);
      const seen = new Set<string>();
      const nodes: Array<{
        id: string; subject: string; topic: string; prerequisites: string[];
        mastery: number; priority: number; estimatedHours: number;
      }> = [];
      for (const [subject, topics] of Object.entries(syllabusMap)) {
        for (const { topic, prereqs, hours, priority } of topics) {
          const id = `${subject}::${topic}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const atom = (atoms ?? []).find(
            (a) => a.topic.toLowerCase().includes(topic.toLowerCase()) ||
                   topic.toLowerCase().includes(a.topic.toLowerCase())
          );
          nodes.push({
            id, subject, topic, prerequisites: prereqs,
            mastery: atom ? atom.strength : 0, priority, estimatedHours: hours,
          });
        }
      }
      const edges = buildEdges(nodes);
      return { nodes, edges, student: { ...student, exam: viewExam } };
    }

    const { data: dbNodes } = await supabaseAdmin
      .from("curriculum_nodes").select("*").eq("student_id", student.id);

    // If no curriculum nodes exist yet, generate them from atoms + exam syllabus
    if (!dbNodes || dbNodes.length === 0) {
      const { data: atoms } = await supabaseAdmin
        .from("memory_atoms").select("*").eq("student_id", student.id);

      const syllabusMap = buildSyllabus(student.exam);

      // Seed curriculum from syllabus + actual atoms
      const seeded: Array<{
        student_id: string; subject: string; topic: string;
        prerequisites: string[]; mastery: number; priority: number; estimated_hours: number;
      }> = [];
      const seen = new Set<string>();

      for (const [subject, topics] of Object.entries(syllabusMap)) {
        for (const { topic, prereqs, hours, priority } of topics) {
          const key = `${subject}::${topic}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const atom = (atoms ?? []).find(
            (a) => a.topic.toLowerCase().includes(topic.toLowerCase()) ||
                   topic.toLowerCase().includes(a.topic.toLowerCase())
          );
          seeded.push({
            student_id: student.id,
            subject,
            topic,
            prerequisites: prereqs,
            mastery: atom ? atom.strength : 0,
            priority,
            estimated_hours: hours,
          });
        }
      }

      if (seeded.length > 0) {
        await supabaseAdmin.from("curriculum_nodes").insert(seeded).select();
      }

      const nodes = seeded.map((n, i) => ({
        id: `${n.subject}::${n.topic}`,
        subject: n.subject,
        topic: n.topic,
        prerequisites: n.prerequisites,
        mastery: n.mastery,
        priority: n.priority,
        estimatedHours: n.estimated_hours,
      }));

      const edges = buildEdges(nodes);
      return { nodes, edges, student };
    }

    const nodes = dbNodes.map((n) => ({
      id: `${n.subject}::${n.topic}`,
      subject: n.subject,
      topic: n.topic,
      prerequisites: n.prerequisites ?? [],
      mastery: n.mastery ?? 0,
      priority: n.priority ?? 5,
      estimatedHours: n.estimated_hours ?? 2,
    }));
    const edges = buildEdges(nodes);
    return { nodes, edges, student };
  });

function buildEdges(nodes: Array<{ id: string; topic: string; prerequisites: string[] }>) {
  const edges: Array<{ source: string; target: string }> = [];
  const topicToId = new Map(nodes.map((n) => [n.topic.toLowerCase(), n.id]));
  for (const node of nodes) {
    for (const prereq of node.prerequisites) {
      const srcId = topicToId.get(prereq.toLowerCase());
      if (srcId && srcId !== node.id) {
        edges.push({ source: srcId, target: node.id });
      }
    }
  }
  return edges;
}

function buildSyllabus(exam: string) {
  // Chapters follow the official NTA syllabus (JEE Main 2025 / NEET UG).
  // priority approximates exam weightage (10 = highest-scoring units).
  if (exam === "JEE") {
    return {
      "Mathematics": [
        { topic: "Sets, Relations & Functions", prereqs: [], hours: 3, priority: 6 },
        { topic: "Complex Numbers & Quadratic Equations", prereqs: ["Sets, Relations & Functions"], hours: 4, priority: 8 },
        { topic: "Matrices & Determinants", prereqs: ["Sets, Relations & Functions"], hours: 4, priority: 8 },
        { topic: "Permutations & Combinations", prereqs: ["Sets, Relations & Functions"], hours: 3, priority: 7 },
        { topic: "Binomial Theorem", prereqs: ["Permutations & Combinations"], hours: 2, priority: 7 },
        { topic: "Sequence & Series", prereqs: ["Sets, Relations & Functions"], hours: 3, priority: 7 },
        { topic: "Trigonometry", prereqs: ["Sets, Relations & Functions"], hours: 4, priority: 7 },
        { topic: "Limit, Continuity & Differentiability", prereqs: ["Trigonometry"], hours: 5, priority: 9 },
        { topic: "Integral Calculus", prereqs: ["Limit, Continuity & Differentiability"], hours: 6, priority: 10 },
        { topic: "Differential Equations", prereqs: ["Integral Calculus"], hours: 3, priority: 8 },
        { topic: "Coordinate Geometry", prereqs: ["Trigonometry"], hours: 5, priority: 9 },
        { topic: "Three Dimensional Geometry", prereqs: ["Coordinate Geometry"], hours: 3, priority: 8 },
        { topic: "Vector Algebra", prereqs: ["Three Dimensional Geometry"], hours: 3, priority: 8 },
        { topic: "Statistics & Probability", prereqs: ["Permutations & Combinations"], hours: 3, priority: 8 },
      ],
      "Physics": [
        { topic: "Physics & Measurement", prereqs: [], hours: 2, priority: 5 },
        { topic: "Kinematics", prereqs: ["Physics & Measurement"], hours: 3, priority: 8 },
        { topic: "Laws of Motion", prereqs: ["Kinematics"], hours: 4, priority: 9 },
        { topic: "Work, Energy & Power", prereqs: ["Laws of Motion"], hours: 3, priority: 8 },
        { topic: "Rotational Motion", prereqs: ["Laws of Motion"], hours: 5, priority: 9 },
        { topic: "Gravitation", prereqs: ["Laws of Motion"], hours: 3, priority: 7 },
        { topic: "Properties of Solids & Liquids", prereqs: ["Laws of Motion"], hours: 3, priority: 7 },
        { topic: "Thermodynamics", prereqs: ["Work, Energy & Power"], hours: 4, priority: 8 },
        { topic: "Kinetic Theory of Gases", prereqs: ["Thermodynamics"], hours: 2, priority: 7 },
        { topic: "Oscillations & Waves", prereqs: ["Laws of Motion"], hours: 4, priority: 8 },
        { topic: "Electrostatics", prereqs: [], hours: 5, priority: 9 },
        { topic: "Current Electricity", prereqs: ["Electrostatics"], hours: 4, priority: 9 },
        { topic: "Magnetic Effects of Current & Magnetism", prereqs: ["Current Electricity"], hours: 4, priority: 8 },
        { topic: "Electromagnetic Induction & Alternating Currents", prereqs: ["Magnetic Effects of Current & Magnetism"], hours: 4, priority: 9 },
        { topic: "Electromagnetic Waves", prereqs: ["Electromagnetic Induction & Alternating Currents"], hours: 2, priority: 6 },
        { topic: "Optics", prereqs: ["Oscillations & Waves"], hours: 4, priority: 8 },
        { topic: "Dual Nature of Matter & Radiation", prereqs: ["Electrostatics"], hours: 2, priority: 8 },
        { topic: "Atoms & Nuclei", prereqs: ["Dual Nature of Matter & Radiation"], hours: 3, priority: 9 },
        { topic: "Electronic Devices", prereqs: ["Atoms & Nuclei"], hours: 3, priority: 8 },
        { topic: "Experimental Skills", prereqs: ["Physics & Measurement"], hours: 2, priority: 6 },
      ],
      "Chemistry": [
        { topic: "Some Basic Concepts in Chemistry", prereqs: [], hours: 3, priority: 8 },
        { topic: "Atomic Structure", prereqs: ["Some Basic Concepts in Chemistry"], hours: 3, priority: 8 },
        { topic: "Chemical Bonding & Molecular Structure", prereqs: ["Atomic Structure"], hours: 4, priority: 9 },
        { topic: "Chemical Thermodynamics", prereqs: ["Some Basic Concepts in Chemistry"], hours: 4, priority: 8 },
        { topic: "Solutions", prereqs: ["Some Basic Concepts in Chemistry"], hours: 3, priority: 7 },
        { topic: "Equilibrium", prereqs: ["Chemical Thermodynamics"], hours: 4, priority: 8 },
        { topic: "Redox Reactions & Electrochemistry", prereqs: ["Some Basic Concepts in Chemistry"], hours: 3, priority: 8 },
        { topic: "Chemical Kinetics", prereqs: ["Chemical Thermodynamics"], hours: 3, priority: 8 },
        { topic: "Classification of Elements & Periodicity", prereqs: ["Atomic Structure"], hours: 3, priority: 8 },
        { topic: "s-Block Elements", prereqs: ["Classification of Elements & Periodicity"], hours: 2, priority: 6 },
        { topic: "p-Block Elements", prereqs: ["Classification of Elements & Periodicity"], hours: 4, priority: 8 },
        { topic: "d- & f-Block Elements", prereqs: ["Classification of Elements & Periodicity"], hours: 3, priority: 8 },
        { topic: "Coordination Compounds", prereqs: ["Chemical Bonding & Molecular Structure"], hours: 4, priority: 9 },
        { topic: "Basic Principles of Organic Chemistry", prereqs: ["Chemical Bonding & Molecular Structure"], hours: 5, priority: 9 },
        { topic: "Hydrocarbons", prereqs: ["Basic Principles of Organic Chemistry"], hours: 4, priority: 8 },
        { topic: "Organic Compounds Containing Halogens", prereqs: ["Hydrocarbons"], hours: 3, priority: 7 },
        { topic: "Organic Compounds Containing Oxygen", prereqs: ["Hydrocarbons"], hours: 4, priority: 8 },
        { topic: "Organic Compounds Containing Nitrogen", prereqs: ["Organic Compounds Containing Oxygen"], hours: 3, priority: 8 },
        { topic: "Biomolecules", prereqs: ["Basic Principles of Organic Chemistry"], hours: 2, priority: 7 },
        { topic: "Principles Related to Practical Chemistry", prereqs: ["Some Basic Concepts in Chemistry"], hours: 2, priority: 6 },
      ],
    };
  }
  // NEET (UG) — Botany & Zoology per the NTA subject split.
  return {
    "Physics": [
      { topic: "Physical World & Measurement", prereqs: [], hours: 2, priority: 5 },
      { topic: "Kinematics", prereqs: ["Physical World & Measurement"], hours: 3, priority: 7 },
      { topic: "Laws of Motion", prereqs: ["Kinematics"], hours: 3, priority: 8 },
      { topic: "Work, Energy & Power", prereqs: ["Laws of Motion"], hours: 2, priority: 7 },
      { topic: "Rotational Motion", prereqs: ["Laws of Motion"], hours: 3, priority: 7 },
      { topic: "Gravitation", prereqs: ["Laws of Motion"], hours: 2, priority: 6 },
      { topic: "Properties of Solids & Liquids", prereqs: ["Laws of Motion"], hours: 2, priority: 6 },
      { topic: "Thermodynamics", prereqs: ["Work, Energy & Power"], hours: 3, priority: 8 },
      { topic: "Kinetic Theory of Gases", prereqs: ["Thermodynamics"], hours: 2, priority: 6 },
      { topic: "Oscillations & Waves", prereqs: ["Laws of Motion"], hours: 3, priority: 7 },
      { topic: "Electrostatics", prereqs: [], hours: 3, priority: 8 },
      { topic: "Current Electricity", prereqs: ["Electrostatics"], hours: 3, priority: 8 },
      { topic: "Magnetic Effects of Current & Magnetism", prereqs: ["Current Electricity"], hours: 3, priority: 7 },
      { topic: "Electromagnetic Induction & Alternating Currents", prereqs: ["Magnetic Effects of Current & Magnetism"], hours: 3, priority: 7 },
      { topic: "Electromagnetic Waves", prereqs: ["Electromagnetic Induction & Alternating Currents"], hours: 1, priority: 6 },
      { topic: "Optics", prereqs: ["Oscillations & Waves"], hours: 3, priority: 8 },
      { topic: "Dual Nature of Matter & Radiation", prereqs: ["Electrostatics"], hours: 2, priority: 8 },
      { topic: "Atoms & Nuclei", prereqs: ["Dual Nature of Matter & Radiation"], hours: 2, priority: 8 },
      { topic: "Electronic Devices", prereqs: ["Atoms & Nuclei"], hours: 2, priority: 8 },
    ],
    "Chemistry": [
      { topic: "Some Basic Concepts in Chemistry", prereqs: [], hours: 3, priority: 8 },
      { topic: "Atomic Structure", prereqs: ["Some Basic Concepts in Chemistry"], hours: 3, priority: 8 },
      { topic: "Chemical Bonding & Molecular Structure", prereqs: ["Atomic Structure"], hours: 3, priority: 9 },
      { topic: "Chemical Thermodynamics", prereqs: ["Some Basic Concepts in Chemistry"], hours: 3, priority: 7 },
      { topic: "Solutions", prereqs: ["Some Basic Concepts in Chemistry"], hours: 2, priority: 7 },
      { topic: "Equilibrium", prereqs: ["Chemical Thermodynamics"], hours: 3, priority: 8 },
      { topic: "Redox Reactions & Electrochemistry", prereqs: ["Some Basic Concepts in Chemistry"], hours: 2, priority: 7 },
      { topic: "Chemical Kinetics", prereqs: ["Chemical Thermodynamics"], hours: 2, priority: 7 },
      { topic: "Classification of Elements & Periodicity", prereqs: ["Atomic Structure"], hours: 3, priority: 8 },
      { topic: "p-Block Elements", prereqs: ["Classification of Elements & Periodicity"], hours: 3, priority: 8 },
      { topic: "d- & f-Block Elements", prereqs: ["Classification of Elements & Periodicity"], hours: 2, priority: 7 },
      { topic: "Coordination Compounds", prereqs: ["Chemical Bonding & Molecular Structure"], hours: 3, priority: 8 },
      { topic: "Basic Principles of Organic Chemistry", prereqs: ["Chemical Bonding & Molecular Structure"], hours: 4, priority: 9 },
      { topic: "Hydrocarbons", prereqs: ["Basic Principles of Organic Chemistry"], hours: 3, priority: 8 },
      { topic: "Organic Compounds Containing Halogens", prereqs: ["Hydrocarbons"], hours: 2, priority: 7 },
      { topic: "Organic Compounds Containing Oxygen", prereqs: ["Hydrocarbons"], hours: 3, priority: 8 },
      { topic: "Organic Compounds Containing Nitrogen", prereqs: ["Organic Compounds Containing Oxygen"], hours: 2, priority: 8 },
      { topic: "Biomolecules", prereqs: ["Basic Principles of Organic Chemistry"], hours: 2, priority: 8 },
    ],
    "Botany": [
      { topic: "Diversity in the Living World", prereqs: [], hours: 4, priority: 9 },
      { topic: "Structural Organisation in Plants", prereqs: ["Diversity in the Living World"], hours: 3, priority: 7 },
      { topic: "Cell Structure & Function", prereqs: [], hours: 4, priority: 9 },
      { topic: "Plant Physiology", prereqs: ["Cell Structure & Function"], hours: 5, priority: 9 },
      { topic: "Sexual Reproduction in Flowering Plants", prereqs: ["Structural Organisation in Plants"], hours: 3, priority: 8 },
      { topic: "Principles of Inheritance & Variation", prereqs: ["Cell Structure & Function"], hours: 5, priority: 10 },
      { topic: "Molecular Basis of Inheritance", prereqs: ["Principles of Inheritance & Variation"], hours: 4, priority: 9 },
    ],
    "Zoology": [
      { topic: "Structural Organisation in Animals", prereqs: [], hours: 3, priority: 7 },
      { topic: "Human Physiology", prereqs: ["Structural Organisation in Animals"], hours: 6, priority: 10 },
      { topic: "Human Reproduction & Reproductive Health", prereqs: ["Human Physiology"], hours: 4, priority: 9 },
      { topic: "Evolution", prereqs: [], hours: 3, priority: 8 },
      { topic: "Biology & Human Welfare", prereqs: ["Human Physiology"], hours: 3, priority: 8 },
      { topic: "Biotechnology & Its Applications", prereqs: ["Molecular Basis of Inheritance"], hours: 3, priority: 9 },
      { topic: "Ecology & Environment", prereqs: [], hours: 4, priority: 9 },
    ],
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Learner Model
// ─────────────────────────────────────────────────────────────────────────────

export const getLearnerModel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;

    const { data: student } = await supabaseAdmin
      .from("students").select("*").eq("auth_user_id", uid).maybeSingle();
    if (!student) return null;

    const sid = student.id;
    const [atoms, bonds, weak, reflections, agentRuns, threads] = await Promise.all([
      supabaseAdmin.from("memory_atoms").select("*").eq("student_id", sid),
      supabaseAdmin.from("memory_bonds").select("*").eq("student_id", sid),
      supabaseAdmin.from("weak_topics").select("*").eq("student_id", sid).order("severity", { ascending: false }),
      supabaseAdmin.from("reflections").select("*").eq("student_id", sid).order("created_at", { ascending: true }),
      supabaseAdmin.from("agent_runs").select("*").eq("student_id", sid).order("created_at", { ascending: false }).limit(20),
      supabaseAdmin.from("threads").select("id, created_at").eq("student_id", sid),
    ]);

    const atomList = atoms.data ?? [];
    const reflList = reflections.data ?? [];

    // Compute metrics
    const avgStrength = atomList.length
      ? atomList.reduce((s, a) => s + a.strength, 0) / atomList.length
      : 0;

    // Group atoms by subject
    const subjectMap: Record<string, { count: number; totalStrength: number }> = {};
    for (const a of atomList) {
      if (!subjectMap[a.subject]) subjectMap[a.subject] = { count: 0, totalStrength: 0 };
      subjectMap[a.subject].count++;
      subjectMap[a.subject].totalStrength += a.strength;
    }
    const subjectScores = Object.entries(subjectMap).map(([subject, v]) => ({
      subject,
      atomCount: v.count,
      avgStrength: parseFloat((v.totalStrength / v.count).toFixed(3)),
    })).sort((a, b) => b.avgStrength - a.avgStrength);

    // Learning velocity (atoms per day, based on atom creation dates)
    const daysSinceFirst = atomList.length
      ? Math.max(1, daysBetween(atomList.reduce((min, a) =>
          a.created_at < min ? a.created_at : min, atomList[0].created_at)))
      : 1;
    const learningVelocity = parseFloat((atomList.length / daysSinceFirst).toFixed(2));

    // Retention rate: proportion of atoms with strength > 0.6
    const retentionRate = atomList.length
      ? parseFloat((atomList.filter((a) => a.strength > 0.6).length / atomList.length).toFixed(3))
      : 0;

    // Predicted score: heuristic based on avg strength, retention, velocity
    const predictedScore = parseFloat(Math.min(100, (
      avgStrength * 60 + retentionRate * 25 + Math.min(learningVelocity, 5) * 3
    )).toFixed(1));

    // Study pattern from reflections
    const studyDays = new Set(reflList.map((r) => new Date(r.created_at).toISOString().slice(0, 10)));
    const streak = computeStreak(studyDays);

    // Most-reviewed topics
    const topReviewed = [...atomList]
      .sort((a, b) => b.reviews - a.reviews)
      .slice(0, 5)
      .map((a) => ({ topic: a.topic, subject: a.subject, reviews: a.reviews, strength: a.strength }));

    // Topics at risk (low strength, not reviewed recently)
    const now = Date.now();
    const atRisk = atomList
      .filter((a) => a.strength < 0.4 || daysBetween(a.last_reviewed) > 7)
      .sort((a, b) => a.strength - b.strength)
      .slice(0, 5)
      .map((a) => ({
        topic: a.topic,
        subject: a.subject,
        strength: a.strength,
        daysSinceReview: Math.round(daysBetween(a.last_reviewed)),
      }));

    // Inferred learning style
    const learningStyle = inferLearningStyle(atomList, reflList, agentRuns.data ?? []);

    return {
      student,
      metrics: {
        totalAtoms: atomList.length,
        totalBonds: (bonds.data ?? []).length,
        avgStrength: parseFloat(avgStrength.toFixed(3)),
        learningVelocity,
        retentionRate,
        predictedScore,
        sessionCount: (threads.data ?? []).length,
        studyStreak: streak,
        weakTopicCount: (weak.data ?? []).length,
      },
      subjectScores,
      topReviewed,
      atRisk,
      learningStyle,
      recentReflections: reflList.slice(-3).reverse(),
    };
  });

function computeStreak(studyDays: Set<string>): number {
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (studyDays.has(key)) streak++;
    else if (i > 0) break;
  }
  return streak;
}

function inferLearningStyle(atoms: any[], reflections: any[], runs: any[]) {
  const totalReviews = atoms.reduce((s, a) => s + a.reviews, 0);
  const avgReviews = atoms.length ? totalReviews / atoms.length : 0;

  if (avgReviews > 5) return { style: "Mastery Learner", description: "Revisits topics many times until strong retention." };
  if (reflections.length > 10) return { style: "Reflective Learner", description: "Regularly reviews and synthesises session learnings." };
  if (atoms.length > 30) return { style: "Breadth-First Explorer", description: "Covers many topics rapidly, building a wide knowledge base." };
  return { style: "Depth-First Learner", description: "Focuses intensely on a small set of topics before moving on." };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Learning Simulator (enhanced version of simulateSession)
// ─────────────────────────────────────────────────────────────────────────────

export const runLearningSimulator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      studentId: z.string().uuid(),
      strategy: z.enum(["spaced_repetition", "weakest_first", "strongest_first", "random"]).default("spaced_repetition"),
      intensity: z.number().min(0.1).max(1).default(0.5),
    }).parse(i)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sid = data.studentId;
    const { data: atoms } = await supabaseAdmin.from("memory_atoms").select("*").eq("student_id", sid);
    if (!atoms || atoms.length === 0) return { ok: true, before: [], after: [], delta: 0, summary: "No atoms yet." };

    const before = atoms.map((a) => ({ id: a.id, topic: a.topic, subject: a.subject, strength: a.strength }));

    // Select atoms to work on based on strategy
    let toStudy = [...atoms];
    if (data.strategy === "weakest_first") toStudy.sort((a, b) => a.strength - b.strength);
    else if (data.strategy === "strongest_first") toStudy.sort((a, b) => b.strength - a.strength);
    else if (data.strategy === "random") toStudy.sort(() => Math.random() - 0.5);
    else {
      // spaced_repetition: prioritize atoms with lowest strength * recency
      toStudy.sort((a, b) => {
        const scoreA = a.strength * Math.exp(-0.1 * daysBetween(a.last_reviewed));
        const scoreB = b.strength * Math.exp(-0.1 * daysBetween(b.last_reviewed));
        return scoreA - scoreB;
      });
    }

    const studyCount = Math.max(1, Math.floor(toStudy.length * data.intensity));
    const studied = toStudy.slice(0, studyCount);

    // Apply strength changes
    let totalDelta = 0;
    for (const a of studied) {
      const daysSince = daysBetween(a.last_reviewed);
      const decayedStrength = ebbinghaus(a.strength, a.reviews, daysSince);
      const gain = (1 - decayedStrength) * 0.12 * (1 + Math.random() * 0.1);
      const next = Math.min(0.98, decayedStrength + gain);
      totalDelta += next - a.strength;
      await supabaseAdmin.from("memory_atoms").update({
        strength: parseFloat(next.toFixed(4)),
        reviews: a.reviews + 1,
        last_reviewed: new Date().toISOString(),
      }).eq("id", a.id);
    }

    // Record the simulation run
    const { data: updatedAtoms } = await supabaseAdmin.from("memory_atoms").select("*").eq("student_id", sid);
    const after = (updatedAtoms ?? []).map((a) => ({
      id: a.id, topic: a.topic, subject: a.subject, strength: a.strength,
    }));

    const summary = `${data.strategy.replace("_", " ")} simulation: studied ${studyCount}/${atoms.length} atoms. Average Δ strength: ${(totalDelta / studyCount).toFixed(3)}.`;

    await supabaseAdmin.from("simulation_runs").insert({
      student_id: sid,
      atoms_before: before,
      atoms_after: after,
      delta_summary: summary,
      strategy: data.strategy,
    });

    await supabaseAdmin.from("reflections").insert({
      student_id: sid,
      summary,
      bonds_added: 0,
      atoms_added: 0,
      next_focus: `Next: reinforce the ${Math.min(3, atoms.length)} weakest atoms.`,
    });

    return { ok: true, before, after, delta: totalDelta, summary };
  });

export const getSimulationHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: student } = await supabaseAdmin
      .from("students").select("id").eq("auth_user_id", uid).maybeSingle();
    if (!student) return { runs: [] };
    const { data: runs } = await supabaseAdmin
      .from("simulation_runs").select("id, strategy, delta_summary, created_at")
      .eq("student_id", student.id).order("created_at", { ascending: false }).limit(10);
    return { runs: runs ?? [] };
  });

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Enhanced Critic
// Richer reflection that breaks down by subject and suggests next steps
// ─────────────────────────────────────────────────────────────────────────────

export const getEnhancedCritique = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: student } = await supabaseAdmin
      .from("students").select("*").eq("auth_user_id", uid).maybeSingle();
    if (!student) return null;

    const sid = student.id;
    const [atoms, weak, reflections] = await Promise.all([
      supabaseAdmin.from("memory_atoms").select("*").eq("student_id", sid),
      supabaseAdmin.from("weak_topics").select("*").eq("student_id", sid).order("severity", { ascending: false }),
      supabaseAdmin.from("reflections").select("*").eq("student_id", sid)
        .order("created_at", { ascending: false }).limit(5),
    ]);

    const atomList = atoms.data ?? [];
    const weakList = weak.data ?? [];
    const reflList = reflections.data ?? [];

    const subjectMap: Record<string, { atoms: any[]; weakCount: number }> = {};
    for (const a of atomList) {
      if (!subjectMap[a.subject]) subjectMap[a.subject] = { atoms: [], weakCount: 0 };
      subjectMap[a.subject].atoms.push(a);
    }
    for (const w of weakList) {
      if (subjectMap[w.subject]) subjectMap[w.subject].weakCount++;
    }

    const subjectCritiques = Object.entries(subjectMap).map(([subject, v]) => {
      const avgStr = v.atoms.reduce((s, a) => s + a.strength, 0) / v.atoms.length;
      const staleAtoms = v.atoms.filter((a) => daysBetween(a.last_reviewed) > 7);
      let status: "strong" | "moderate" | "weak" = "strong";
      if (avgStr < 0.4 || v.weakCount > 2) status = "weak";
      else if (avgStr < 0.65) status = "moderate";

      const actions: string[] = [];
      if (staleAtoms.length > 0) actions.push(`Re-review ${staleAtoms.length} stale topics`);
      if (v.weakCount > 0) actions.push(`Fix ${v.weakCount} weak spots`);
      if (avgStr > 0.75) actions.push("Progress to advanced problems");

      return {
        subject,
        status,
        avgStrength: parseFloat(avgStr.toFixed(3)),
        atomCount: v.atoms.length,
        weakCount: v.weakCount,
        staleCount: staleAtoms.length,
        topWeakTopics: weakList.filter((w) => w.subject === subject).slice(0, 3),
        actions,
      };
    });

    // Overall critique
    const overallStrength = atomList.length
      ? atomList.reduce((s, a) => s + a.strength, 0) / atomList.length
      : 0;

    const overallGrade =
      overallStrength > 0.8 ? "A" :
      overallStrength > 0.65 ? "B" :
      overallStrength > 0.5 ? "C" :
      overallStrength > 0.35 ? "D" : "F";

    return {
      student,
      overallGrade,
      overallStrength: parseFloat(overallStrength.toFixed(3)),
      subjectCritiques,
      recentReflections: reflList,
      priorityActions: subjectCritiques
        .filter((s) => s.status !== "strong")
        .flatMap((s) => s.actions.map((a) => ({ subject: s.subject, action: a })))
        .slice(0, 5),
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — Exam Strategy
// ─────────────────────────────────────────────────────────────────────────────

export const getExamStrategy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: student } = await supabaseAdmin
      .from("students").select("*").eq("auth_user_id", uid).maybeSingle();
    if (!student) return null;

    const sid = student.id;
    const [atoms, weak] = await Promise.all([
      supabaseAdmin.from("memory_atoms").select("*").eq("student_id", sid),
      supabaseAdmin.from("weak_topics").select("*").eq("student_id", sid).order("severity", { ascending: false }).limit(5),
    ]);

    const atomList = atoms.data ?? [];
    const weakList = weak.data ?? [];

    // Saved strategy
    const { data: saved } = await supabaseAdmin
      .from("exam_strategies").select("*").eq("student_id", sid)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    const subjectMap: Record<string, { count: number; avgStrength: number }> = {};
    for (const a of atomList) {
      if (!subjectMap[a.subject]) subjectMap[a.subject] = { count: 0, avgStrength: 0 };
      subjectMap[a.subject].count++;
      subjectMap[a.subject].avgStrength += a.strength;
    }
    for (const s of Object.keys(subjectMap)) {
      subjectMap[s].avgStrength = subjectMap[s].avgStrength / subjectMap[s].count;
    }

    const weakSubjects = Object.entries(subjectMap)
      .sort(([, a], [, b]) => a.avgStrength - b.avgStrength)
      .map(([sub]) => sub);

    const strategy = {
      exam: student.exam,
      weeksToExam: 12,
      weeklyPlan: [
        { weeks: "1–2", focus: weakSubjects[0] ?? "Foundation", action: "Intensive weak-topic revision. 4h/day. Focus: " + (weakList[0]?.topic ?? "all weak topics") + "." },
        { weeks: "3–4", focus: weakSubjects[1] ?? "Core concepts", action: "Concept solidification. Practice 30 questions/day on new topics." },
        { weeks: "5–6", focus: "Mixed practice", action: "Chapter-wise tests. Time yourself strictly. Aim > 70% accuracy." },
        { weeks: "7–8", focus: "Full-length mocks", action: "2 full mock tests/week. Analyze every mistake." },
        { weeks: "9–10", focus: "Revision sprints", action: "Rapid atom review using spaced-repetition. 5h/day." },
        { weeks: "11–12", focus: "Polish & confidence", action: "Only strengths. Light mock tests. Sleep 7h+ before exam." },
      ],
      dailyRoutine: [
        { time: "6–8 AM", task: "Fresh topic study (highest cognitive load)." },
        { time: "10 AM–12 PM", task: "Practice problems + atom review." },
        { time: "2–4 PM", task: "Weak topic targeted drilling." },
        { time: "6–8 PM", task: "Mock test or chapter test." },
        { time: "9–10 PM", task: "Light revision + reflection." },
      ],
      keyWarnings: weakList.slice(0, 3).map((w) =>
        `⚠ "${w.topic}" (${w.subject}) is at ${(w.severity * 100).toFixed(0)}% severity — address in Week 1.`
      ),
    };

    return { student, strategy, savedStrategy: saved };
  });

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — Counterfactual Analysis
// ─────────────────────────────────────────────────────────────────────────────

export const getCounterfactuals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: student } = await supabaseAdmin
      .from("students").select("*").eq("auth_user_id", uid).maybeSingle();
    if (!student) return null;

    const sid = student.id;
    const [atoms, reflections] = await Promise.all([
      supabaseAdmin.from("memory_atoms").select("*").eq("student_id", sid),
      supabaseAdmin.from("reflections").select("*").eq("student_id", sid).order("created_at", { ascending: false }).limit(5),
    ]);

    const atomList = atoms.data ?? [];
    const avgStr = atomList.length ? atomList.reduce((s, a) => s + a.strength, 0) / atomList.length : 0;

    // Generate "what if" scenarios based on current state
    const subjectMap: Record<string, number[]> = {};
    for (const a of atomList) {
      if (!subjectMap[a.subject]) subjectMap[a.subject] = [];
      subjectMap[a.subject].push(a.strength);
    }

    const scenarios = Object.entries(subjectMap).map(([subject, strengths]) => {
      const avg = strengths.reduce((s, v) => s + v, 0) / strengths.length;
      const potentialScore = Math.min(100, avg * 100 + 15);
      const currentScore = avg * 100;
      return {
        subject,
        scenario: `What if you studied ${subject} 2 extra hours/day?`,
        currentProjected: parseFloat(currentScore.toFixed(1)),
        alternativeProjected: parseFloat(potentialScore.toFixed(1)),
        uplift: parseFloat((potentialScore - currentScore).toFixed(1)),
        recommendation: avg < 0.5
          ? `High priority: ${subject} has the most room for improvement.`
          : `${subject} is solid. Marginal gains only.`,
      };
    }).sort((a, b) => b.uplift - a.uplift);

    const logs = await supabaseAdmin
      .from("counterfactual_logs").select("*").eq("student_id", sid)
      .order("created_at", { ascending: false }).limit(5);

    return { student, scenarios, recentLogs: logs.data ?? [] };
  });

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — Root-cause traversal on the curriculum graph
// "Student fails X → root causes Y, Z" weakness causation traversal
// ─────────────────────────────────────────────────────────────────────────────

export const getRootCauseChain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ topic: z.string(), subject: z.string().optional() }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;

    const { data: student } = await supabaseAdmin
      .from("students").select("id").eq("auth_user_id", uid).maybeSingle();
    if (!student) return { chain: [], roots: [], target: null };

    const { data: nodes } = await supabaseAdmin
      .from("curriculum_nodes").select("*").eq("student_id", student.id);
    if (!nodes || nodes.length === 0) return { chain: [], roots: [], target: null };

    const byTopic = new Map<string, any>();
    for (const n of nodes) byTopic.set(n.topic.toLowerCase(), n);

    const target = byTopic.get(data.topic.toLowerCase());
    if (!target) return { chain: [], roots: [], target: null };

    // BFS through prerequisites; mark weak ancestors (mastery < 0.6) as root causes.
    const visited = new Set<string>();
    const chain: Array<{
      topic: string; subject: string; mastery: number; depth: number;
      reason: "weak_prerequisite" | "stale" | "ok";
      causes: string[];
    }> = [];
    const roots: Array<{ topic: string; subject: string; mastery: number; depth: number }> = [];

    const queue: Array<{ node: any; depth: number }> = [{ node: target, depth: 0 }];
    while (queue.length) {
      const { node, depth } = queue.shift()!;
      const key = node.topic.toLowerCase();
      if (visited.has(key)) continue;
      visited.add(key);

      const reason: "weak_prerequisite" | "stale" | "ok" =
        node.mastery < 0.6 ? "weak_prerequisite" : "ok";

      chain.push({
        topic: node.topic,
        subject: node.subject,
        mastery: node.mastery,
        depth,
        reason,
        causes: node.prerequisites ?? [],
      });

      // Walk into prerequisites
      for (const prereq of (node.prerequisites ?? []) as string[]) {
        const p = byTopic.get(prereq.toLowerCase());
        if (p && !visited.has(p.topic.toLowerCase())) {
          queue.push({ node: p, depth: depth + 1 });
        }
      }

      // If a prereq is weak AND has no further weak prereqs, it's a root cause
      if (depth > 0 && node.mastery < 0.5) {
        const upstreamWeak = (node.prerequisites ?? []).some((pr: string) => {
          const p = byTopic.get(pr.toLowerCase());
          return p && p.mastery < 0.5;
        });
        if (!upstreamWeak) {
          roots.push({
            topic: node.topic, subject: node.subject,
            mastery: node.mastery, depth,
          });
        }
      }
    }

    // If the target itself is weak and has no prereqs, it IS the root.
    if (roots.length === 0 && target.mastery < 0.6) {
      roots.push({
        topic: target.topic, subject: target.subject,
        mastery: target.mastery, depth: 0,
      });
    }

    return {
      target: {
        topic: target.topic, subject: target.subject,
        mastery: target.mastery,
      },
      chain,
      roots: roots.sort((a, b) => a.mastery - b.mastery),
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — Mistake pattern tracking
// ─────────────────────────────────────────────────────────────────────────────

export const recordMistakePattern = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      subject: z.string(),
      topic: z.string(),
      pattern: z.string().min(1).max(200),
      description: z.string().max(2000).default(""),
      category: z.enum(["conceptual", "procedural", "careless", "misconception", "prerequisite_gap"])
        .default("conceptual"),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: student } = await supabaseAdmin
      .from("students").select("id").eq("auth_user_id", uid).maybeSingle();
    if (!student) throw new Error("Student profile not found");

    // Upsert by (student, subject, topic, pattern); bump occurrences if it exists.
    const { data: existing } = await supabaseAdmin
      .from("mistake_patterns")
      .select("id, occurrences")
      .eq("student_id", student.id)
      .eq("subject", data.subject)
      .eq("topic", data.topic)
      .eq("pattern", data.pattern)
      .maybeSingle();

    if (existing) {
      const { data: row, error } = await supabaseAdmin
        .from("mistake_patterns")
        .update({
          occurrences: existing.occurrences + 1,
          last_seen: new Date().toISOString(),
          description: data.description || undefined,
          category: data.category,
        })
        .eq("id", existing.id)
        .select().single();
      if (error) throw new Error(error.message);
      return row;
    }

    const { data: row, error } = await supabaseAdmin
      .from("mistake_patterns")
      .insert({
        student_id: student.id,
        subject: data.subject,
        topic: data.topic,
        pattern: data.pattern,
        description: data.description,
        category: data.category,
      })
      .select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getMistakePatterns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: student } = await supabaseAdmin
      .from("students").select("id").eq("auth_user_id", uid).maybeSingle();
    if (!student) return { patterns: [], byCategory: {} };

    const { data: patterns } = await supabaseAdmin
      .from("mistake_patterns")
      .select("*")
      .eq("student_id", student.id)
      .order("occurrences", { ascending: false });

    const byCategory: Record<string, number> = {};
    for (const p of patterns ?? []) {
      byCategory[p.category] = (byCategory[p.category] ?? 0) + p.occurrences;
    }
    return { patterns: patterns ?? [], byCategory };
  });

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — Mock test outcome tracking
// ─────────────────────────────────────────────────────────────────────────────

export const recordMockTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      name: z.string().min(1).max(200),
      testType: z.enum(["full", "sectional", "chapter", "previous_year"]).default("full"),
      subjects: z.array(z.string()).default([]),
      score: z.number().min(0).max(100),
      maxScore: z.number().min(1).max(1000).default(100),
      durationMin: z.number().int().min(1).max(600).default(180),
      subjectScores: z.record(z.string(), z.number()).default({}),
      weakTopics: z.array(z.string()).default([]),
      notes: z.string().max(4000).default(""),
      // Per-question diagnostic data — each entry is one answered question
      questions: z.array(z.object({
        subject: z.string(),
        topic: z.string(),
        subtopic: z.string().default(""),
        difficulty: z.number().min(1).max(5).default(3),  // 1=easy … 5=hard
        correct: z.boolean(),
        timeTakenSec: z.number().min(0).default(0),       // actual time spent
        expectedTimeSec: z.number().min(0).default(120),  // typical time budget
        selectedOption: z.string().default(""),            // for misconception detection
        correctOption: z.string().default(""),
      })).default([]),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: student } = await supabaseAdmin
      .from("students").select("id").eq("auth_user_id", uid).maybeSingle();
    if (!student) throw new Error("Student profile not found");

    const sid = student.id;

    // ── 1. Insert the mock test row ──────────────────────────────────────────
    // Derive weak_topics automatically from wrong answers if questions provided,
    // else fall back to manual weakTopics list.
    const wrongTopics = data.questions.length > 0
      ? [...new Set(data.questions.filter((q) => !q.correct).map((q) => q.topic))]
      : data.weakTopics;

    const { data: row, error } = await supabaseAdmin
      .from("mock_tests")
      .insert({
        student_id: sid,
        name: data.name,
        test_type: data.testType,
        subjects: data.subjects,
        score: data.score,
        max_score: data.maxScore,
        duration_min: data.durationMin,
        subject_scores: data.subjectScores,
        weak_topics: wrongTopics,
        notes: data.notes,
      })
      .select().single();
    if (error) throw new Error(error.message);

    // ── 2. Mirror an overall outcome event ──────────────────────────────────
    await supabaseAdmin.from("outcome_events").insert({
      student_id: sid,
      subject: data.subjects[0] ?? "Overall",
      topic: data.name,
      score: Math.max(0, Math.min(1, data.score / Math.max(1, data.maxScore))),
      event_type: "simulation",
    });

    // ── 3. Process per-question data to update atom graph ───────────────────
    if (data.questions.length > 0) {

      // Group questions by (subject, topic) and tally performance
      type TopicKey = string;
      const topicMap: Record<TopicKey, {
        subject: string; topic: string;
        correct: number; wrong: number;
        totalTimeSec: number; totalExpectedSec: number;
        maxDifficulty: number;
        wrongOptions: string[];
      }> = {};

      for (const q of data.questions) {
        const key = `${q.subject}|||${q.topic}`;
        if (!topicMap[key]) {
          topicMap[key] = {
            subject: q.subject, topic: q.topic,
            correct: 0, wrong: 0,
            totalTimeSec: 0, totalExpectedSec: 0,
            maxDifficulty: q.difficulty,
            wrongOptions: [],
          };
        }
        const t = topicMap[key];
        if (q.correct) t.correct++; else { t.wrong++; if (q.selectedOption) t.wrongOptions.push(q.selectedOption); }
        t.totalTimeSec += q.timeTakenSec;
        t.totalExpectedSec += q.expectedTimeSec;
        t.maxDifficulty = Math.max(t.maxDifficulty, q.difficulty);
      }

      // Fetch all existing atoms for this student once
      const { data: existingAtoms } = await supabaseAdmin
        .from("memory_atoms")
        .select("id, subject, topic, strength, reviews")
        .eq("student_id", sid);

      const atomIndex: Record<string, { id: string; strength: number; reviews: number }> = {};
      for (const a of existingAtoms ?? []) {
        atomIndex[`${a.subject.toLowerCase()}|||${a.topic.toLowerCase()}`] = a;
      }

      for (const [, t] of Object.entries(topicMap)) {
        const total = t.correct + t.wrong;
        if (total === 0) continue;

        const accuracy = t.correct / total;

        // Strength delta: wrong answers push strength DOWN, correct push UP.
        // Difficulty multiplier: harder questions carry more signal.
        // Time penalty: taking > 2× expected time suggests struggle even if correct.
        const difficultyMult = 0.6 + (t.maxDifficulty - 1) * 0.1; // 0.6–1.0
        const timeRatio = t.totalExpectedSec > 0 ? t.totalTimeSec / t.totalExpectedSec : 1;
        const timePenalty = timeRatio > 2 ? 0.85 : 1.0; // slow even on correct = mild penalty

        let delta: number;
        if (accuracy >= 0.8) {
          // Strong performance → modest positive reinforcement
          delta = 0.05 * difficultyMult * timePenalty;
        } else if (accuracy >= 0.5) {
          // Mixed → small negative, likely partial understanding
          delta = -0.08 * difficultyMult;
        } else {
          // Poor performance → significant negative, scales with difficulty
          delta = -0.18 * difficultyMult;
        }

        const lookupKey = `${t.subject.toLowerCase()}|||${t.topic.toLowerCase()}`;
        const existing = atomIndex[lookupKey];

        if (existing) {
          // Update existing atom
          const newStrength = Math.max(0.05, Math.min(0.98, existing.strength + delta));
          const newState = newStrength < 0.4 ? "stuck" : newStrength < 0.65 ? "active" : "active";
          await supabaseAdmin.from("memory_atoms").update({
            strength: newStrength,
            reviews: existing.reviews + 1,
            last_reviewed: new Date().toISOString(),
            state: newState,
            summary: `Mock test: ${(accuracy * 100).toFixed(0)}% accuracy (${t.correct}/${total} correct). Difficulty ${t.maxDifficulty}/5.`,
          }).eq("id", existing.id);
        } else {
          // Create new atom seeded from exam performance
          const initStrength = Math.max(0.05, Math.min(0.5, 0.35 + delta));
          await supabaseAdmin.from("memory_atoms").insert({
            student_id: sid,
            subject: t.subject,
            topic: t.topic,
            strength: initStrength,
            reviews: 1,
            state: initStrength < 0.4 ? "stuck" : "active",
            summary: `First seen in mock test. ${(accuracy * 100).toFixed(0)}% accuracy (${t.correct}/${total} correct).`,
            last_reviewed: new Date().toISOString(),
          });
        }

        // ── 4. Write weak_topics entry for wrong-heavy topics ────────────────
        if (accuracy < 0.5) {
          const severity = Math.min(1, (1 - accuracy) * difficultyMult);
          const { data: existingWeak } = await supabaseAdmin
            .from("weak_topics")
            .select("id, severity")
            .eq("student_id", sid)
            .eq("subject", t.subject)
            .eq("topic", t.topic)
            .maybeSingle();

          if (existingWeak) {
            // Escalate severity if this is a repeat failure
            const newSeverity = Math.min(1, Math.max(existingWeak.severity, severity + 0.05));
            await supabaseAdmin.from("weak_topics").update({
              severity: newSeverity,
              evidence: `Mock test failure: ${(accuracy * 100).toFixed(0)}% accuracy. Repeated weak signal — severity escalated.`,
            }).eq("id", existingWeak.id);
          } else {
            await supabaseAdmin.from("weak_topics").insert({
              student_id: sid,
              subject: t.subject,
              topic: t.topic,
              severity,
              evidence: `Mock test: ${(accuracy * 100).toFixed(0)}% accuracy (${t.correct}/${total} correct). Difficulty ${t.maxDifficulty}/5.`,
            });
          }
        }

        // ── 5. Write misconception pattern if same wrong option chosen repeatedly
        if (t.wrongOptions.length >= 2) {
          const optionFreq: Record<string, number> = {};
          for (const o of t.wrongOptions) optionFreq[o] = (optionFreq[o] ?? 0) + 1;
          const topOption = Object.entries(optionFreq).sort((a, b) => b[1] - a[1])[0];
          if (topOption && topOption[1] >= 2) {
            const pattern = `Repeatedly selects option "${topOption[0]}" (${topOption[1]}× in mock test)`;
            const { data: existingPattern } = await supabaseAdmin
              .from("mistake_patterns")
              .select("id, occurrences")
              .eq("student_id", sid)
              .eq("subject", t.subject)
              .eq("topic", t.topic)
              .eq("pattern", pattern)
              .maybeSingle();

            if (existingPattern) {
              await supabaseAdmin.from("mistake_patterns").update({
                occurrences: existingPattern.occurrences + topOption[1],
                last_seen: new Date().toISOString(),
                category: "misconception",
              }).eq("id", existingPattern.id);
            } else {
              await supabaseAdmin.from("mistake_patterns").insert({
                student_id: sid,
                subject: t.subject,
                topic: t.topic,
                pattern,
                description: `Student consistently chose the same wrong option in mock test "${data.name}". Likely conceptual confusion or a fixed misconception.`,
                category: "misconception",
              });
            }
          }
        }
      }
    }

    return { ...row, atomsUpdated: data.questions.length > 0 };
  });

export const getMockTests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: student } = await supabaseAdmin
      .from("students").select("id").eq("auth_user_id", uid).maybeSingle();
    if (!student) return { tests: [], trend: [], avgScore: 0, best: null };

    const { data: tests } = await supabaseAdmin
      .from("mock_tests")
      .select("*")
      .eq("student_id", student.id)
      .order("taken_at", { ascending: false });

    const list = tests ?? [];
    const trend = [...list].reverse().map((t) => ({
      date: new Date(t.taken_at).toISOString().slice(0, 10),
      score: t.score,
      name: t.name,
    }));
    const avgScore = list.length
      ? parseFloat((list.reduce((s, t) => s + t.score, 0) / list.length).toFixed(1))
      : 0;
    const best = list.length
      ? list.reduce((b, t) => (t.score > b.score ? t : b), list[0])
      : null;

    return { tests: list, trend, avgScore, best };
  });

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — Critic insights: misconceptions, forgetting risk, prereq gaps
// ─────────────────────────────────────────────────────────────────────────────

export const getCriticInsights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: student } = await supabaseAdmin
      .from("students").select("id, exam").eq("auth_user_id", uid).maybeSingle();
    if (!student) return null;

    const sid = student.id;
    const [atomsR, mistakesR, nodesR] = await Promise.all([
      supabaseAdmin.from("memory_atoms").select("*").eq("student_id", sid),
      supabaseAdmin.from("mistake_patterns").select("*").eq("student_id", sid),
      supabaseAdmin.from("curriculum_nodes").select("*").eq("student_id", sid),
    ]);

    const atoms = atomsR.data ?? [];
    const mistakes = mistakesR.data ?? [];
    const nodes = nodesR.data ?? [];

    // 1) Misconceptions — patterns flagged conceptual/misconception with ≥ 2 occurrences.
    const misconceptions = mistakes
      .filter((m) => (m.category === "misconception" || m.category === "conceptual") && m.occurrences >= 2)
      .slice(0, 6)
      .map((m) => ({
        topic: m.topic,
        subject: m.subject,
        pattern: m.pattern,
        occurrences: m.occurrences,
        risk: "Will likely re-appear in similar problems — re-teach the underlying concept.",
      }));

    // 2) Forgetting risk — atoms projected to drop below 0.4 within 7 days.
    const forgetting = atoms
      .map((a) => {
        const daysSince = (Date.now() - new Date(a.last_reviewed).getTime()) / 86_400_000;
        const projected7d = ebbinghaus(a.strength, a.reviews, daysSince + 7);
        return {
          topic: a.topic,
          subject: a.subject,
          currentStrength: a.strength,
          projected7d: parseFloat(projected7d.toFixed(3)),
          willForget: projected7d < 0.4,
        };
      })
      .filter((x) => x.willForget)
      .sort((a, b) => a.projected7d - b.projected7d)
      .slice(0, 8);

    // 3) Prerequisite gaps — curriculum nodes whose prereqs are weak.
    const byTopic = new Map<string, any>();
    for (const n of nodes) byTopic.set(n.topic.toLowerCase(), n);
    const prereqGaps: Array<{
      topic: string; subject: string; mastery: number;
      weakPrereqs: Array<{ topic: string; mastery: number }>;
    }> = [];
    for (const n of nodes) {
      const weakPrereqs: Array<{ topic: string; mastery: number }> = [];
      for (const pr of (n.prerequisites ?? []) as string[]) {
        const p = byTopic.get(pr.toLowerCase());
        if (p && p.mastery < 0.5) {
          weakPrereqs.push({ topic: p.topic, mastery: p.mastery });
        }
      }
      if (weakPrereqs.length > 0 && n.mastery > 0.3) {
        prereqGaps.push({
          topic: n.topic, subject: n.subject, mastery: n.mastery, weakPrereqs,
        });
      }
    }
    prereqGaps.sort((a, b) => b.weakPrereqs.length - a.weakPrereqs.length);

    // Aggregate risk score (0–1, higher = more urgent intervention needed).
    const riskScore = Math.min(
      1,
      0.15 * misconceptions.length +
      0.08 * forgetting.length +
      0.1 * prereqGaps.length
    );

    return {
      riskScore: parseFloat(riskScore.toFixed(2)),
      misconceptions,
      forgetting: forgetting.slice(0, 8),
      prereqGaps: prereqGaps.slice(0, 6),
      summary: {
        misconceptionCount: misconceptions.length,
        forgettingCount: forgetting.length,
        prereqGapCount: prereqGaps.length,
      },
    };
  });

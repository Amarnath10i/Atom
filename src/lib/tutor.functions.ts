import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const StudentId = z.object({ studentId: z.string().uuid() });

export const listStudents = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("students")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getStudent = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => StudentId.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("students")
      .select("*")
      .eq("id", data.studentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const getDashboard = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => StudentId.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sid = data.studentId;
    const [student, atoms, bonds, weak, plan, refl, threads] = await Promise.all([
      supabaseAdmin.from("students").select("*").eq("id", sid).maybeSingle(),
      supabaseAdmin.from("memory_atoms").select("*").eq("student_id", sid),
      supabaseAdmin.from("memory_bonds").select("*").eq("student_id", sid),
      supabaseAdmin.from("weak_topics").select("*").eq("student_id", sid).order("severity", { ascending: false }),
      supabaseAdmin.from("plan_items").select("*").eq("student_id", sid).order("week"),
      supabaseAdmin.from("reflections").select("*").eq("student_id", sid).order("created_at", { ascending: false }).limit(10),
      supabaseAdmin.from("threads").select("*").eq("student_id", sid).order("updated_at", { ascending: false }),
    ]);
    return {
      student: student.data,
      atoms: atoms.data ?? [],
      bonds: bonds.data ?? [],
      weak: weak.data ?? [],
      plan: plan.data ?? [],
      reflections: refl.data ?? [],
      threads: threads.data ?? [],
    };
  });

export const listThreads = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => StudentId.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("threads")
      .select("*")
      .eq("student_id", data.studentId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createThread = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ studentId: z.string().uuid(), title: z.string().optional() }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("threads")
      .insert({ student_id: data.studentId, title: data.title ?? "New session" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateThreadTitle = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ threadId: z.string().uuid(), title: z.string().min(1).max(120) }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("threads")
      .update({ title: data.title })
      .eq("id", data.threadId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getThread = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ threadId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("threads")
      .select("*")
      .eq("id", data.threadId)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });


export const getMessages = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ threadId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const simulateSession = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => StudentId.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sid = data.studentId;
    // Apply a forgetting curve + reinforcement: weak atoms lose strength, strong ones gain a bit
    const { data: atoms } = await supabaseAdmin.from("memory_atoms").select("*").eq("student_id", sid);
    if (!atoms) return { ok: true, updated: 0 };
    for (const a of atoms) {
      const decay = (1 - a.strength) * 0.04;
      const gain = a.strength * 0.06;
      const delta = a.strength < 0.5 ? -decay + Math.random() * 0.08 : gain - Math.random() * 0.03;
      const next = Math.max(0.05, Math.min(0.98, a.strength + delta));
      await supabaseAdmin.from("memory_atoms").update({
        strength: next,
        reviews: a.reviews + 1,
        last_reviewed: new Date().toISOString(),
      }).eq("id", a.id);
    }
    await supabaseAdmin.from("reflections").insert({
      student_id: sid,
      summary: `Simulated study session: ${atoms.length} atoms revisited. Weak atoms reinforced via spaced repetition.`,
      bonds_added: 0,
      atoms_added: 0,
      next_focus: "Focus on lowest-strength atoms in next session.",
    });
    return { ok: true, updated: atoms.length };
  });

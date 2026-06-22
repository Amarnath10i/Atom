// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_ADMIN_PASSWORD = "admin123";

function checkAdmin(password: string) {
  const expected = process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
  if (password !== expected) {
    throw new Error("Invalid admin password");
  }
}

const AdminAuth = z.object({ password: z.string().min(1) });

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => AdminAuth.parse(i))
  .handler(async ({ data }) => {
    checkAdmin(data.password);
    return { ok: true };
  });

export const adminOverview = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => AdminAuth.parse(i))
  .handler(async ({ data }) => {
    checkAdmin(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [students, threads, messages, atoms, weak, plan, refl, agentRuns, safety] =
      await Promise.all([
        supabaseAdmin.from("students").select("*").order("name"),
        supabaseAdmin.from("threads").select("id, student_id, title, updated_at, created_at"),
        supabaseAdmin
          .from("messages")
          .select("id, thread_id, role, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        supabaseAdmin.from("memory_atoms").select("id, student_id, strength, state"),
        supabaseAdmin
          .from("weak_topics")
          .select("id, student_id, topic, severity, subject")
          .order("severity", { ascending: false }),
        supabaseAdmin.from("plan_items").select("id, student_id, week, status"),
        supabaseAdmin
          .from("reflections")
          .select("id, student_id, summary, created_at, next_focus")
          .order("created_at", { ascending: false })
          .limit(50),
        supabaseAdmin
          .from("agent_runs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50)
          .then((r) => (r.error ? { data: [], error: null } : r)),
        supabaseAdmin
          .from("safety_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50)
          .then((r) => (r.error ? { data: [], error: null } : r)),
      ]);

    const studentRows = students.data ?? [];
    const threadRows = threads.data ?? [];
    const messageRows = messages.data ?? [];
    const atomRows = atoms.data ?? [];
    const weakRows = weak.data ?? [];
    const planRows = plan.data ?? [];
    const reflRows = refl.data ?? [];

    const byStudent: Record<string, {
      threads: number; messages: number; atoms: number; avgStrength: number;
      weakTopics: number; planItems: number; planDone: number;
    }> = {};

    for (const s of studentRows) {
      byStudent[s.id] = {
        threads: 0, messages: 0, atoms: 0, avgStrength: 0,
        weakTopics: 0, planItems: 0, planDone: 0,
      };
    }
    for (const t of threadRows) if (byStudent[t.student_id]) byStudent[t.student_id].threads++;
    const threadToStudent: Record<string, string> = {};
    for (const t of threadRows) threadToStudent[t.id] = t.student_id;
    for (const m of messageRows) {
      const sid = threadToStudent[m.thread_id];
      if (sid && byStudent[sid]) byStudent[sid].messages++;
    }
    const strengthSum: Record<string, { sum: number; n: number }> = {};
    for (const a of atomRows) {
      if (!byStudent[a.student_id]) continue;
      byStudent[a.student_id].atoms++;
      const acc = (strengthSum[a.student_id] ??= { sum: 0, n: 0 });
      acc.sum += Number(a.strength ?? 0);
      acc.n += 1;
    }
    for (const [sid, v] of Object.entries(strengthSum)) {
      byStudent[sid].avgStrength = v.n ? v.sum / v.n : 0;
    }
    for (const w of weakRows) if (byStudent[w.student_id]) byStudent[w.student_id].weakTopics++;
    for (const p of planRows) {
      if (!byStudent[p.student_id]) continue;
      byStudent[p.student_id].planItems++;
      if (p.status === "done" || p.status === "completed") byStudent[p.student_id].planDone++;
    }

    return {
      totals: {
        students: studentRows.length,
        threads: threadRows.length,
        messages: messageRows.length,
        atoms: atomRows.length,
        weakTopics: weakRows.length,
        planItems: planRows.length,
      },
      students: studentRows.map((s) => ({
        id: s.id,
        name: s.name,
        exam: s.exam ?? null,
        grade: s.grade ?? null,
        stats: byStudent[s.id] ?? null,
      })),
      recentReflections: reflRows,
      agentRuns: (agentRuns as { data?: unknown[] }).data ?? [],
      safetyEvents: (safety as { data?: unknown[] }).data ?? [],
      topWeakTopics: weakRows.slice(0, 20),
    };
  });

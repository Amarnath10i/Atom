// @ts-nocheck
/**
 * TanStack server functions for triggering agents from the UI.
 * Every run is recorded in `agent_runs` for the timeline panel.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const StudentId = z.object({ studentId: z.string().uuid() });
const ThreadId = z.object({ threadId: z.string().uuid() });

async function record(
  studentId: string, agent: string,
  fn: () => Promise<{ summary: string; payload: unknown }>,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const t0 = Date.now();
  let status = "ok", summary = "", payload: unknown = null;
  try {
    const r = await fn();
    summary = r.summary; payload = r.payload;
    return r.payload;
  } catch (e) {
    status = "error";
    summary = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    await supabaseAdmin.from("agent_runs").insert({
      student_id: studentId, agent, status, summary,
      payload: payload as never, duration_ms: Date.now() - t0,
    });
  }
}

export const runCurator = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => StudentId.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { agents } = await import("@/lib/agents.bridge.server");
    return record(data.studentId, "curator", async () => {
      const { data: atoms } = await supabaseAdmin
        .from("memory_atoms").select("*").eq("student_id", data.studentId);
      const result = await agents.curator(atoms ?? []);
      let merged = 0, pruned = 0, bonded = 0;
      for (const m of result.merges ?? []) {
        if (!m.keep || !m.drop || m.keep === m.drop) continue;
        await supabaseAdmin.from("memory_bonds").delete().eq("source_atom", m.drop);
        await supabaseAdmin.from("memory_bonds").delete().eq("target_atom", m.drop);
        await supabaseAdmin.from("memory_atoms").delete().eq("id", m.drop);
        merged++;
      }
      for (const p of result.prunes ?? []) {
        if (!p.id) continue;
        await supabaseAdmin.from("memory_atoms").delete().eq("id", p.id); pruned++;
      }
      for (const b of result.bonds ?? []) {
        if (!b.source || !b.target || b.source === b.target) continue;
        await supabaseAdmin.from("memory_bonds").insert({
          student_id: data.studentId,
          source_atom: b.source, target_atom: b.target,
          relation: b.relation ?? "related",
          weight: Math.max(0, Math.min(1, b.weight ?? 0.5)),
        }); bonded++;
      }
      return {
        summary: `Curator: merged ${merged}, pruned ${pruned}, +${bonded} bonds${result._degraded ? " (offline fallback)" : ""}`,
        payload: { merged, pruned, bonded, raw: result },
      };
    });
  });

export const runDiagnostic = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => StudentId.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { agents } = await import("@/lib/agents.bridge.server");
    return record(data.studentId, "diagnostic", async () => {
      const [{ data: threads }, { data: atoms }] = await Promise.all([
        supabaseAdmin.from("threads").select("id")
          .eq("student_id", data.studentId)
          .order("updated_at", { ascending: false }).limit(3),
        supabaseAdmin.from("memory_atoms").select("*").eq("student_id", data.studentId),
      ]);
      let transcript: unknown[] = [];
      if (threads?.length) {
        const ids = threads.map(t => t.id);
        const { data: msgs } = await supabaseAdmin.from("messages").select("role,content")
          .in("thread_id", ids).order("created_at", { ascending: true }).limit(60);
        transcript = msgs ?? [];
      }
      const result = await agents.diagnostic(transcript, atoms ?? []);
      let inserted = 0;
      for (const w of result.weak_topics ?? []) {
        await supabaseAdmin.from("weak_topics").insert({
          student_id: data.studentId,
          subject: w.subject, topic: w.topic,
          severity: Math.max(0, Math.min(1, w.severity ?? 0.5)),
          evidence: w.evidence,
        }); inserted++;
      }
      return {
        summary: `Diagnostic: flagged ${inserted} weak topic${inserted === 1 ? "" : "s"}${result._degraded ? " (offline fallback)" : ""}`,
        payload: result,
      };
    });
  });

export const runPlanner = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => StudentId.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { agents } = await import("@/lib/agents.bridge.server");
    return record(data.studentId, "planner", async () => {
      const [{ data: student }, { data: weak }, { data: cur }] = await Promise.all([
        supabaseAdmin.from("students").select("exam").eq("id", data.studentId).maybeSingle(),
        supabaseAdmin.from("weak_topics").select("*").eq("student_id", data.studentId)
          .order("severity", { ascending: false }).limit(10),
        supabaseAdmin.from("plan_items").select("*").eq("student_id", data.studentId),
      ]);
      const result = await agents.planner(student?.exam ?? "JEE", weak ?? [], cur ?? []);
      let added = 0;
      // Replace pending items only (keep completed history)
      await supabaseAdmin.from("plan_items").delete()
        .eq("student_id", data.studentId).eq("status", "pending");
      for (const p of result.plan ?? []) {
        await supabaseAdmin.from("plan_items").insert({
          student_id: data.studentId,
          week: Math.max(1, Math.min(6, Number(p.week) || 1)),
          subject: p.subject, topic: p.topic,
          task: p.activity ?? p.task ?? "Study session",
          status: "pending",
        } as never); added++;
      }
      return {
        summary: `Planner: rebuilt 6-week plan with ${added} items${result._degraded ? " (offline fallback)" : ""}`,
        payload: result,
      };
    });
  });

export const runStateInference = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => StudentId.parse(i).merge(z.object({ threadId: z.string().uuid().optional() })))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { agents } = await import("@/lib/agents.bridge.server");
    return record(data.studentId, "state", async () => {
      const [{ data: atoms }, { data: msgs }] = await Promise.all([
        supabaseAdmin.from("memory_atoms").select("*").eq("student_id", data.studentId),
        data.threadId
          ? supabaseAdmin.from("messages").select("role,content")
              .eq("thread_id", data.threadId).order("created_at", { ascending: true }).limit(40)
          : Promise.resolve({ data: [] }),
      ]);
      const result = await agents.state(msgs ?? [], atoms ?? []);
      let updated = 0;
      for (const u of result.updates ?? []) {
        if (!u.atom_id || !u.state) continue;
        await supabaseAdmin.from("memory_atoms").update({
          state: u.state, state_reason: u.reason,
          state_updated_at: new Date().toISOString(),
        } as never).eq("id", u.atom_id); updated++;
      }
      return {
        summary: `State inference: updated ${updated} atom${updated === 1 ? "" : "s"}${result._degraded ? " (offline)" : ""}`,
        payload: result,
      };
    });
  });

export const listAgentRuns = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => StudentId.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.from("agent_runs")
      .select("*").eq("student_id", data.studentId)
      .order("created_at", { ascending: false }).limit(20);
    return rows ?? [];
  });

export const listSafetyEvents = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => StudentId.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.from("safety_events")
      .select("*").eq("student_id", data.studentId)
      .order("created_at", { ascending: false }).limit(10);
    return rows ?? [];
  });

export const agentsHealth = createServerFn({ method: "GET" }).handler(async () => {
  const { agents } = await import("@/lib/agents.bridge.server");
  return await agents.health();
});

export const nucleusSearch = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ studentId: z.string().uuid(), query: z.string().min(1), k: z.number().int().min(1).max(20).default(8) }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { agents } = await import("@/lib/agents.bridge.server");
    const { data: atoms } = await supabaseAdmin.from("memory_atoms")
      .select("id,subject,topic,nucleus_vector,gravity").eq("student_id", data.studentId);
    return agents.nucleusSearch(data.query, atoms ?? [], data.k);
  });

export const decaySession = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => StudentId.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { agents } = await import("@/lib/agents.bridge.server");
    return record(data.studentId, "nucleus", async () => {
      const { data: atoms } = await supabaseAdmin.from("memory_atoms")
        .select("id,last_reviewed,semantic_mass,gravity").eq("student_id", data.studentId);
      const res = await agents.nucleusDecay(atoms ?? []);
      let touched = 0;
      for (const u of res.updates ?? []) {
        await supabaseAdmin.from("memory_atoms").update({
          recency: u.recency, gravity: u.gravity,
        } as never).eq("id", u.id); touched++;
      }
      return { summary: `Nucleus decay: ${touched} atoms re-weighted`, payload: res };
    });
  });

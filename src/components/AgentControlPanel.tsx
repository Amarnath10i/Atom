// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  runCurator, runDiagnostic, runPlanner, runStateInference,
  listAgentRuns, listSafetyEvents, agentsHealth,
} from "@/lib/agents.functions";
import { Bot, Wand2, Stethoscope, CalendarRange, Brain, Shield, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";

type AgentKey = "curator" | "diagnostic" | "planner" | "state";

const AGENTS: { key: AgentKey; label: string; desc: string; icon: LucideIcon; color: string }[] = [
  { key: "curator",    label: "Curator",    desc: "Merge duplicates · prune stale · propose bonds",  icon: Wand2,        color: "var(--saffron)" },
  { key: "diagnostic", label: "Diagnostic", desc: "Find weak topics from recent transcript",          icon: Stethoscope,  color: "var(--destructive)" },
  { key: "planner",    label: "Planner",    desc: "Rebuild personalised 6-week plan",                 icon: CalendarRange,color: "var(--primary)" },
  { key: "state",      label: "State Infer",desc: "Re-label atoms: active · stuck · completed · stale", icon: Brain,      color: "var(--teal)" },
];

export function AgentControlPanel({ studentId, threadId }: { studentId: string; threadId?: string }) {
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ["agents-health"], queryFn: () => agentsHealth(), refetchInterval: 15_000 });
  const runs   = useQuery({ queryKey: ["agent-runs", studentId], queryFn: () => listAgentRuns({ data: { studentId } }), refetchInterval: 5_000 });
  const safety = useQuery({ queryKey: ["safety-events", studentId], queryFn: () => listSafetyEvents({ data: { studentId } }), refetchInterval: 15_000 });

  const mk = (label: string, fn: () => Promise<unknown>) => useMutation({
    mutationFn: fn,
    onSuccess: () => { toast.success(`${label} ✓`); qc.invalidateQueries({ queryKey: ["dashboard", studentId] }); qc.invalidateQueries({ queryKey: ["agent-runs", studentId] }); },
    onError:   (e: Error) => toast.error(`${label} failed: ${e.message}`),
  });
  const curator    = mk("Curator",    () => runCurator({ data: { studentId } }));
  const diagnostic = mk("Diagnostic", () => runDiagnostic({ data: { studentId } }));
  const planner    = mk("Planner",    () => runPlanner({ data: { studentId } }));
  const state      = mk("State",      () => runStateInference({ data: { studentId, threadId } }));
  const muts = { curator, diagnostic, planner, state } as const;

  const online = Boolean((health.data as { ok?: boolean } | undefined)?.ok);
  const llm = (health.data as { llm?: string } | undefined)?.llm ?? "?";

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h2 className="font-display text-lg font-semibold">Agent orchestration</h2>
        </div>
        <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
          style={{ background: online ? "color-mix(in oklab, var(--teal) 18%, transparent)" : "color-mix(in oklab, var(--destructive) 18%, transparent)",
                   color: online ? "var(--teal)" : "var(--destructive)" }}>
          {online ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
          {online ? `agents · ${llm}` : "agents offline (fallback active)"}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {AGENTS.map(a => {
          const m = muts[a.key];
          const Icon = a.icon;
          return (
            <button key={a.key} onClick={() => m.mutate()} disabled={m.isPending}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3 text-left transition hover:border-primary/60 disabled:opacity-50">
              <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${a.color} 18%, transparent)`, color: a.color }}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{a.label}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.isPending ? "running…" : "run"}</div>
                </div>
                <div className="text-[11px] text-muted-foreground">{a.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Recent runs */}
      <div className="mt-5">
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Recent agent runs</div>
        <div className="max-h-44 space-y-1 overflow-auto pr-1">
          {(runs.data ?? []).length === 0 && <div className="text-xs text-muted-foreground">No runs yet — trigger one above.</div>}
          {(runs.data ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md border border-border/60 bg-card/30 px-2.5 py-1.5 text-[11px]">
              <div className="min-w-0 flex-1 truncate">
                <span className="font-semibold uppercase" style={{ color: r.status === "ok" ? "var(--teal)" : "var(--destructive)" }}>{r.agent}</span>
                <span className="ml-2 text-muted-foreground">{r.summary}</span>
              </div>
              <span className="ml-2 shrink-0 text-muted-foreground">{r.duration_ms}ms</span>
            </div>
          ))}
        </div>
      </div>

      {/* Safety events */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Shield className="h-3 w-3" /> Guardrails log
        </div>
        <div className="max-h-28 space-y-1 overflow-auto pr-1">
          {(safety.data ?? []).length === 0 && <div className="text-xs text-muted-foreground">No safety events. All clean.</div>}
          {(safety.data ?? []).map((s) => (
            <div key={s.id} className="rounded-md border px-2.5 py-1.5 text-[11px]"
              style={{ borderColor: "color-mix(in oklab, var(--destructive) 35%, transparent)", background: "color-mix(in oklab, var(--destructive) 8%, transparent)" }}>
              <span className="font-semibold uppercase" style={{ color: "var(--destructive)" }}>{s.category}</span>
              <span className="ml-2 text-muted-foreground">[{s.mode}]</span>
              <span className="ml-2">{s.reason}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

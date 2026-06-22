import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { getDashboard, createThread, simulateSession } from "@/lib/tutor.functions";
import { TopBar } from "@/components/TopBar";
import { MemoryGraph } from "@/components/MemoryGraph";
import { ProgressHeatmap } from "@/components/ProgressHeatmap";
import { AgentControlPanel } from "@/components/AgentControlPanel";
import { NucleusPanel } from "@/components/NucleusPanel";
import { AtomStateBadge } from "@/components/AtomStateBadge";
import { MessageSquarePlus, Sparkles, AlertTriangle, CalendarDays, ListChecks, Brain } from "lucide-react";
import { toast } from "sonner";

const dashboardQuery = (studentId: string) =>
  queryOptions({
    queryKey: ["dashboard", studentId],
    queryFn: () => getDashboard({ data: { studentId } }),
  });

export const Route = createFileRoute("/student/$studentId")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(dashboardQuery(params.studentId)),
  component: Dashboard,
  errorComponent: ({ error }) => <div className="p-10 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-10">Student not found</div>,
});

function Dashboard() {
  const { studentId } = Route.useParams();
  const { data } = useSuspenseQuery(dashboardQuery(studentId));
  const navigate = useNavigate();
  const qc = useQueryClient();

  const newThread = useMutation({
    mutationFn: () => createThread({ data: { studentId } }),
    onSuccess: (t) => navigate({ to: "/student/$studentId/chat/$threadId", params: { studentId, threadId: t.id } }),
  });
  const sim = useMutation({
    mutationFn: () => simulateSession({ data: { studentId } }),
    onSuccess: () => {
      toast.success("Simulated session: atoms decayed/reinforced");
      qc.invalidateQueries({ queryKey: ["dashboard", studentId] });
    },
  });

  if (!data.student) return <div className="p-10">Student not found.</div>;
  const s = data.student;
  const avgStrength = data.atoms.length
    ? data.atoms.reduce((a, b) => a + b.strength, 0) / data.atoms.length
    : 0;
  const doneCount = data.plan.filter((p) => p.status === "done").length;

  return (
    <>
      <TopBar />
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-card text-4xl glow-saffron">{s.avatar_emoji}</div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-3xl font-bold">{s.name}</h1>
                <span className="chip" style={{ color: s.exam === "JEE" ? "var(--saffron)" : "var(--teal)" }}>{s.exam}</span>
                <span className="chip">{s.language}</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{s.city} · Class {s.grade} · {s.bio}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => sim.mutate()}
              disabled={sim.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Simulate session
            </button>
            <button
              onClick={() => newThread.mutate()}
              disabled={newThread.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground glow-saffron"
            >
              <MessageSquarePlus className="h-4 w-4" />
              New tutoring session
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Memory atoms", data.atoms.length, "stored in LAMA"],
            ["Avg strength", `${(avgStrength * 100).toFixed(0)}%`, "across all topics"],
            ["Bonds", data.bonds.length, "in knowledge graph"],
            ["Plan progress", `${doneCount}/${data.plan.length}`, "items completed"],
          ].map(([label, value, sub]) => (
            <div key={label as string} className="glass rounded-xl p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
              <div className="mt-1 font-display text-2xl font-bold">{value as any}</div>
              <div className="text-[11px] text-muted-foreground">{sub}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Memory graph */}
          <section className="glass rounded-2xl p-5 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                <h2 className="font-display text-lg font-semibold">LAMA memory graph</h2>
              </div>
              <span className="text-xs text-muted-foreground">node size = strength · edge color = bond weight</span>
            </div>
            <MemoryGraph atoms={data.atoms as any} bonds={data.bonds as any} />
          </section>

          {/* Threads */}
          <section className="glass rounded-2xl p-5">
            <h2 className="mb-3 font-display text-lg font-semibold">Sessions</h2>
            <div className="space-y-2">
              {data.threads.length === 0 && (
                <p className="text-sm text-muted-foreground">No sessions yet. Start one above.</p>
              )}
              {data.threads.map((t) => (
                <Link
                  key={t.id}
                  to="/student/$studentId/chat/$threadId"
                  params={{ studentId, threadId: t.id }}
                  className="block rounded-lg border border-border bg-card/40 px-3 py-2.5 text-sm hover:border-primary/60"
                >
                  <div className="font-medium">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(t.updated_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Progress heatmap */}
          <section className="glass rounded-2xl p-5 lg:col-span-2">
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
              <ListChecks className="h-4 w-4 text-primary" /> Topic mastery heatmap
            </h2>
            <ProgressHeatmap atoms={data.atoms as any} />
          </section>

          {/* Weak topics */}
          <section className="glass rounded-2xl p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
              <AlertTriangle className="h-4 w-4" style={{ color: "var(--destructive)" }} /> Diagnostic agent flags
            </h2>
            <div className="space-y-2">
              {data.weak.map((w) => (
                <div key={w.id} className="rounded-lg border border-border bg-card/40 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">{w.subject} · {w.topic}</div>
                    <span className="chip" style={{ color: "var(--destructive)" }}>
                      sev {Math.round(w.severity * 100)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{w.evidence}</div>
                </div>
              ))}
              {data.weak.length === 0 && <p className="text-sm text-muted-foreground">No weak areas detected yet.</p>}
            </div>
          </section>

          {/* Plan */}
          <section className="glass rounded-2xl p-5 lg:col-span-2">
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
              <CalendarDays className="h-4 w-4 text-primary" /> Planner agent · 6-month roadmap
            </h2>
            <div className="space-y-2">
              {data.plan.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-xs font-bold text-primary">W{p.week}</div>
                    <div>
                      <div className="text-sm font-medium">{p.subject} · {p.topic}</div>
                      <div className="text-xs text-muted-foreground">{p.activity}</div>
                    </div>
                  </div>
                  <span
                    className="chip"
                    style={{
                      color: p.status === "done" ? "var(--teal)" : p.status === "skipped" ? "var(--destructive)" : undefined,
                    }}
                  >
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Reflections */}
          <section className="glass rounded-2xl p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> Critic reflections
            </h2>
            <div className="space-y-3">
              {data.reflections.map((r) => (
                <div key={r.id} className="rounded-lg border border-border bg-card/40 p-3">
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                  <div className="mt-1 text-sm">{r.summary}</div>
                  {r.next_focus && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      <strong className="text-foreground">Next focus:</strong> {r.next_focus}
                    </div>
                  )}
                  <div className="mt-1 flex gap-2 text-[10px] text-muted-foreground">
                    <span className="chip">+{r.atoms_added} atoms</span>
                    <span className="chip">+{r.bonds_added} bonds</span>
                  </div>
                </div>
              ))}
              {data.reflections.length === 0 && <p className="text-sm text-muted-foreground">No reflections yet.</p>}
            </div>
          </section>
          {/* Agent control panel — trigger Curator/Diagnostic/Planner/State */}
          <div className="lg:col-span-2">
            <AgentControlPanel studentId={studentId} />
          </div>

          {/* Nucleus memory — gravity-ranked + semantic search */}
          <NucleusPanel studentId={studentId} atoms={data.atoms as never} />
        </div>
      </div>
    </>
  );
}

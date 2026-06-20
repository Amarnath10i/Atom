// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getEnhancedCritique, getCriticInsights } from "@/lib/learning-os.functions";
import { Sparkles, RefreshCw, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, Brain, Clock, Link2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/critic")({
  head: () => ({ meta: [{ title: "Enhanced Critic · LAMA" }] }),
  component: CriticPage,
});

const GRADE_STYLE: Record<string, string> = {
  A: "text-emerald-400 border-emerald-700/50 bg-emerald-950/30",
  B: "text-blue-400 border-blue-700/50 bg-blue-950/30",
  C: "text-yellow-400 border-yellow-700/50 bg-yellow-950/30",
  D: "text-orange-400 border-orange-700/50 bg-orange-950/30",
  F: "text-rose-400 border-rose-700/50 bg-rose-950/30",
};

const STATUS_ICON = {
  strong:   { Icon: CheckCircle2, color: "text-emerald-400" },
  moderate: { Icon: AlertTriangle, color: "text-yellow-400" },
  weak:     { Icon: XCircle,       color: "text-rose-400" },
};

function CriticPage() {
  const [data, setData] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const [d, i] = await Promise.all([getEnhancedCritique(), getCriticInsights()]);
      setData(d); setInsights(i);
    }
    catch (e: any) { setErr(e?.message ?? "Failed to load"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Shell><div className="py-24 text-center text-muted-foreground animate-pulse">Generating critique…</div></Shell>;
  if (err)     return <Shell><div className="py-12 text-destructive">{err}</div></Shell>;
  if (!data)   return <Shell><div className="py-12 text-muted-foreground">No data — start chatting to build your memory atoms first.</div></Shell>;

  const { student, overallGrade, overallStrength, subjectCritiques, priorityActions } = data;
  const gradeStyle = GRADE_STYLE[overallGrade] ?? GRADE_STYLE.F;

  return (
    <Shell>
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          <Sparkles className="h-3.5 w-3.5" /> Phase 2 · Enhanced Critic
        </div>
        <h1 className="text-3xl font-bold">Session Critique</h1>
        <p className="mt-1 text-sm text-muted-foreground">{student?.name} · {student?.exam}</p>
      </div>

      {/* Overall grade */}
      <div className={`mb-6 rounded-2xl border p-6 flex items-center gap-6 ${gradeStyle}`}>
        <div className={`text-6xl font-black leading-none ${gradeStyle.split(" ")[0]}`}>{overallGrade}</div>
        <div>
          <div className="text-lg font-bold">Overall grade</div>
          <div className="text-sm opacity-80 mt-0.5">Average atom strength: {(overallStrength * 100).toFixed(1)}%</div>
          <div className="text-xs opacity-60 mt-1">
            {overallGrade === "A" ? "Excellent mastery — keep reinforcing daily." :
             overallGrade === "B" ? "Good progress. Target weak topics to break into A." :
             overallGrade === "C" ? "Moderate. Intensify weak-topic drilling." :
             "Significant gaps. Focus on foundation topics immediately."}
          </div>
        </div>
        <button onClick={load} className="ml-auto rounded-full border border-current/30 p-2 opacity-60 hover:opacity-100 transition">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Priority action stack */}
      {priorityActions.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-700/40 bg-amber-950/20 p-5">
          <h3 className="font-semibold text-amber-300 mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Priority actions
          </h3>
          <ol className="space-y-2">
            {priorityActions.map((a: any, i: number) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-900/40 text-xs font-bold text-amber-300">
                  {i + 1}
                </span>
                <div>
                  <span className="font-medium">{a.subject}: </span>
                  <span className="text-muted-foreground">{a.action}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Critic insights — misconceptions / forgetting / prereq gaps */}
      {insights && (
        <div className="mb-6 grid gap-3 md:grid-cols-3">
          <InsightCard
            title="Misconceptions"
            icon={<Brain className="h-4 w-4" />}
            count={insights.summary.misconceptionCount}
            tone="rose"
            empty="No recurring misconceptions detected."
            question="Will this create misconceptions?"
            items={insights.misconceptions.map((m: any) => ({
              primary: m.pattern,
              secondary: `${m.subject} · ${m.topic} · ×${m.occurrences}`,
              detail: m.risk,
            }))}
          />
          <InsightCard
            title="Forgetting risk (7 days)"
            icon={<Clock className="h-4 w-4" />}
            count={insights.summary.forgettingCount}
            tone="amber"
            empty="No atoms projected to drop below recall."
            question="Will student forget in 7 days?"
            items={insights.forgetting.map((f: any) => ({
              primary: f.topic,
              secondary: `${f.subject} · now ${(f.currentStrength * 100).toFixed(0)}% → 7d ${(f.projected7d * 100).toFixed(0)}%`,
              detail: "Schedule a review within 3 days.",
            }))}
          />
          <InsightCard
            title="Prerequisite gaps"
            icon={<Link2 className="h-4 w-4" />}
            count={insights.summary.prereqGapCount}
            tone="blue"
            empty="All prerequisites look solid."
            question="Prerequisite gap?"
            items={insights.prereqGaps.map((g: any) => ({
              primary: g.topic,
              secondary: `${g.subject} · weak prereqs: ${g.weakPrereqs.map((p: any) => p.topic).join(", ")}`,
              detail: "Fix the prereq before re-attempting this topic.",
            }))}
          />
        </div>
      )}

      {/* Per-subject critiques */}
      <div className="space-y-3">

        {subjectCritiques.length === 0
          ? <div className="py-10 text-center text-sm text-muted-foreground">No subject data yet — chat with LAMA to build atoms.</div>
          : subjectCritiques.map((s: any) => {
              const { Icon, color } = STATUS_ICON[s.status] ?? STATUS_ICON.moderate;
              const open = !!expanded[s.subject];
              return (
                <div key={s.subject} className="rounded-2xl border border-border bg-card overflow-hidden">
                  <button
                    onClick={() => setExpanded((p) => ({ ...p, [s.subject]: !open }))}
                    className="flex w-full items-center gap-4 p-4 text-left hover:bg-muted/30 transition"
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{s.subject}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {s.atomCount} atoms · {(s.avgStrength * 100).toFixed(0)}% avg strength
                        {s.weakCount > 0 && ` · ${s.weakCount} weak topics`}
                        {s.staleCount > 0 && ` · ${s.staleCount} stale`}
                      </div>
                    </div>
                    {/* Strength bar */}
                    <div className="hidden sm:flex items-center gap-2 w-32">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${s.avgStrength * 100}%`, background: s.status === "strong" ? "#22c55e" : s.status === "moderate" ? "#eab308" : "#ef4444" }}
                        />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground w-8 text-right">{(s.avgStrength * 100).toFixed(0)}%</span>
                    </div>
                    {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                  </button>

                  {open && (
                    <div className="border-t border-border/60 p-4 space-y-4 bg-muted/10">
                      {s.actions.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Recommended actions</div>
                          <ul className="space-y-1">
                            {s.actions.map((a: string, i: number) => (
                              <li key={i} className="flex gap-2 text-sm">
                                <span className="text-primary mt-0.5">→</span>
                                <span>{a}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {s.topWeakTopics.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Weak topics</div>
                          <div className="flex flex-wrap gap-2">
                            {s.topWeakTopics.map((w: any) => (
                              <span key={w.id} className="rounded-full border border-rose-700/40 bg-rose-950/20 px-2.5 py-0.5 text-xs text-rose-300">
                                {w.topic} — {(w.severity * 100).toFixed(0)}% severity
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
        }
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl px-6 py-12 md:py-16">{children}</div>;
}

const TONE: Record<string, { border: string; bg: string; text: string; chip: string }> = {
  rose:  { border: "border-rose-700/40",  bg: "bg-rose-950/15",  text: "text-rose-300",  chip: "bg-rose-900/40 text-rose-200" },
  amber: { border: "border-amber-700/40", bg: "bg-amber-950/15", text: "text-amber-300", chip: "bg-amber-900/40 text-amber-200" },
  blue:  { border: "border-blue-700/40",  bg: "bg-blue-950/15",  text: "text-blue-300",  chip: "bg-blue-900/40 text-blue-200" },
};

function InsightCard({ title, icon, count, tone, items, empty, question }: any) {
  const t = TONE[tone] ?? TONE.rose;
  return (
    <div className={`rounded-2xl border ${t.border} ${t.bg} p-4`}>
      <div className="flex items-center justify-between mb-1">
        <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${t.text}`}>
          {icon} {title}
        </div>
        <span className={`text-xs rounded-full px-2 py-0.5 ${t.chip}`}>{count}</span>
      </div>
      <div className="text-[11px] italic text-muted-foreground mb-3">“{question}”</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">{empty}</div>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 4).map((it: any, i: number) => (
            <li key={i} className="text-xs">
              <div className="font-medium text-foreground">{it.primary}</div>
              <div className="text-muted-foreground">{it.secondary}</div>
              {it.detail && <div className={`mt-0.5 ${t.text} opacity-80`}>→ {it.detail}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

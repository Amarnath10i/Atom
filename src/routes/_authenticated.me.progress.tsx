// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getForgettingCurves, getOutcomeHistory } from "@/lib/learning-os.functions";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import { TrendingDown, BarChart3, Calendar, RefreshCw, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/progress")({
  head: () => ({
    meta: [{ title: "Progress & Forgetting Curves · LAMA" }],
  }),
  component: ProgressPage,
});

type CurveData = {
  curves: Array<{ atomId: string; topic: string; subject: string; currentStrength: number; points: Array<{ day: number; strength: number }> }>;
  atoms: any[];
};
type OutcomeData = {
  bySubject: Record<string, { count: number; avgStrength: number }>;
  byDay: Array<{ date: string; sessions: number; atomsAdded: number }>;
  reflections: any[];
};

function strengthColor(s: number) {
  if (s >= 0.7) return "#22c55e";
  if (s >= 0.5) return "#eab308";
  if (s >= 0.3) return "#f97316";
  return "#ef4444";
}

function ProgressPage() {
  const [curveData, setCurveData] = useState<CurveData | null>(null);
  const [outcomeData, setOutcomeData] = useState<OutcomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"curves" | "outcomes">("curves");
  const [selectedAtom, setSelectedAtom] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [c, o] = await Promise.all([getForgettingCurves(), getOutcomeHistory()]);
      setCurveData(c as CurveData);
      setOutcomeData(o as OutcomeData);
      if (c?.atoms?.length > 0) setSelectedAtom(c.atoms[0].id);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load progress data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Shell><div className="py-24 text-center text-muted-foreground animate-pulse">Loading your progress data…</div></Shell>;
  if (err)     return <Shell><div className="py-12 text-destructive">{err}</div></Shell>;

  const atoms = curveData?.atoms ?? [];
  const curves = curveData?.curves ?? [];
  const selectedCurve = selectedAtom ? curves.find((c) => c.atomId === selectedAtom) : null;

  // Atoms at risk (decay to < 40% within 7 days)
  const atRisk = curves.filter((c) => {
    const day7 = c.points.find((p) => p.day === 7);
    return day7 && day7.strength < 0.4;
  }).sort((a, b) => a.currentStrength - b.currentStrength).slice(0, 5);

  const subjectScores = Object.entries(outcomeData?.bySubject ?? {}).map(([subject, v]) => ({
    subject,
    ...v,
  }));

  const byDay = (outcomeData?.byDay ?? []).slice(-14);

  return (
    <Shell>
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            <TrendingDown className="h-3.5 w-3.5" /> Phase 1 · Progress Tracking
          </div>
          <h1 className="text-3xl font-bold">Forgetting Curves & Outcomes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ebbinghaus decay projections and session performance across {atoms.length} atoms.
          </p>
        </div>
        <button onClick={load} className="rounded-full border border-border p-2 hover:bg-muted transition" title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-border bg-muted/30 p-1 w-fit">
        {(["curves", "outcomes"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "curves" ? "Forgetting Curves" : "Outcome Tracking"}
          </button>
        ))}
      </div>

      {tab === "curves" && (
        <div className="space-y-6">
          {atoms.length === 0 ? (
            <EmptyState message="No atoms yet — start a chat session to build your memory graph." />
          ) : (
            <>
              {/* At-risk banner */}
              {atRisk.length > 0 && (
                <div className="rounded-2xl border border-amber-700/50 bg-amber-950/30 p-4">
                  <div className="flex items-center gap-2 mb-2 text-amber-300">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-semibold">{atRisk.length} atoms will decay below 40% within 7 days</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {atRisk.map((c) => (
                      <button
                        key={c.atomId}
                        onClick={() => setSelectedAtom(c.atomId)}
                        className="rounded-full border border-amber-700/40 bg-amber-900/20 px-3 py-0.5 text-xs text-amber-200 hover:bg-amber-900/40 transition"
                      >
                        {c.topic}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-3">
                {/* Atom selector */}
                <div className="lg:col-span-1">
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold">Atoms</h3>
                    <div className="max-h-96 space-y-1 overflow-auto pr-1">
                      {atoms.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setSelectedAtom(a.id)}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                            selectedAtom === a.id
                              ? "bg-primary/15 text-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <div>
                            <div className="font-medium truncate max-w-[140px]">{a.topic}</div>
                            <div className="text-[11px] text-muted-foreground">{a.subject}</div>
                          </div>
                          <span className="ml-2 text-xs font-bold" style={{ color: strengthColor(a.strength) }}>
                            {(a.strength * 100).toFixed(0)}%
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Forgetting curve chart */}
                <div className="lg:col-span-2">
                  {selectedCurve ? (
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold">{selectedCurve.topic}</h3>
                          <p className="text-xs text-muted-foreground">{selectedCurve.subject}</p>
                        </div>
                        <span className="text-sm font-bold" style={{ color: strengthColor(selectedCurve.currentStrength) }}>
                          {(selectedCurve.currentStrength * 100).toFixed(0)}% now
                        </span>
                      </div>
                      <ResponsiveContainer width="100%" height={240}>
                        <LineChart data={selectedCurve.points} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                          <XAxis
                            dataKey="day"
                            tick={{ fill: "#6b7280", fontSize: 11 }}
                            tickFormatter={(v) => v === 0 ? "Today" : `D+${v}`}
                          />
                          <YAxis domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} tick={{ fill: "#6b7280", fontSize: 11 }} width={40} />
                          <Tooltip
                            contentStyle={{ background: "#0a0a0a", border: "1px solid #1f2937", borderRadius: 8 }}
                            formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, "Strength"]}
                            labelFormatter={(d) => d === 0 ? "Today" : `Day +${d}`}
                          />
                          {/* Past (dotted) vs future (solid) */}
                          <Line
                            type="monotone"
                            dataKey="strength"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            dot={false}
                            strokeDasharray={(d: any) => d.day < 0 ? "4 4" : "0"}
                          />
                          {/* Reference line at day 0 */}
                          <Line type="monotone" data={[{ day: 0, strength: 0 }, { day: 0, strength: 1 }]}
                            dataKey="strength" stroke="#374151" strokeWidth={1} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                      <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                        <span><span className="inline-block w-6 border-t border-dashed border-blue-500 align-middle mr-1" />Past</span>
                        <span><span className="inline-block w-6 border-t border-blue-500 align-middle mr-1" />Future projection</span>
                        <span className="ml-auto">{selectedCurve.points.find(p => p.day === 7)
                          ? `In 7 days: ${(selectedCurve.points.find(p => p.day === 7)!.strength * 100).toFixed(0)}%`
                          : ""}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-48 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground text-sm">
                      Select an atom to see its forgetting curve
                    </div>
                  )}
                </div>
              </div>

              {/* All-atoms summary grid */}
              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="mb-4 font-semibold">All atoms — 30-day projection</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {curves.map((c) => {
                    const day30 = c.points.find((p) => p.day === 30);
                    const delta = day30 ? day30.strength - c.currentStrength : 0;
                    return (
                      <button
                        key={c.atomId}
                        onClick={() => setSelectedAtom(c.atomId)}
                        className="rounded-xl border border-border/60 bg-muted/20 p-3 text-left text-xs transition hover:border-border hover:bg-muted/40"
                      >
                        <div className="font-medium truncate" title={c.topic}>{c.topic}</div>
                        <div className="text-muted-foreground mb-2">{c.subject}</div>
                        <div className="flex items-center justify-between">
                          <span style={{ color: strengthColor(c.currentStrength) }}>
                            {(c.currentStrength * 100).toFixed(0)}%
                          </span>
                          <span className={delta < -0.1 ? "text-rose-400" : "text-emerald-400"}>
                            {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(0)}%
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "outcomes" && (
        <div className="space-y-6">
          {/* Activity heatmap (last 14 days) */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-4 font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Study activity (last 14 days)
            </h3>
            {byDay.length === 0 ? (
              <EmptyState message="No session activity recorded yet." />
            ) : (
              <div className="flex gap-1.5 flex-wrap">
                {byDay.map((d) => (
                  <div key={d.date} title={`${d.date}: ${d.sessions} sessions, +${d.atomsAdded} atoms`}
                    className="flex flex-col items-center gap-1">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold"
                      style={{ background: d.sessions > 0 ? `rgba(59,130,246,${Math.min(0.9, 0.2 + d.sessions * 0.2)})` : "#111" }}
                    >
                      {d.sessions > 0 ? d.sessions : ""}
                    </div>
                    <div className="text-[9px] text-muted-foreground">{d.date.slice(5)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Subject breakdown */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-4 font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Subject strength breakdown
            </h3>
            {subjectScores.length === 0 ? (
              <EmptyState message="No subject data yet." />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={subjectScores} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="subject" tick={{ fill: "#6b7280", fontSize: 11 }} />
                  <YAxis domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} tick={{ fill: "#6b7280", fontSize: 11 }} width={40} />
                  <Tooltip
                    contentStyle={{ background: "#0a0a0a", border: "1px solid #1f2937", borderRadius: 8 }}
                    formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, "Avg strength"]}
                  />
                  <Bar dataKey="avgStrength" radius={[6, 6, 0, 0]}>
                    {subjectScores.map((s, i) => (
                      <Cell key={i} fill={strengthColor(s.avgStrength)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Recent reflections */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-4 font-semibold">Recent session reflections</h3>
            {(outcomeData?.reflections ?? []).length === 0 ? (
              <EmptyState message="No reflections yet." />
            ) : (
              <div className="space-y-3 max-h-72 overflow-auto pr-1">
                {(outcomeData?.reflections ?? []).slice().reverse().slice(0, 8).map((r: any) => (
                  <div key={r.id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                      {r.atoms_added > 0 && (
                        <span className="text-[11px] font-semibold text-emerald-400">+{r.atoms_added} atoms</span>
                      )}
                    </div>
                    <p className="text-sm">{r.summary}</p>
                    {r.next_focus && (
                      <p className="mt-1 text-xs text-muted-foreground">{r.next_focus}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl px-6 py-12 md:py-16">{children}</div>;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">{message}</div>
  );
}

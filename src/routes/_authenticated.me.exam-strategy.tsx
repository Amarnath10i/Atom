// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getExamStrategy } from "@/lib/learning-os.functions";
import { Target, Calendar, Clock, AlertTriangle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/exam-strategy")({
  head: () => ({ meta: [{ title: "Exam Strategy · LAMA" }] }),
  component: ExamStrategyPage,
});

function ExamStrategyPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try { setData(await getExamStrategy()); }
    catch (e: any) { setErr(e?.message ?? "Failed to load"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Shell><div className="py-24 text-center text-muted-foreground animate-pulse">Generating your exam strategy…</div></Shell>;
  if (err)     return <Shell><div className="py-12 text-destructive">{err}</div></Shell>;
  if (!data)   return <Shell><div className="py-12 text-muted-foreground">No data — build some atoms first.</div></Shell>;

  const { student, strategy } = data;

  return (
    <Shell>
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          <Target className="h-3.5 w-3.5" /> Phase 3 · Exam Strategy
        </div>
        <h1 className="text-3xl font-bold">Your {student.exam} Battle Plan</h1>
        <p className="mt-1 text-sm text-muted-foreground">{student.name} · Grade {student.grade} · {strategy.weeksToExam} weeks remaining</p>
        <button onClick={load} className="mt-3 rounded-full border border-border p-1.5 hover:bg-muted transition">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Warnings */}
      {strategy.keyWarnings.length > 0 && (
        <div className="mb-6 rounded-2xl border border-rose-700/40 bg-rose-950/20 p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm mb-2">
            <AlertTriangle className="h-4 w-4" /> Critical gaps to fix first
          </div>
          {strategy.keyWarnings.map((w: string, i: number) => (
            <p key={i} className="text-sm text-rose-200/80">{w}</p>
          ))}
        </div>
      )}

      {/* Weekly plan */}
      <div className="mb-6">
        <h2 className="font-semibold mb-4 flex items-center gap-2 text-lg">
          <Calendar className="h-5 w-5" /> {strategy.weeksToExam}-Week Study Plan
        </h2>
        <div className="space-y-3">
          {strategy.weeklyPlan.map((w: any, i: number) => {
            const shade = i < 2 ? "border-rose-700/40 bg-rose-950/20" :
                          i < 4 ? "border-amber-700/40 bg-amber-950/20" :
                          i < 6 ? "border-blue-700/40 bg-blue-950/20" :
                          "border-emerald-700/40 bg-emerald-950/20";
            const badge = i < 2 ? "bg-rose-900/40 text-rose-300" :
                          i < 4 ? "bg-amber-900/40 text-amber-300" :
                          i < 6 ? "bg-blue-900/40 text-blue-300" :
                          "bg-emerald-900/40 text-emerald-300";
            return (
              <div key={i} className={`rounded-2xl border p-4 ${shade}`}>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${badge}`}>Weeks {w.weeks}</span>
                  <span className="font-semibold text-sm">{w.focus}</span>
                </div>
                <p className="text-sm text-muted-foreground">{w.action}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily routine */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5" /> Ideal Daily Schedule
        </h2>
        <div className="space-y-2">
          {strategy.dailyRoutine.map((r: any, i: number) => (
            <div key={i} className="flex gap-4 rounded-xl border border-border/60 bg-muted/20 p-3 text-sm">
              <span className="font-mono text-xs text-primary shrink-0 w-20 mt-0.5">{r.time}</span>
              <span className="text-muted-foreground">{r.task}</span>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">{children}</div>;
}

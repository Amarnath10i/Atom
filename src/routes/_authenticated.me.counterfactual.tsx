// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCounterfactuals } from "@/lib/learning-os.functions";
import { GitBranch, RefreshCw, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/counterfactual")({
  head: () => ({ meta: [{ title: "Counterfactual · LAMA" }] }),
  component: CounterfactualPage,
});

function CounterfactualPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try { setData(await getCounterfactuals()); }
    catch (e: any) { setErr(e?.message ?? "Failed to load"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Shell><div className="py-24 text-center text-muted-foreground animate-pulse">Computing alternate timelines…</div></Shell>;
  if (err)     return <Shell><div className="py-12 text-destructive">{err}</div></Shell>;
  if (!data)   return <Shell><div className="py-12 text-muted-foreground">No data — build atoms first.</div></Shell>;

  const { student, scenarios } = data;

  return (
    <Shell>
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          <GitBranch className="h-3.5 w-3.5" /> Phase 3 · Counterfactual
        </div>
        <h1 className="text-3xl font-bold">What-If Analysis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Projected score uplift if you shifted 2 extra hours/day to each subject.
        </p>
        <button onClick={load} className="mt-3 rounded-full border border-border p-1.5 hover:bg-muted transition">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {scenarios.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No atoms yet — start a chat to generate counterfactuals.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {scenarios.map((s: any, i: number) => {
            const isHighPriority = i === 0;
            const upliftColor = s.uplift >= 10 ? "#22c55e" : s.uplift >= 5 ? "#eab308" : "#6b7280";
            return (
              <div key={s.subject} className={`rounded-2xl border p-5 ${isHighPriority ? "border-emerald-700/50 bg-emerald-950/20" : "border-border bg-card"}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">{s.subject}</h3>
                  {isHighPriority && <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-300 font-semibold">Highest uplift</span>}
                </div>
                <p className="text-sm text-muted-foreground mb-4 italic">"{s.scenario}"</p>

                {/* Score comparison */}
                <div className="flex items-center gap-4 mb-3">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-muted-foreground">{s.currentProjected}%</div>
                    <div className="text-xs text-muted-foreground">Current</div>
                  </div>
                  <TrendingUp className="h-5 w-5 text-muted-foreground" />
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: upliftColor }}>{s.alternativeProjected}%</div>
                    <div className="text-xs text-muted-foreground">With extra focus</div>
                  </div>
                  <div className="ml-auto text-center">
                    <div className="text-xl font-black" style={{ color: upliftColor }}>+{s.uplift}%</div>
                    <div className="text-xs text-muted-foreground">Uplift</div>
                  </div>
                </div>

                {/* Bar */}
                <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
                  <div className="h-full rounded-full" style={{ width: `${s.currentProjected}%`, background: "#374151" }} />
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${s.alternativeProjected}%`, background: upliftColor }} />
                </div>

                <p className="mt-3 text-xs text-muted-foreground">{s.recommendation}</p>
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl px-6 py-12 md:py-16">{children}</div>;
}

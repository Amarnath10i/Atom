// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { runLearningSimulator, getSimulationHistory } from "@/lib/learning-os.functions";
import { getMe } from "@/lib/auth.functions";
import { FlaskConical, PlayCircle, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/simulator")({
  head: () => ({ meta: [{ title: "Learning Simulator · LAMA" }] }),
  component: SimulatorPage,
});

type Strategy = "spaced_repetition" | "weakest_first" | "strongest_first" | "random";

const STRATEGIES: { id: Strategy; label: string; desc: string }[] = [
  { id: "spaced_repetition", label: "Spaced Repetition", desc: "Prioritise atoms most overdue for review based on Ebbinghaus decay." },
  { id: "weakest_first",     label: "Weakest First",     desc: "Drill your lowest-strength atoms hardest to close gaps fast." },
  { id: "strongest_first",   label: "Strongest First",   desc: "Reinforce your best atoms to lock in mastery before the exam." },
  { id: "random",            label: "Random Mix",         desc: "Random selection across all atoms — great for surprise recall practice." },
];

function delta(before: any[], after: any[]) {
  const afterMap = Object.fromEntries(after.map((a: any) => [a.id, a.strength]));
  return before.map((a: any) => ({
    ...a,
    newStrength: afterMap[a.id] ?? a.strength,
    delta: (afterMap[a.id] ?? a.strength) - a.strength,
  })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function strengthBg(s: number) {
  if (s >= 0.75) return "bg-emerald-500/20 text-emerald-300";
  if (s >= 0.5)  return "bg-yellow-500/20 text-yellow-300";
  if (s >= 0.25) return "bg-orange-500/20 text-orange-300";
  return "bg-rose-500/20 text-rose-300";
}

export default function SimulatorPage() {
  const [studentId, setStudentId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("spaced_repetition");
  const [intensity, setIntensity] = useState(0.5);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getMe().then((me) => { if (me.student) setStudentId(me.student.id); }).catch(() => {});
    getSimulationHistory().then((h) => setHistory(h.runs ?? [])).catch(() => {});
  }, []);

  const run = async () => {
    if (!studentId || running) return;
    setRunning(true); setErr(null); setResult(null);
    try {
      const r = await runLearningSimulator({ data: { studentId, strategy, intensity } });
      setResult(r);
      getSimulationHistory().then((h) => setHistory(h.runs ?? [])).catch(() => {});
    } catch (e: any) {
      setErr(e?.message ?? "Simulation failed");
    } finally {
      setRunning(false);
    }
  };

  const changed = result ? delta(result.before, result.after).filter((a: any) => Math.abs(a.delta) > 0.001) : [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-12 md:py-16">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          <FlaskConical className="h-3.5 w-3.5" /> Phase 2 · Learning Simulator
        </div>
        <h1 className="text-3xl font-bold">Simulate a Study Session</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Run a virtual study session to see projected atom-strength changes before you commit to a strategy.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Config panel */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-4 font-semibold">Study Strategy</h3>
            <div className="space-y-2">
              {STRATEGIES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStrategy(s.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    strategy === s.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background/40 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                  }`}
                >
                  <div className="font-medium text-sm">{s.label}</div>
                  <div className="text-xs mt-0.5 opacity-80">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Session intensity</h3>
              <span className="text-sm font-bold text-primary">{Math.round(intensity * 100)}%</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">Percentage of your atoms to study in this session.</p>
            <input
              type="range" min={10} max={100} step={5}
              value={Math.round(intensity * 100)}
              onChange={(e) => setIntensity(Number(e.target.value) / 100)}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Light (10%)</span><span>Full review (100%)</span>
            </div>
          </div>

          <button
            onClick={run}
            disabled={running || !studentId}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {running
              ? <><RefreshCw className="h-4 w-4 animate-spin" /> Simulating…</>
              : <><PlayCircle className="h-4 w-4" /> Run Simulation</>}
          </button>
          {err && <p className="text-sm text-destructive rounded-lg border border-destructive/30 p-3">{err}</p>}
        </div>

        {/* Result panel */}
        <div className="space-y-4">
          {result ? (
            <>
              <div className="rounded-2xl border border-emerald-700/50 bg-emerald-950/20 p-5">
                <h3 className="font-semibold text-emerald-300 mb-1">Simulation complete</h3>
                <p className="text-sm text-muted-foreground">{result.summary}</p>
                <div className="mt-3 flex gap-4 text-sm">
                  <span className="text-muted-foreground">Net strength Δ:</span>
                  <span className={result.delta >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                    {result.delta >= 0 ? "+" : ""}{result.delta.toFixed(3)}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="mb-3 font-semibold">Changed atoms ({changed.length})</h3>
                {changed.length === 0
                  ? <p className="text-sm text-muted-foreground">No atoms were affected (no atoms exist yet).</p>
                  : <div className="max-h-72 space-y-2 overflow-auto pr-1">
                      {changed.map((a: any) => (
                        <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border/60 p-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{a.topic}</div>
                            <div className="text-xs text-muted-foreground">{a.subject}</div>
                          </div>
                          <div className="flex items-center gap-3 text-xs font-mono">
                            <span className={`rounded px-1.5 py-0.5 ${strengthBg(a.strength)}`}>{(a.strength * 100).toFixed(0)}%</span>
                            <span className="text-muted-foreground">→</span>
                            <span className={`rounded px-1.5 py-0.5 ${strengthBg(a.newStrength)}`}>{(a.newStrength * 100).toFixed(0)}%</span>
                            <span className={`w-10 text-right font-bold ${a.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {a.delta >= 0 ? "+" : ""}{(a.delta * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                }
              </div>
            </>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              Configure and run a simulation to see results here.
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="mb-3 font-semibold">Past simulations</h3>
              <ul className="space-y-2">
                {history.map((run: any) => (
                  <li key={run.id} className="text-xs rounded-lg border border-border/60 bg-muted/20 p-2.5">
                    <div className="flex justify-between gap-2 mb-0.5">
                      <span className="font-medium capitalize">{run.strategy.replace("_", " ")}</span>
                      <span className="text-muted-foreground">{new Date(run.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-muted-foreground">{run.delta_summary}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

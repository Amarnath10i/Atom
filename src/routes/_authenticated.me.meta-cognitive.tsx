import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getMyMetaCognitive } from "@/lib/auth.functions";
import { BrainCircuit, CheckCircle2, XCircle, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/meta-cognitive")({
  head: () => ({
    meta: [{ title: "Thinking Patterns · LAMA" }],
  }),
  component: MetaCognitiveView,
});

function MetaCognitiveView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getMyMetaCognitive>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getMyMetaCognitive()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  if (err) return <div className="p-10 text-destructive">{err}</div>;
  if (!data) return <div className="p-10 text-muted-foreground">Loading your cognitive profile…</div>;

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-8">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <BrainCircuit className="h-8 w-8 text-primary" />
          Thinking Patterns Graph
        </h1>
        <p className="mt-2 text-muted-foreground max-w-3xl">
          LAMA tracks how you think, not just what you know. This is your Meta-Cognitive Profile, built using Predictive Reinforcement Learning.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Active Pattern Atoms</h2>
          {data.patterns.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              No strong patterns detected yet. Chat more for LAMA to learn your thinking style!
            </div>
          ) : (
            <div className="space-y-4">
              {data.patterns.map((p) => (
                <div key={p.id} className="rounded-xl border bg-card p-5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-primary">{p.pattern_type}</span>
                    <span className="text-sm font-medium opacity-70">
                      {(p.confidence * 100).toFixed(0)}% Confidence
                    </span>
                  </div>
                  <p className="text-sm text-card-foreground/80 mb-4">{p.description}</p>
                  
                  {/* Confidence Bar */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div 
                      className="h-full bg-primary transition-all duration-1000" 
                      style={{ width: `${Math.max(5, p.confidence * 100)}%` }} 
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Recent RL Predictions</h2>
          {data.predictions.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              No background predictions made yet.
            </div>
          ) : (
            <div className="space-y-3">
              {data.predictions.map((pred) => (
                <div key={pred.id} className="flex items-start gap-4 rounded-lg border bg-card p-4 text-sm">
                  <div className="mt-0.5">
                    {pred.status === "correct" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : pred.status === "incorrect" ? (
                      <XCircle className="h-5 w-5 text-destructive" />
                    ) : (
                      <Clock className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium">
                      Predicted Intent: <span className="font-normal text-muted-foreground">{pred.predicted_intent}</span>
                    </p>
                    <div className="mt-1 flex gap-2 text-xs opacity-60">
                      <span>Status: <strong className="uppercase">{pred.status}</strong></span>
                      {pred.resolved_at && <span>• Resolved: {new Date(pred.resolved_at).toLocaleString()}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

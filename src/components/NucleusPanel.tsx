import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { nucleusSearch, decaySession } from "@/lib/agents.functions";
import { AtomStateBadge, type AtomState } from "./AtomStateBadge";
import { Search, Atom, Waves } from "lucide-react";
import { toast } from "sonner";

type Atom = { id: string; subject: string; topic: string; state?: string; gravity?: number; strength?: number; nucleus_text?: string | null };

export function NucleusPanel({ studentId, atoms }: { studentId: string; atoms: Atom[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; topic: string; subject?: string; sim: number; gravity?: number }>>([]);

  const search = useMutation({
    mutationFn: () => nucleusSearch({ data: { studentId, query: q, k: 8 } }),
    onSuccess: (r) => setHits(r.hits ?? []),
    onError: (e: Error) => toast.error(e.message),
  });
  const decay = useMutation({
    mutationFn: () => decaySession({ data: { studentId } }),
    onSuccess: () => toast.success("Recency decay applied · gravity recomputed"),
  });

  const byGravity = [...atoms].sort((a, b) => (b.gravity ?? 0) - (a.gravity ?? 0)).slice(0, 8);

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Atom className="h-4 w-4 text-primary" />
          <h2 className="font-display text-lg font-semibold">Nucleus memory</h2>
        </div>
        <button onClick={() => decay.mutate()} disabled={decay.isPending}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold disabled:opacity-50">
          <Waves className="h-3 w-3" /> Decay session
        </button>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) search.mutate(); }}
        className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="semantic search atoms…"
            className="w-full rounded-md border border-border bg-card/40 py-1.5 pl-8 pr-2 text-sm" />
        </div>
        <button type="submit" disabled={search.isPending || !q.trim()}
          className="rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          Search
        </button>
      </form>

      <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        {hits.length ? "Top similar atoms (cosine)" : "Top atoms by gravity (0.6·mass + 0.4·recency)"}
      </div>
      <div className="space-y-1.5">
        {(hits.length ? hits.map(h => {
          const a = atoms.find(x => x.id === h.id);
          return { ...a, ...h };
        }) : byGravity).map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-md border border-border/60 bg-card/30 px-2.5 py-1.5">
            <div className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium">{a.subject ?? "?"}</span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span>{a.topic}</span>
            </div>
            <div className="flex items-center gap-2">
              {"sim" in a && a.sim != null && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  sim {Number(a.sim).toFixed(2)}
                </span>
              )}
              {a.gravity != null && (
                <span className="text-[10px] text-muted-foreground">g {Number(a.gravity).toFixed(2)}</span>
              )}
              <AtomStateBadge state={(a.state as AtomState) ?? "active"} />
            </div>
          </div>
        ))}
        {!byGravity.length && !hits.length && (
          <div className="text-xs text-muted-foreground">No atoms yet — chat with the tutor to seed memory.</div>
        )}
      </div>
    </section>
  );
}

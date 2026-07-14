// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getCurriculumGraph, getRootCauseChain } from "@/lib/learning-os.functions";
import { GitBranch, Circle, RefreshCw, AlertTriangle, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/curriculum")({
  head: () => ({
    meta: [{ title: "Curriculum Graph · LAMA" }],
  }),
  component: CurriculumPage,
});

type Node = {
  id: string; subject: string; topic: string;
  prerequisites: string[]; mastery: number; priority: number; estimatedHours: number;
  x?: number; y?: number;
};
type Edge = { source: string; target: string };
type GraphData = { nodes: Node[]; edges: Edge[]; student: any };

const SUBJECT_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  Mathematics: { fill: "#1e3a5f", stroke: "#3b82f6", text: "#93c5fd" },
  Physics:     { fill: "#1e3a2f", stroke: "#22c55e", text: "#86efac" },
  Chemistry:   { fill: "#3a1e2f", stroke: "#a855f7", text: "#d8b4fe" },
  Biology:     { fill: "#2f3a1e", stroke: "#84cc16", text: "#bef264" },
  Botany:      { fill: "#213a1e", stroke: "#84cc16", text: "#bef264" },
  Zoology:     { fill: "#3a2c1e", stroke: "#f59e0b", text: "#fcd34d" },
};

function masteryColor(m: number): string {
  if (m > 0.75) return "#22c55e";
  if (m > 0.5)  return "#eab308";
  if (m > 0.25) return "#f97316";
  return "#ef4444";
}

/** Layered layout using subject grouping + priority ordering */
function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const subjects = [...new Set(nodes.map((n) => n.subject))];
  const colW = 220;
  const rowH = 72;
  const padX = 60;
  const padY = 60;

  const positioned = nodes.map((n) => ({ ...n }));

  const subjectIdx = Object.fromEntries(subjects.map((s, i) => [s, i]));

  // Group by subject, sort within by priority desc then topic
  const groups: Record<string, Node[]> = {};
  for (const n of positioned) {
    if (!groups[n.subject]) groups[n.subject] = [];
    groups[n.subject].push(n);
  }
  for (const g of Object.values(groups)) {
    g.sort((a, b) => b.priority - a.priority || a.topic.localeCompare(b.topic));
  }

  for (const [subject, group] of Object.entries(groups)) {
    const col = subjectIdx[subject];
    group.forEach((n, row) => {
      n.x = padX + col * colW;
      n.y = padY + row * rowH;
    });
  }

  return positioned;
}

function CurriculumPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Node | null>(null);
  const [filter, setFilter] = useState<string>("All");
  const [examView, setExamView] = useState<"JEE" | "NEET">("JEE");
  const [rootCause, setRootCause] = useState<any>(null);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const load = async (exam: "JEE" | "NEET") => {
    setLoading(true);
    setErr(null);
    try {
      const d = await getCurriculumGraph({ data: { exam } });
      if (d && d.nodes) {
        const laid = layoutNodes(d.nodes, d.edges);
        setData({ ...d, nodes: laid });
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load curriculum");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(examView); }, [examView]);

  // Fetch root-cause chain whenever a node is selected.
  useEffect(() => {
    if (!selected) { setRootCause(null); return; }
    let cancelled = false;
    setLoadingRoot(true);
    getRootCauseChain({ data: { topic: selected.topic, subject: selected.subject } })
      .then((r) => { if (!cancelled) setRootCause(r); })
      .catch(() => { if (!cancelled) setRootCause(null); })
      .finally(() => { if (!cancelled) setLoadingRoot(false); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  if (loading) return <PageShell><div className="py-24 text-center text-muted-foreground text-sm animate-pulse">Building curriculum graph…</div></PageShell>;
  if (err)     return <PageShell><div className="py-12 text-destructive">{err}</div></PageShell>;
  if (!data)   return null;

  const subjects = ["All", ...new Set(data.nodes.map((n) => n.subject))];
  const visible = filter === "All" ? data.nodes : data.nodes.filter((n) => n.subject === filter);
  const visibleIds = new Set(visible.map((n) => n.id));
  const visibleEdges = data.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

  const nodeById = Object.fromEntries(data.nodes.map((n) => [n.id, n]));

  // SVG dimensions
  const subjects2 = [...new Set(visible.map((n) => n.subject))];
  const svgW = Math.max(700, subjects2.length * 220 + 120);
  const maxRows = Math.max(...subjects2.map((s) => visible.filter((n) => n.subject === s).length));
  const svgH = Math.max(400, maxRows * 72 + 120);

  // Re-layout visible nodes
  const visibleLaid = layoutNodes(visible, visibleEdges);
  const visibleNodeMap = Object.fromEntries(visibleLaid.map((n) => [n.id, n]));

  return (
    <PageShell>
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            <GitBranch className="h-3.5 w-3.5" /> Phase 1 · Curriculum Graph
          </div>
          <h1 className="text-3xl font-bold">Prerequisite Map</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.nodes.length} topics across {subjects.length - 1} subjects.
            Node colour = mastery level.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="mr-1 flex items-center rounded-full border border-border p-0.5 text-xs font-semibold">
            {(["JEE", "NEET"] as const).map((ex) => (
              <button
                key={ex}
                onClick={() => { if (ex !== examView) { setFilter("All"); setSelected(null); setExamView(ex); } }}
                className={`rounded-full px-3 py-1 transition ${
                  examView === ex ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {ex}
              </button>
            ))}
          </div>
          {subjects.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === s
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:border-foreground/40"
              }`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => load(examView)}
            className="rounded-full border border-border p-1.5 text-muted-foreground hover:text-foreground transition"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex items-center gap-4 text-xs text-muted-foreground">
        {[["#22c55e","≥ 75%"], ["#eab308","50–75%"], ["#f97316","25–50%"], ["#ef4444","< 25%"]].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />
            {l} mastery
          </div>
        ))}
        <div className="ml-auto">→ prerequisite direction</div>
      </div>

      {/* SVG Graph */}
      <div className="rounded-2xl border border-border bg-card/40 overflow-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgW} ${svgH}`}
          width="100%"
          style={{ minHeight: 360, maxHeight: 560 }}
        >
          <defs>
            <marker id="arrow-cur" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M2 2L8 5L2 8" fill="none" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round"/>
            </marker>
          </defs>

          {/* Edges */}
          {visibleEdges.map((e, i) => {
            const src = visibleNodeMap[e.source];
            const tgt = visibleNodeMap[e.target];
            if (!src || !tgt) return null;
            const x1 = (src.x ?? 0) + 90, y1 = (src.y ?? 0) + 18;
            const x2 = (tgt.x ?? 0) + 90, y2 = (tgt.y ?? 0) + 18;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2 - 20;
            return (
              <path
                key={i}
                d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
                fill="none"
                stroke="#374151"
                strokeWidth="1.5"
                markerEnd="url(#arrow-cur)"
              />
            );
          })}

          {/* Nodes */}
          {visibleLaid.map((n) => {
            const colors = SUBJECT_COLORS[n.subject] ?? { fill: "#1a1a1a", stroke: "#6b7280", text: "#d1d5db" };
            const mColor = masteryColor(n.mastery);
            const isSelected = selected?.id === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
                onClick={() => setSelected(isSelected ? null : n)}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={0} y={0} width={180} height={52} rx={10}
                  fill={colors.fill}
                  stroke={isSelected ? "#fff" : mColor}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  opacity={0.92}
                />
                {/* Mastery bar */}
                <rect x={8} y={42} width={Math.round(164 * n.mastery)} height={4} rx={2} fill={mColor} opacity={0.8} />
                <rect x={8} y={42} width={164} height={4} rx={2} fill="#374151" opacity={0.3} />
                <text x={90} y={17} textAnchor="middle" fontSize={11} fontWeight="600" fill={colors.text}>
                  {n.topic.length > 22 ? n.topic.slice(0, 22) + "…" : n.topic}
                </text>
                <text x={90} y={32} textAnchor="middle" fontSize={9} fill="#9ca3af">
                  {n.subject} · P{n.priority} · {n.estimatedHours}h
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected node detail */}
      {selected && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold">{selected.topic}</h3>
              <p className="text-sm text-muted-foreground">{selected.subject} · Priority {selected.priority} · {selected.estimatedHours}h estimated</p>
            </div>
            <button onClick={() => setSelected(null)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
          </div>
          <div className="mt-4 flex items-center gap-6 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Mastery</div>
              <div className="mt-1 font-bold" style={{ color: masteryColor(selected.mastery) }}>
                {(selected.mastery * 100).toFixed(0)}%
              </div>
            </div>
            {selected.prerequisites.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground">Prerequisites</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {selected.prerequisites.map((p) => (
                    <span key={p} className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs">{p}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Root-cause chain */}
          <div className="mt-5 rounded-xl border border-amber-700/40 bg-amber-950/10 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-300 mb-3">
              <AlertTriangle className="h-3.5 w-3.5" /> Root-cause traversal
            </div>
            {loadingRoot && <div className="text-xs text-muted-foreground animate-pulse">Walking prerequisite chain…</div>}
            {!loadingRoot && rootCause && rootCause.chain?.length > 0 && (
              <>
                <div className="text-xs text-muted-foreground mb-3">
                  If <span className="font-semibold text-foreground">{selected.topic}</span> is weak, these upstream prerequisites are likely the cause:
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {rootCause.chain.slice(0, 8).map((c: any, i: number) => (
                    <div key={c.topic + i} className="flex items-center gap-2">
                      <span
                        className={`rounded-md border px-2 py-1 text-xs ${
                          c.mastery < 0.5
                            ? "border-rose-700/50 bg-rose-950/30 text-rose-300"
                            : c.mastery < 0.75
                            ? "border-yellow-700/50 bg-yellow-950/30 text-yellow-300"
                            : "border-emerald-700/50 bg-emerald-950/30 text-emerald-300"
                        }`}
                      >
                        {c.topic} <span className="opacity-60">· {(c.mastery * 100).toFixed(0)}%</span>
                      </span>
                      {i < Math.min(7, rootCause.chain.length - 1) && (
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  ))}
                </div>
                {rootCause.roots?.length > 0 ? (
                  <div className="text-xs">
                    <span className="font-semibold text-amber-300">Likely root cause{rootCause.roots.length > 1 ? "s" : ""}:</span>{" "}
                    {rootCause.roots.map((r: any, i: number) => (
                      <span key={r.topic + i} className="ml-1 rounded-md border border-amber-700/50 bg-amber-950/30 px-2 py-0.5 text-amber-200">
                        {r.topic} ({(r.mastery * 100).toFixed(0)}%)
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No weak prerequisites detected — this topic stands on its own.</div>
                )}
              </>
            )}
            {!loadingRoot && (!rootCause || rootCause.chain?.length === 0) && (
              <div className="text-xs text-muted-foreground">No curriculum chain available yet.</div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-6 py-12 md:py-16">{children}</div>;
}

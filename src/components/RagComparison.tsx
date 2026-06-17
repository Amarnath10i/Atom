import { useState } from "react";
import { Zap, Layers } from "lucide-react";

/**
 * Side-by-side comparison: naive flat RAG vs LAMA molecular memory retrieval.
 * Pure client-side simulation — uses canned but realistic snippets so judges
 * can see the difference in one click, without burning tokens.
 */
const QUERIES = [
  {
    q: "Why did I get rotational motion problems wrong last week?",
    flat: [
      "Rotational motion: torque = r × F. Moment of inertia I = Σmr².",
      "Newton's second law for rotation: τ = Iα.",
      "Angular momentum L = Iω is conserved when net torque is zero.",
    ],
    lama: [
      "ATOM #r-mot · strength 38% (decayed from 71% over 9 days)",
      "BOND: r-mot ↔ vectors (w=0.82) — student weak on cross-product sign convention (3 errors in Session #14)",
      "DIAGNOSTIC FLAG: confuses torque direction when axis is non-vertical (severity 0.7)",
      "CRITIC REFLECTION (Session #16): 'Re-derive τ = r × F geometrically before next set.'",
      "PLAN: Week 7 · revisit Rigid Body — pending",
    ],
  },
  {
    q: "Suggest my next 3 NEET biology topics.",
    flat: [
      "NCERT Class 11 Biology — Cell: The Unit of Life.",
      "Human Physiology — Digestion & Absorption.",
      "Plant Physiology — Photosynthesis in Higher Plants.",
    ],
    lama: [
      "GRAVITY-RANKED NUCLEUS for Aarav (NEET):",
      "1. Genetics — Mendel's Laws (strength 42%, 4 bonds to weak topics) ★ HIGH PRIORITY",
      "2. Human Physiology — Neural Control (strength 51%, last reviewed 12d ago, decay imminent)",
      "3. Ecology — Biodiversity (strength 68%, planned Week 9, prerequisite for Evolution arc)",
      "PLANNER: Schedules 25-min spaced session on Genetics tonight (Hinglish mode on).",
    ],
  },
];

export function RagComparison() {
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(false);
  const ex = QUERIES[idx];

  return (
    <div className="glass rounded-2xl p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="chip" style={{ color: "var(--teal)" }}>
            <Layers className="h-3 w-3" /> Retrieval comparison
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold">
            Flat RAG vs <span style={{ color: "var(--saffron)" }}>LAMA</span> molecular memory
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Same query. Left: a vanilla vector store. Right: LAMA atoms, bonds, gravity, and agent state.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={idx}
            onChange={(e) => { setIdx(Number(e.target.value)); setShown(false); }}
            className="rounded-lg border border-border bg-card/60 px-2 py-2 text-xs"
          >
            {QUERIES.map((q, i) => (
              <option key={i} value={i}>{q.q}</option>
            ))}
          </select>
          <button
            onClick={() => setShown(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground glow-saffron"
          >
            <Zap className="h-4 w-4" /> Run comparison
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Query · </span>
        {ex.q}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Pane
          title="Flat RAG"
          subtitle="cosine similarity over embedded chunks"
          tone="muted"
          items={shown ? ex.flat : []}
          empty="Click Run comparison."
        />
        <Pane
          title="LAMA molecular retrieval"
          subtitle="atoms + bonds + gravity + agent reflections"
          tone="saffron"
          items={shown ? ex.lama : []}
          empty="Click Run comparison."
        />
      </div>

      {shown && (
        <div className="mt-4 rounded-lg border border-border bg-card/40 p-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Why LAMA wins:</strong> retrieves personalized state
          (decay, bond weights, diagnostic flags, planner context), not just topical text. The tutor
          can act on it directly — no extra reasoning hop to figure out who the student is.
        </div>
      )}
    </div>
  );
}

function Pane({
  title, subtitle, tone, items, empty,
}: {
  title: string; subtitle: string; tone: "muted" | "saffron"; items: string[]; empty: string;
}) {
  const color = tone === "saffron" ? "var(--saffron)" : "var(--muted-foreground)";
  return (
    <div className="rounded-xl border border-border bg-card/30 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-sm font-semibold" style={{ color }}>{title}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{subtitle}</div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          {empty}
        </div>
      ) : (
        <ol className="space-y-2 text-xs">
          {items.map((t, i) => (
            <li key={i} className="rounded-md border border-border bg-background/40 px-3 py-2 leading-relaxed">
              {t}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

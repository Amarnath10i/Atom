// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Map, CheckCircle2, Circle, Lock, ArrowRight,
  Atom, GitBranch, TrendingDown, BarChart3, Brain,
  FlaskConical, Sparkles, Users, Zap, Target, Shuffle,
  ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/roadmap")({
  head: () => ({
    meta: [
      { title: "Learning OS Roadmap · LAMA" },
      { name: "description", content: "Five-layer Learning OS architecture roadmap." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: RoadmapPage,
});

// ─── Data for each layer ───────────────────────────────────────────────────

const LAYERS = [
  {
    id: "phase3",
    label: "Phase 3",
    tag: "Aspirational",
    description: "Advanced AI-native capabilities — counterfactual reasoning, exam orchestration, and dynamic multi-agent composition.",
    colorClass: "border-rose-700/60 bg-rose-950/30",
    badgeClass: "bg-rose-900/50 text-rose-300 border-rose-700/50",
    dotClass: "bg-rose-500",
    locked: false,
    features: [
      {
        icon: GitBranch,
        label: "Counterfactual",
        description: '"What if you studied X instead of Y?" — projects alternate learning paths.',
        to: "/me/counterfactual",
        status: "live",
      },
      {
        icon: Target,
        label: "Exam strategy",
        description: "AI-generated week-by-week study plan calibrated to your learner model and exam date.",
        to: "/me/exam-strategy",
        status: "live",
      },
      {
        icon: Shuffle,
        label: "Dynamic agents",
        description: "Dynamically compose the right agent pipeline for each learning moment.",
        to: "/me/architecture",
        status: "live",
      },
    ],
  },
  {
    id: "phase2",
    label: "Phase 2",
    tag: "In Progress",
    description: "Simulation, richer reflection, and a digital twin that models how you learn.",
    colorClass: "border-amber-700/60 bg-amber-950/30",
    badgeClass: "bg-amber-900/50 text-amber-300 border-amber-700/50",
    dotClass: "bg-amber-500",
    locked: false,
    features: [
      {
        icon: FlaskConical,
        label: "Learning simulator",
        description: "Run virtual study sessions and see projected atom-strength changes before committing.",
        to: "/me/simulator",
        status: "live",
      },
      {
        icon: Sparkles,
        label: "Enhanced critic",
        description: "Subject-by-subject critique with graded actions and priority stack.",
        to: "/me/critic",
        status: "live",
      },
      {
        icon: Users,
        label: "Personal learning twin",
        description: "Your complete learner model: inferred style, velocity, retention, and predicted score.",
        to: "/me/learner",
        status: "live",
      },
    ],
  },
  {
    id: "phase1",
    label: "Phase 1 — highest ROI",
    tag: "Active",
    description: "Core scaffolding that turns raw atoms into a structured, measurable learning system.",
    colorClass: "border-emerald-700/60 bg-emerald-950/30",
    badgeClass: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50",
    dotClass: "bg-emerald-500",
    locked: false,
    features: [
      {
        icon: GitBranch,
        label: "Curriculum graph",
        description: "Prerequisite DAG of every topic in your syllabus, colour-coded by mastery.",
        to: "/me/curriculum",
        status: "live",
      },
      {
        icon: TrendingDown,
        label: "Forgetting curves",
        description: "Per-atom Ebbinghaus decay projections — know which topics to revise before they slip.",
        to: "/me/progress",
        status: "live",
      },
      {
        icon: BarChart3,
        label: "Outcome tracking",
        description: "Session-by-session performance history, subject breakdown, and study-streak heatmap.",
        to: "/me/progress",
        status: "live",
      },
      {
        icon: Brain,
        label: "Learner model",
        description: "Inferred learning velocity, retention rate, style profile, and at-risk topics.",
        to: "/me/learner",
        status: "live",
      },
    ],
  },
];

const EXISTING = [
  {
    id: "pipeline",
    label: "Existing pipeline",
    colorClass: "border-zinc-700/50 bg-zinc-900/30",
    badgeClass: "bg-zinc-800 text-zinc-400 border-zinc-700",
    features: [
      { icon: Zap, label: "Agent tools (×4)", description: "Diagnostic, Curator, Planner, Critic agents." },
      { icon: Zap, label: "Manual curator", description: "Merge, prune and bond atoms on demand." },
      { icon: Zap, label: "State inference", description: "Infers current atom state from conversation." },
      { icon: Zap, label: "Recency search", description: "Weights recent interactions higher in retrieval." },
    ],
  },
  {
    id: "foundation",
    label: "Foundation",
    colorClass: "border-zinc-700/50 bg-zinc-900/30",
    badgeClass: "bg-zinc-800 text-zinc-400 border-zinc-700",
    features: [
      { icon: Atom, label: "Atom / bond / gravity", description: "Core molecular memory model." },
      { icon: Atom, label: "Guard + canonicalize", description: "Safety rails and dedup logic." },
      { icon: Atom, label: "Auto atom extraction", description: "Pulls atoms from every conversation turn." },
    ],
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

function RoadmapPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 md:py-16">
      {/* Header */}
      <header className="mb-12 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Map className="h-3.5 w-3.5" />
          Architecture Roadmap
        </div>
        <h1 className="text-4xl font-bold tracking-tight">
          From AI tutor → Learning OS
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Five architectural layers that transform LAMA from a smart tutor into a full
          Learning Operating System. Phases build upward from the foundation.
        </p>
      </header>

      {/* Build-above layers (Phases 1–3) */}
      <div className="space-y-4">
        {LAYERS.map((layer) => (
          <PhaseLayer key={layer.id} layer={layer} />
        ))}
      </div>

      {/* Divider */}
      <div className="relative my-8">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-dashed border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-background px-4 text-xs text-muted-foreground">
            build above · exists below
          </span>
        </div>
      </div>

      {/* Existing layers */}
      <div className="space-y-4">
        {EXISTING.map((layer) => (
          <ExistingLayer key={layer.id} layer={layer} />
        ))}
      </div>
    </div>
  );
}

function PhaseLayer({ layer }: { layer: (typeof LAYERS)[0] }) {
  return (
    <div className={`rounded-2xl border p-5 ${layer.colorClass}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${layer.badgeClass}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${layer.dotClass}`} />
            {layer.label}
          </span>
          <span className="text-xs text-muted-foreground">{layer.description}</span>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {layer.features.map((f) => {
          const Icon = f.icon;
          return (
            <Link
              key={f.label}
              to={f.to as any}
              className="group flex flex-col gap-2 rounded-xl border border-border/60 bg-background/40 p-4 transition hover:border-border hover:bg-background/70"
            >
              <div className="flex items-center justify-between">
                <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition" />
                <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight">{f.label}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.description}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ExistingLayer({ layer }: { layer: (typeof EXISTING)[0] }) {
  return (
    <div className={`rounded-2xl border p-5 ${layer.colorClass}`}>
      <div className="mb-4 flex items-center gap-3">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${layer.badgeClass}`}>
          {layer.label}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {layer.features.map((f) => {
          const Icon = f.icon;
          return (
            <div
              key={f.label}
              className="flex flex-col gap-2 rounded-xl border border-border/40 bg-background/20 p-4"
            >
              <Icon className="h-4 w-4 text-muted-foreground/60" />
              <div>
                <div className="text-sm font-semibold text-muted-foreground leading-tight">{f.label}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground/70">{f.description}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

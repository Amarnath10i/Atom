import { Activity, AlertCircle, CheckCircle2, CalendarClock, Snowflake } from "lucide-react";

export type AtomState = "active" | "stuck" | "completed" | "planned" | "stale";

const META: Record<AtomState, { label: string; color: string; bg: string; icon: typeof Activity }> = {
  active:    { label: "Active",    color: "var(--teal)",        bg: "color-mix(in oklab, var(--teal) 18%, transparent)",        icon: Activity },
  stuck:     { label: "Stuck",     color: "var(--destructive)", bg: "color-mix(in oklab, var(--destructive) 18%, transparent)", icon: AlertCircle },
  completed: { label: "Got it",    color: "var(--saffron)",     bg: "color-mix(in oklab, var(--saffron) 18%, transparent)",     icon: CheckCircle2 },
  planned:   { label: "Planned",   color: "var(--primary)",     bg: "color-mix(in oklab, var(--primary) 18%, transparent)",     icon: CalendarClock },
  stale:     { label: "Stale",     color: "var(--muted-foreground)", bg: "color-mix(in oklab, var(--muted-foreground) 14%, transparent)", icon: Snowflake },
};

export function AtomStateBadge({ state, reason }: { state: AtomState | string; reason?: string | null }) {
  const m = META[(state as AtomState)] ?? META.active;
  const Icon = m.icon;
  return (
    <span title={reason ?? m.label}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: m.color, backgroundColor: m.bg }}>
      <Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}

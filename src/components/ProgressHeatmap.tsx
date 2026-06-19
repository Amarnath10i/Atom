type Atom = { subject: string; topic: string; strength: number; reviews: number };

export function ProgressHeatmap({ atoms }: { atoms: Atom[] }) {
  const bySubject = atoms.reduce<Record<string, Atom[]>>((acc, a) => {
    (acc[a.subject] ||= []).push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {Object.entries(bySubject).map(([subject, list]) => (
        <div key={subject}>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{subject}</div>
            <div className="text-[10px] text-muted-foreground">{list.length} topics</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {list.map((a) => {
              const s = a.strength;
              const bg = s > 0.7 ? "oklch(0.72 0.18 145)" : s > 0.5 ? "oklch(0.78 0.17 60)" : s > 0.3 ? "oklch(0.7 0.18 40)" : "oklch(0.65 0.22 25)";
              return (
                <div
                  key={a.topic}
                  title={`${a.topic} — strength ${(s * 100).toFixed(0)}% (${a.reviews} reviews)`}
                  className="flex h-10 min-w-[88px] items-center justify-between gap-2 rounded-md border border-border px-2 text-[11px] font-medium"
                  style={{ background: `color-mix(in oklab, ${bg} ${10 + s * 40}%, var(--card))` }}
                >
                  <span className="truncate">{a.topic}</span>
                  <span className="rounded px-1 text-[10px]" style={{ background: bg, color: "white" }}>
                    {(s * 100).toFixed(0)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

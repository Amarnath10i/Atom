import { createFileRoute, Link } from "@tanstack/react-router";
import { TopBar } from "@/components/TopBar";
import { ShieldCheck } from "lucide-react";
import { AtomWordmark } from "@/components/AtomMark";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atom — The AI tutor that never forgets" },
      { name: "description", content: "Atom is a minimal, elegant multi-agent AI tutor with persistent memory and adaptive 6-month plans for JEE & NEET." },
    ],
  }),
  component: Landing,
  errorComponent: ({ error }) => <div className="p-10 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-10">Not found</div>,
});

function Landing() {
  return (
    <>
      <TopBar />

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pt-24 pb-20 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3 w-3" /> Persistent memory · Guardrails on
        </div>
        <h1 className="text-5xl leading-[1.05] tracking-tight md:text-7xl">
          <AtomWordmark size="xl" withGlyph={false} />
          <span className="mt-3 block font-semibold text-foreground">The AI tutor</span>
          <span className="block font-light text-muted-foreground">that never forgets.</span>
        </h1>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/auth" className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90">
            Sign in
          </Link>
          <Link to="/admin" className="rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground transition hover:bg-card">
            Admin
          </Link>
        </div>
      </section>

      <footer className="mx-auto max-w-7xl px-6 py-12 text-center">
        <AtomWordmark size="sm" className="opacity-60" />
        <p className="mt-2 text-xs text-muted-foreground">Multi-agent AI tutor · Persistent memory</p>
      </footer>
    </>
  );
}

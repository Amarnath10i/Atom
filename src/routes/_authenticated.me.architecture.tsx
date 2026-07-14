import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useCallback, useState } from "react";
import { getMyArchitecture, getMe } from "@/lib/auth.functions";
import { createThread, updateThreadTitle } from "@/lib/tutor.functions";
import { useChat } from "@ai-sdk/react";
import { MemoryGraph } from "@/components/MemoryGraph";
import { AtomStateBadge } from "@/components/AtomStateBadge";
import ReactMarkdown from "react-markdown";
import {
  Brain, Atom, AlertTriangle, Sparkles, ArrowRight, ArrowUp,
  MessageSquare, Compass, FlaskConical, Workflow, X, Maximize2, Minimize2
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/architecture")({
  head: () => ({
    meta: [
      { title: "My Architecture · LAMA" },
      { name: "description", content: "Your LAMA molecular memory graph and chat." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: MyArchitecture,
});

const AGENT_META: Record<string, { label: string; icon: typeof Brain; color: string }> = {
  diagnose_weakness: { label: "Diagnostic Agent", icon: Compass, color: "var(--destructive)" },
  generate_practice: { label: "Curator Agent", icon: FlaskConical, color: "var(--saffron, #f59e0b)" },
  update_plan: { label: "Planner Agent", icon: Workflow, color: "var(--teal, #14b8a6)" },
  reflect_session: { label: "Critic Agent", icon: Sparkles, color: "oklch(0.75 0.18 290)" },
};

function MyArchitecture() {
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof getMyArchitecture>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [graphFullscreen, setGraphFullscreen] = useState(false);

  useEffect(() => {
    getMyArchitecture()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const goToChat = () => navigate({ to: "/chat" });

  if (err) return <div className="p-10 text-destructive">{err}</div>;
  if (!data) return <div className="p-10 text-muted-foreground">Loading your architecture…</div>;

  if (!data.student) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Brain className="mx-auto mb-4 h-10 w-10 text-primary" />
        <h1 className="text-2xl font-bold">Welcome to LAMA</h1>
        <p className="mt-2 text-muted-foreground">
          Your account isn't linked to a student profile yet. Sign out and sign up again.
        </p>
      </div>
    );
  }

  const s = data.student;
  const avgStrength = data.atoms.length
    ? data.atoms.reduce((a, b) => a + b.strength, 0) / data.atoms.length
    : 0;
  const isEmpty = data.atoms.length === 0;
  const displayName = s.name ? s.name.charAt(0).toUpperCase() + s.name.slice(1) : "";

  return (
    <div className="mx-auto max-w-7xl px-6 py-12 md:py-16">
      {/* Header */}
      <header className="mb-12 flex flex-wrap items-end justify-between gap-6 border-b border-border pb-8">
        <div className="space-y-3">
          <h1
            className="text-5xl md:text-6xl font-bold italic tracking-wide leading-tight"
            style={{ fontFamily: '"Pinyon Script", "Great Vibes", "Apple Chancery", "Snell Roundhand", cursive' }}
          >
            {displayName}'s Memory Architecture
          </h1>
          <p className="text-base text-muted-foreground">
            {s.exam} · Class {s.grade} · {s.language}
          </p>
        </div>
        <button
          onClick={goToChat}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition"
        >
          <MessageSquare className="h-4 w-4" />
          {isEmpty ? "Start your first session" : "Chat"}
        </button>
      </header>

      {/* Empty state — prominent CTA */}
      {isEmpty && (
        <div className="mb-8 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 text-primary">
            <Atom className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold">Your memory graph is empty</h2>
        </div>
      )}

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Atoms" value={data.atoms.length} />
        <Stat label="Bonds" value={data.bonds.length} />
        <Stat label="Weak topics" value={data.weak.length} />
        <Stat label="Avg strength" value={(avgStrength * 100).toFixed(0) + "%"} />
      </div>

      {/* Graph */}
      <section
        className={
          graphFullscreen
            ? "fixed inset-0 z-[100] flex flex-col rounded-none border-0 bg-background p-4"
            : "relative rounded-2xl border border-border bg-card p-4"
        }
        style={graphFullscreen ? { width: "100vw", height: "100vh" } : undefined}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Molecular memory graph</h2>
          <button
            onClick={() => setGraphFullscreen((v) => !v)}
            className="rounded-md border border-border p-1.5 hover:bg-muted transition"
            title={graphFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={graphFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {graphFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
        {isEmpty ? (
          <div className={`flex items-center justify-center text-sm text-muted-foreground ${graphFullscreen ? "flex-1" : "h-48"}`}>
            No atoms yet — your graph will appear here after your first chat.
          </div>
        ) : (
          <div className={graphFullscreen ? "flex-1 min-h-0" : ""}>
            <MemoryGraph atoms={data.atoms} bonds={data.bonds} className={graphFullscreen ? "h-full" : undefined} />
          </div>
        )}
      </section>

      {/* Atoms + weak topics */}
      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 font-semibold">Atoms</h2>
          {data.atoms.length === 0 ? (
            <p className="text-sm text-muted-foreground">No atoms yet — start chatting to build your memory.</p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-auto pr-1">
              {data.atoms.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2 rounded-lg border border-border/60 p-2 text-sm">
                  <div>
                    <div className="font-medium">{a.topic}</div>
                    <div className="text-xs text-muted-foreground">{a.subject}</div>
                  </div>
                  <AtomStateBadge state={(a as { state?: string }).state ?? "active"} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 font-semibold">Weak topics</h2>
          {data.weak.length === 0 ? (
            <p className="text-sm text-muted-foreground">No weak topics detected yet.</p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-auto pr-1">
              {data.weak.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 p-2 text-sm">
                  <div>
                    <div className="font-medium">{w.topic}</div>
                    <div className="text-xs text-muted-foreground">{w.subject}</div>
                  </div>
                  <span className="text-xs font-semibold text-destructive">{(w.severity * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

    </div>
  );
}

// ── Inline chat panel (slide-up) ─────────────────────────────────────────────
function ChatPanel({
  student,
  chatIds,
  setChatIds,
  onClose,
}: {
  student: { id: string; name: string; exam: string; language: string; avatar_emoji: string };
  chatIds: { studentId: string; threadId: string } | null;
  setChatIds: (ids: { studentId: string; threadId: string }) => void;
  onClose: () => void;
}) {
  const [language, setLanguage] = useState<"english" | "hinglish">(
    student.language as "english" | "hinglish" ?? "english"
  );
  const [localIds, setLocalIds] = useState(chatIds);
  const [initializing, setInitializing] = useState(!chatIds);
  const [sessionTitle, setSessionTitle] = useState<string>("New session");
  const [titleSaving, setTitleSaving] = useState(false);

  // Create thread if not yet done
  useEffect(() => {
    if (localIds) return;
    createThread({ data: { studentId: student.id } })
      .then((t) => {
        const ids = { studentId: student.id, threadId: t.id };
        setLocalIds(ids);
        setChatIds(ids);
        setSessionTitle((t as { title?: string }).title ?? "New session");
        setInitializing(false);
      })
      .catch(() => setInitializing(false));
  }, []);

  const { messages, append, status, input, setInput, error } = useChat({
    id: localIds?.threadId ?? "init",
    api: "/api/chat",
    body: { studentId: localIds?.studentId, threadId: localIds?.threadId, language },
    onError: (e) => console.error("[chat]", e),
  });

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, [localIds]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);
  useEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  const submit = async () => {
    const t = input.trim();
    if (!t || busy || !localIds) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    await append({ role: "user", content: t });
  };

  const PROMPTS = student.exam === "JEE"
    ? [
        "I'm scoring 30% on Rotational Motion. Help me fix it from scratch.",
        "Give me a JEE-Advanced problem on definite integrals.",
        "Plan my next 4 weeks on organic chemistry GOC.",
      ]
    : [
        "Quiz me on Mendelian genetics with NEET pattern questions.",
        "Explain neural coordination — I keep mixing up CNS vs PNS.",
        "Build a 6-week plan to push Biology above 90%.",
      ];

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-border bg-background shadow-2xl"
      style={{ height: "70vh", maxWidth: "860px", margin: "0 auto", left: 0, right: 0 }}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Brain className="h-5 w-5 text-primary shrink-0" />
          <input
            value={sessionTitle}
            onChange={(e) => setSessionTitle(e.target.value)}
            onBlur={async () => {
              const t = sessionTitle.trim();
              if (!t || !localIds) return;
              setTitleSaving(true);
              try {
                await updateThreadTitle({ data: { threadId: localIds.threadId, title: t } });
              } catch (e) {
                console.error("Failed to update session title", e);
              } finally {
                setTitleSaving(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="Session title"
            className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none border-b border-transparent focus:border-primary/40 px-1 py-0.5"
          />
          {titleSaving && <span className="text-[10px] text-muted-foreground">saving…</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLanguage((l) => l === "english" ? "hinglish" : "english")}
            className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            {language === "english" ? "EN" : "HI"}
          </button>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {initializing && (
          <div className="text-center text-sm text-muted-foreground py-8">Setting up your session…</div>
        )}
        {!initializing && messages.length === 0 && (
          <div className="py-4 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Namaste {student.name.split(" ")[0]} 👋 — ask me anything or pick a prompt:
            </p>
            <div className="flex flex-col gap-2 max-w-lg mx-auto">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => append({ role: "user", content: p })}
                  className="rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-left hover:border-primary/50 hover:bg-primary/5 transition"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => {
          const isUser = m.role === "user";
          const text = typeof m.content === "string" ? m.content
            : Array.isArray(m.content as any)
              ? (m.content as any[]).filter((p: any) => p.type === "text").map((p: any) => p.text).join("")
              : "";
          const toolCalls = (m as any).toolInvocations ?? [];
          return (
            <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                isUser ? "bg-primary text-primary-foreground" : "border border-border bg-card/60"
              }`}>
                {!isUser && toolCalls.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {toolCalls.map((c: any, i: number) => {
                      const meta = AGENT_META[c.toolName];
                      if (!meta) return null;
                      const Icon = meta.icon;
                      return (
                        <span key={i} className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-2 py-0.5 text-[10px] font-semibold" style={{ color: meta.color }}>
                          <Icon className="h-3 w-3" />{meta.label}
                        </span>
                      );
                    })}
                  </div>
                )}
                {isUser
                  ? <div className="whitespace-pre-wrap">{text}</div>
                  : <div className="prose-tutor"><ReactMarkdown>{text || "…"}</ReactMarkdown></div>
                }
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-primary" />
            Thinking…
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <div className="font-semibold">AI request failed</div>
            <div className="mt-1 whitespace-pre-wrap opacity-90">
              {error.message || "Unknown error"}
            </div>
            <div className="mt-1 opacity-70">
              Open <code>http://localhost:5173/api/health</code> in your browser to diagnose your .env setup.
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-card/60 px-3 pb-3 pt-2">
        <div className="rounded-xl border border-border bg-background focus-within:border-primary/50 focus-within:shadow-sm transition">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder={
              language === "hinglish"
                ? "Pucho kuch bhi — concept, doubt, ya practice question…"
                : "Ask anything — a concept, a doubt, or 'give me a hard JEE problem'…"
            }
            rows={1}
            style={{ resize: "none", minHeight: "40px", maxHeight: "160px", overflowY: "auto" }}
            className="w-full bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
            disabled={busy || initializing || !localIds}
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <span className="text-[10px] text-muted-foreground select-none">
              <kbd className="rounded border border-border px-1">Enter</kbd> send ·{" "}
              <kbd className="rounded border border-border px-1">Shift+Enter</kbd> newline
            </span>
            <button
              onClick={submit}
              disabled={busy || !input.trim() || initializing || !localIds}
              className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40 transition hover:bg-primary/90"
            >
              {busy
                ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                : <ArrowUp className="h-3.5 w-3.5" />
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { ArrowLeft, ArrowUp, Brain, Compass, FlaskConical, Sparkles, Workflow, Languages } from "lucide-react";
import { getMessages, getStudent } from "@/lib/tutor.functions";
import { TopBar } from "@/components/TopBar";

const studentQuery = (studentId: string) =>
  queryOptions({ queryKey: ["student", studentId], queryFn: () => getStudent({ data: { studentId } }) });
const messagesQuery = (threadId: string) =>
  queryOptions({ queryKey: ["messages", threadId], queryFn: () => getMessages({ data: { threadId } }) });

export const Route = createFileRoute("/student/$studentId/chat/$threadId")({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(studentQuery(params.studentId)),
      context.queryClient.ensureQueryData(messagesQuery(params.threadId)),
    ]);
  },
  component: ChatPage,
  errorComponent: ({ error }) => <div className="p-10 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-10">Not found</div>,
});

const AGENT_META = {
  diagnose_weakness: { label: "Diagnostic Agent", icon: Compass, color: "var(--destructive)" },
  generate_practice: { label: "Curator Agent", icon: FlaskConical, color: "var(--saffron)" },
  update_plan: { label: "Planner Agent", icon: Workflow, color: "var(--teal)" },
  reflect_session: { label: "Critic Agent", icon: Sparkles, color: "oklch(0.75 0.18 290)" },
};

function ChatPage() {
  const { studentId, threadId } = Route.useParams();
  const { data: student } = useSuspenseQuery(studentQuery(studentId));
  const { data: stored } = useSuspenseQuery(messagesQuery(threadId));
  const [language, setLanguage] = useState(
    student?.language ?? "english",
  );

  // Convert stored DB messages to AI SDK v4 format
  const initialMessages = useMemo(
    () =>
      stored.map((m) => ({
        id: m.id,
        role: m.role,
        content:
          ((m.content)?.parts ?? [])
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("") || "",
      })),
    [stored],
  );

  // AI SDK v4 useChat API
  const { messages, append, status, input, setInput, error } = useChat({
    id: threadId,
    api: "/api/chat",
    initialMessages,
    body: { studentId, threadId, language },
    onError: (e) => console.error("[chat error]", e),
  });

  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  // Auto-resize textarea like Gemini/Claude
  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, [threadId, status]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);
  useEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  const busy = status === "submitted" || status === "streaming";

  const submit = async () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    await append({ role: "user", content: t });
  };

  const pickPrompt = (q) => {
    if (busy) return;
    append({ role: "user", content: q });
  };

  return (
    <>
      <TopBar />
      <div className="mx-auto flex h-[calc(100vh-65px)] max-w-5xl flex-col px-4 py-4">
        {/* Header strip */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <Link
            to="/student/$studentId"
            params={{ studentId }}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <div className="chip">
              <span className="text-base">{student?.avatar_emoji}</span> {student?.name} · {student?.exam}
            </div>
            <button
              onClick={() => setLanguage((l) => (l === "english" ? "hinglish" : "english"))}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold"
              title="Toggle Hinglish/English"
            >
              <Languages className="h-3.5 w-3.5" />
              {language === "english" ? "English" : "Hinglish"}
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span className="mt-0.5">⚠️</span>
            <div>
              <div className="font-semibold">LAMA couldn't respond</div>
              <div className="text-xs opacity-80">{error.message || "An error occurred. Make sure your .env has a valid LLM key: GEMINI_API_KEY, ANTHROPIC_API_KEY, or NVIDIA_API_KEY"}</div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-border bg-card/30 p-5">
          {messages.length === 0 && (
            <Welcome name={student?.name ?? ""} exam={student?.exam ?? "JEE"} onPick={pickPrompt} />
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-primary" />
              Tutor agent is thinking…
            </div>
          )}
        </div>

        {/* Composer — Gemini/Claude style auto-expanding */}
        <div className="mt-3 rounded-2xl border border-border bg-card/60 transition-shadow focus-within:border-primary/50 focus-within:shadow-md">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              language === "hinglish"
                ? "Pucho kuch bhi — concept, doubt, ya practice question…"
                : "Ask anything — a concept, a doubt, or 'give me a hard problem'…"
            }
            rows={1}
            style={{ resize: "none", minHeight: "44px", maxHeight: "200px", overflowY: "auto" }}
            className="w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
            disabled={busy}
          />
          <div className="flex items-center justify-between px-3 pb-2.5">
            <span className="text-[10px] text-muted-foreground select-none">
              <kbd className="rounded border border-border px-1">Enter</kbd> send ·{" "}
              <kbd className="rounded border border-border px-1">Shift+Enter</kbd> newline · LAMA safety active
            </span>
            <button
              onClick={submit}
              disabled={busy || !input.trim()}
              className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40 transition hover:bg-primary/90"
              title="Send message"
            >
              {busy ? (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Welcome({ name, exam, onPick }) {
  const prompts =
    exam === "JEE"
      ? [
          "I'm scoring 30% on Rotational Motion. Help me build it up from scratch.",
          "Give me a JEE-Advanced level problem on definite integrals.",
          "Plan my next 4 weeks focusing on organic chemistry GOC.",
        ]
      : [
          "Quiz me on Mendelian genetics with NEET pattern questions.",
          "Explain neural coordination — I keep mixing up CNS vs PNS.",
          "Build a 6-week plan to push Biology accuracy past 90%.",
        ];
  return (
    <div className="mx-auto max-w-2xl py-8 text-center">
      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary glow-saffron">
        <Brain className="h-7 w-7" />
      </div>
      <h2 className="font-display text-2xl font-bold">Namaste {name.split(" ")[0]} 👋</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        I'm LAMA — your Layered Atomic Memory tutor. I'll consult Diagnostic, Curator, Planner and Critic agents as we go — and remember it all.
      </p>
      <div className="mt-5 grid gap-2 text-left md:grid-cols-3">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="rounded-xl border border-border bg-card/50 p-3 text-xs hover:border-primary/60"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";

  // AI SDK v4: content is a plain string (or array of parts for tool calls)
  const text = typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.filter((p) => p.type === "text").map((p) => p.text).join("")
      : "";

  // Tool invocations in v4 live in message.toolInvocations
  const toolCalls = message.toolInvocations ?? [];

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${isUser ? "bg-primary text-primary-foreground" : "border border-border bg-card/60"}`}>
        {!isUser && toolCalls.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {toolCalls.map((c, i) => {
              const meta = AGENT_META[c.toolName];
              if (!meta) return null;
              const Icon = meta.icon;
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-2 py-0.5 text-[10px] font-semibold"
                  style={{ color: meta.color }}
                >
                  <Icon className="h-3 w-3" />
                  {meta.label}
                </span>
              );
            })}
          </div>
        )}
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm">{text}</div>
        ) : (
          <div className="prose-tutor text-sm">
            <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{text || "…"}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { ArrowUp, Brain, Languages, Plus, Sparkles, X } from "lucide-react";
import { getMe } from "@/lib/auth.functions";
import { getMessages, getThread } from "@/lib/tutor.functions";

/**
 * /chat/:threadId — main Gemini/Claude-style chat surface.
 *
 * Features wired in this file:
 *   • Model switcher (Gemini ↔ Claude) — sent as `provider` in /api/chat body.
 *   • Attachment (+) button — text files inlined, others noted by filename.
 *   • Composer keeps focus; Enter sends, Shift+Enter newline.
 *
 * Silent multi-key rotation (5 Gemini + 5 Claude) is handled server-side in
 * `src/lib/ai-gateway.server.ts` — no UI surface needed.
 */
export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  ssr: false,
  loader: async ({ params }) => {
    const me = await getMe();
    if (!me.student) throw new Error("No student profile for this account.");
    const [stored, thread] = await Promise.all([
      getMessages({ data: { threadId: params.threadId } }),
      getThread({ data: { threadId: params.threadId } }).catch(() => null),
    ]);
    return { student: me.student, stored, thread };
  },
  component: ChatView,
  errorComponent: ({ error }) => (
    <div className="p-10 text-destructive">{error.message}</div>
  ),
});

type ModelName = "gemini" | "claude";
type Attachment = {
  name: string;
  size: number;
  text?: string;
  /** data: URL for binary files we want the model to actually read (images, PDFs). */
  url?: string;
  contentType?: string;
};

function ChatView() {
  const { threadId } = Route.useParams();
  const { student, stored, thread } = Route.useLoaderData();
  const [language, setLanguage] = useState(student.language ?? "english");

  // Persist the chosen model per browser so it survives reloads.
  const [model, setModel] = useState<ModelName>(() => {
    if (typeof window === "undefined") return "gemini";
    return (localStorage.getItem("lama:model") as ModelName) || "gemini";
  });
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("lama:model", model);
  }, [model]);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const { messages, append, status, input, setInput, error } = useChat({
    id: threadId,
    api: "/api/chat",
    initialMessages,
    body: { studentId: student.id, threadId, language, provider: model },
    onError: (e) => console.error("[chat]", e),
  });

  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const busy = status === "submitted" || status === "streaming";

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

  function buildMessage(text: string) {
    if (!attachments.length) return text;
    const parts = [text.trim()];
    for (const a of attachments) {
      if (a.text) {
        parts.push(
          `\n\n---\n[Attached file: ${a.name} — ${a.size} bytes]\n\`\`\`\n${a.text}\n\`\`\``,
        );
      } else if (a.url) {
        // Binary (image / PDF) is sent as a real multimodal attachment;
        // just leave a short marker in the visible text.
        parts.push(`\n\n[Attached ${a.contentType || "file"}: ${a.name}]`);
      } else {
        parts.push(`\n\n[Attached file: ${a.name} — ${a.size} bytes]`);
      }
    }
    return parts.join("");
  }

  async function readAsDataUrl(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(f);
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: Attachment[] = [];
    const MAX_BIN = 15 * 1024 * 1024; // 15 MB cap for images/PDFs
    for (const f of Array.from(files).slice(0, 4)) {
      const type = f.type || "";
      const isImage = type.startsWith("image/");
      const isPdf = type === "application/pdf" || /\.pdf$/i.test(f.name);
      const isText =
        type.startsWith("text/") ||
        /\.(md|txt|csv|json|js|ts|tsx|jsx|py|html|css|yml|yaml)$/i.test(f.name);

      try {
        if (isImage || isPdf) {
          if (f.size > MAX_BIN) {
            alert(`${f.name} is larger than 15 MB and was skipped.`);
            continue;
          }
          const url = await readAsDataUrl(f);
          next.push({
            name: f.name,
            size: f.size,
            url,
            contentType: type || (isPdf ? "application/pdf" : "application/octet-stream"),
          });
        } else if (isText && f.size < 64 * 1024) {
          const text = await f.text();
          next.push({ name: f.name, size: f.size, text });
        } else {
          next.push({ name: f.name, size: f.size });
        }
      } catch (err) {
        console.warn("[chat] failed to read file", f.name, err);
        next.push({ name: f.name, size: f.size });
      }
    }
    setAttachments((prev) => [...prev, ...next].slice(0, 4));
  }

  const submit = async () => {
    const t = input.trim();
    if ((!t && !attachments.length) || busy) return;
    const payload = buildMessage(t);
    // Binary attachments (images / PDFs) go to the model as
    // experimental_attachments so the AI SDK forwards them as proper
    // multimodal parts (image_url / file) instead of just a filename.
    const expAttachments = attachments
      .filter((a) => !!a.url)
      .map((a) => ({
        name: a.name,
        contentType: a.contentType || "application/octet-stream",
        url: a.url as string,
      }));
    setInput("");
    setAttachments([]);
    if (inputRef.current) inputRef.current.style.height = "auto";
    await append({
      role: "user",
      content: payload || (expAttachments.length ? "(see attached file)" : ""),
      ...(expAttachments.length ? { experimental_attachments: expAttachments } : {}),
    });
  };

  const isEmpty = messages.length === 0;
  const firstName = (student.name || "there").split(" ")[0];
  const greetingName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();

  const composer = (
    <div className="rounded-2xl border border-border bg-card/60 transition focus-within:border-primary/50 focus-within:shadow-md">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          {attachments.map((a, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px]"
            >
              📎 {a.name}
              <button
                type="button"
                onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}
                className="opacity-60 hover:opacity-100"
                aria-label={`Remove ${a.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
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
            : "Ask anything — a concept, a doubt, or 'give me a hard problem'…"
        }
        rows={1}
        style={{ resize: "none", minHeight: "44px", maxHeight: "200px", overflowY: "auto" }}
        className="w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        disabled={busy}
      />
      <div className="flex items-center justify-between px-3 pb-2.5">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,text/*,.md,.txt,.csv,.json,.js,.ts,.tsx,.jsx,.py,.html,.css,.yml,.yaml"
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
            title="Attach file"
            aria-label="Attach file"
          >
            <Plus className="h-4 w-4" />
          </button>
          <span className="hidden text-[10px] text-muted-foreground select-none sm:inline">
            {model === "gemini" ? "Gemini" : "Claude"} ·{" "}
            <kbd className="rounded border border-border px-1">Enter</kbd> send
          </span>
        </div>
        <button
          onClick={submit}
          disabled={busy || (!input.trim() && !attachments.length)}
          className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
          title="Send"
        >
          {busy ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col">
      {/* Slim top header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5 md:px-6">
        <div className="flex min-w-0 items-center gap-2 pl-10 md:pl-0">
          <Brain className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-semibold" title={thread?.title || "New session"}>
            {thread?.title || "New session"}
          </span>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            · {student.exam} · {student.name}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setModel("gemini")}
              className={`flex items-center gap-1 rounded px-2 py-1 transition ${
                model === "gemini" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
              title="Use Google Gemini"
            >
              <Sparkles className="h-3 w-3" /> Gemini
            </button>
            <button
              type="button"
              onClick={() => setModel("claude")}
              className={`flex items-center gap-1 rounded px-2 py-1 transition ${
                model === "claude" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
              title="Use Anthropic Claude"
            >
              <Sparkles className="h-3 w-3" /> Claude
            </button>
          </div>

          <button
            onClick={() => setLanguage((l) => (l === "english" ? "hinglish" : "english"))}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
            title="Toggle Hinglish/English"
          >
            <Languages className="h-3.5 w-3.5" />
            {language === "english" ? "English" : "Hinglish"}
          </button>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive md:mx-6">
          <span className="mt-0.5">⚠️</span>
          <div>
            <div className="font-semibold">LAMA couldn't respond</div>
            <div className="text-xs opacity-80">{error.message}</div>
          </div>
        </div>
      )}

      {isEmpty ? (
        // New session: greeting + centered composer
        <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 md:px-6">
          <div className="mx-auto w-full max-w-2xl">
            <h2
              className="mb-8 text-center text-5xl md:text-6xl text-foreground"
              style={{ fontFamily: "var(--font-script)" }}
            >
              Hi {greetingName}
            </h2>
            {composer}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
              <div className="space-y-6">
                {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
                {busy && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-primary" />
                    Thinking…
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="border-t border-border bg-background">
            <div className="mx-auto max-w-3xl px-4 py-3 md:px-6">{composer}</div>
          </div>
        </>
      )}
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";
  const text = typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.filter((p) => p.type === "text").map((p) => p.text).join("")
      : "";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground"
            : "max-w-[85%] text-sm leading-relaxed text-foreground"
        }
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{text}</div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{text}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

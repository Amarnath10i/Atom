import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

/**
 * Models often write LaTeX as \( … \) and \[ … \], but remark-math only
 * understands $ … $ and $$ … $$ (and markdown eats the backslashes, leaving
 * raw "(\Delta U)" in the chat). Rewrite them outside code spans/blocks.
 */
export function normalizeMath(text: string): string {
  // Split on fenced blocks and inline code so their contents stay untouched.
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`),
    )
    .join("");
}

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div
      className={[
        "prose prose-neutral dark:prose-invert max-w-none",
        "text-[15px] leading-7",
        "prose-p:my-3 prose-headings:mt-6 prose-headings:mb-2 prose-headings:font-semibold",
        "prose-h2:text-lg prose-h3:text-base prose-li:my-1",
        "prose-table:text-sm prose-pre:bg-muted prose-pre:text-foreground",
        "prose-code:before:content-none prose-code:after:content-none",
      ].join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          img: ({ src, alt }) => (
            <figure className="my-4">
              <img
                src={typeof src === "string" ? src : undefined}
                alt={alt || "diagram"}
                loading="lazy"
                className="mx-auto my-0 max-h-[420px] max-w-full rounded-xl border border-border bg-white object-contain"
                onError={(e) => {
                  const fig = e.currentTarget.closest("figure");
                  if (fig) fig.style.display = "none";
                }}
              />
              {alt ? (
                <figcaption className="mt-2 text-center text-xs text-muted-foreground">{alt}</figcaption>
              ) : null}
            </figure>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
}

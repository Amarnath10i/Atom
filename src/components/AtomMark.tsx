import { cn } from "@/lib/utils";

/**
 * Atom brand mark — minimal SVG nucleus + three orbital ellipses.
 * Pairs with the calligraphy "Atom" wordmark.
 */
export function AtomGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={cn("h-6 w-6", className)}
      aria-hidden="true"
    >
      <ellipse cx="32" cy="32" rx="28" ry="11" />
      <ellipse cx="32" cy="32" rx="28" ry="11" transform="rotate(60 32 32)" />
      <ellipse cx="32" cy="32" rx="28" ry="11" transform="rotate(120 32 32)" />
      <circle cx="32" cy="32" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AtomWordmark({
  className,
  size = "md",
  withGlyph = true,
}: {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  withGlyph?: boolean;
}) {
  const sizes = {
    sm: { word: "text-2xl", glyph: "h-5 w-5" },
    md: { word: "text-3xl", glyph: "h-6 w-6" },
    lg: { word: "text-5xl", glyph: "h-8 w-8" },
    xl: { word: "text-7xl md:text-8xl", glyph: "h-12 w-12 md:h-14 md:w-14" },
  }[size];
  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      {withGlyph && <AtomGlyph className={sizes.glyph} />}
      <span
        className={cn("leading-none", sizes.word)}
        style={{ fontFamily: "var(--font-script)" }}
      >
        Atom
      </span>
    </span>
  );
}
// Lovable-specific error reporting removed.
// This is a no-op stub so existing imports don't break.
export function reportLovableError(
  _error: unknown,
  _context: Record<string, unknown> = {},
) {
  // No-op in local / non-Lovable environments.
  // Replace with your own error reporter (Sentry, etc.) if needed.
}

/* ──────────────────────────────────────────────────────────
   Starward — Anthropic payload sanitization

   The Anthropic API rejects request bodies containing unpaired
   UTF-16 surrogates with:
     400 invalid_request_error: "no low surrogate in string ..."
   Lone surrogates can sneak in via corrupted input, emoji
   fragments, or database strings truncated mid-codepoint.
   These helpers scrub everything that crosses the network
   boundary so the user never sees that failure mode.
   ────────────────────────────────────────────────────────── */

/**
 * Replace any lone UTF-16 surrogate with U+FFFD (replacement character).
 * High surrogate not followed by low surrogate, OR low surrogate not
 * preceded by high surrogate → replace.
 */
export function stripLoneSurrogates(s: string): string {
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g,
    (_m, pre = "", low = "") => (low ? `${pre}\uFFFD` : "\uFFFD"),
  );
}

/**
 * Recursively walk a value and strip lone surrogates from every string
 * found inside. Preserves array/object shape.
 */
export function sanitizeForJSON<T>(value: T): T {
  if (typeof value === "string") return stripLoneSurrogates(value) as unknown as T;
  if (Array.isArray(value)) return value.map(sanitizeForJSON) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeForJSON(v);
    }
    return out as unknown as T;
  }
  return value;
}

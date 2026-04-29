/* ──────────────────────────────────────────────────────────
   Starward — Dev-mode action log: redaction

   Strips sensitive fields, masks emails, truncates long
   strings. Pure functions, frontend-safe.
   ────────────────────────────────────────────────────────── */

const REDACTED = "<redacted>";

const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|token|access[-_]?token|refresh[-_]?token|api[-_]?key|password|secret|jwt|bearer)$/i;

const EMAIL_RE = /([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

const DEFAULT_STRING_TRUNC = 500;
const DEFAULT_OBJECT_BYTES_CAP = 5 * 1024;

export interface RedactOptions {
  /** Per-string truncation. Default 500. */
  stringTrunc?: number;
  /** Total serialized object size cap in bytes. Default 5 KB. */
  objectBytesCap?: number;
  /** When true, skip all truncation but still strip sensitive keys + emails. */
  full?: boolean;
}

/** Mask emails and (unless full) truncate long strings. */
export function redactString(s: string, opts: RedactOptions = {}): string {
  let out = s.replace(EMAIL_RE, (_, first: string, rest: string, domain: string) =>
    `${first}${"*".repeat(Math.max(rest.length, 2))}${domain}`,
  );
  if (opts.full) return out;
  const max = opts.stringTrunc ?? DEFAULT_STRING_TRUNC;
  if (out.length > max) out = out.slice(0, max) + `…(+${out.length - max} chars)`;
  return out;
}

/** Recursively redact: drop sensitive keys, mask emails, truncate strings. */
export function redactValue(v: unknown, opts: RedactOptions = {}): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return redactString(v, opts);
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((item) => redactValue(item, opts));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactValue(val, opts);
  }
  return out;
}

/** Top-level redact for log entry `details`. Caps total serialized size. */
export function redactDetails(
  details: Record<string, unknown>,
  opts: RedactOptions = {},
): Record<string, unknown> {
  const redacted = redactValue(details, opts) as Record<string, unknown>;
  if (opts.full) return redacted;
  const cap = opts.objectBytesCap ?? DEFAULT_OBJECT_BYTES_CAP;
  let serialized: string;
  try {
    serialized = JSON.stringify(redacted);
  } catch {
    return { _unserializable: true };
  }
  if (serialized.length <= cap) return redacted;
  return {
    ...redacted,
    _truncated: true,
    _originalBytes: serialized.length,
  };
}

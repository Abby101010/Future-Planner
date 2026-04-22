/* NorthStar server — shared repository helpers for jsonb columns.
 *
 * pg returns jsonb columns as either a parsed object (when the JSONB OID
 * parser is registered) or a raw string (legacy paths, copy from pg_catalog,
 * pg-promise fallbacks). Every repo needs the same 10 lines to normalize
 * this into a plain object — that's what `parseJson` is for.
 *
 * Use this helper in every `rowToX` mapper whenever you touch a jsonb
 * column. Do NOT reimplement it inline.
 */

/** Normalize a jsonb column value into a plain object. Returns `{}` for
 *  null, undefined, empty string, or unparseable input — the row mappers
 *  never want to deal with those edge cases. */
export function parseJson(v: unknown): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return v as Record<string, unknown>;
}

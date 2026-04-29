/* Starward server — view route
 *
 * GET /view/:kind — one endpoint to fetch any per-page view model.
 *
 * `kind` in the URL is the raw slug without the `view:` prefix, i.e.
 *   GET /view/dashboard          → view:dashboard
 *   GET /view/goal-plan?goalId=X → view:goal-plan
 *
 * The handler reconstructs the full QueryKind, looks it up in the
 * viewResolvers dispatch table, coerces query args, wraps the resolver
 * result in the standardized envelope, and sends it as JSON. On
 * unknown kinds we return a 404 with envelopeError; on resolver throws
 * we return a 500 with envelopeError. The envelope shape is always
 * used — never a bare payload.
 */

import { Router } from "express";
import { envelope, envelopeError } from "@starward/core";
import type { QueryKind } from "@starward/core";
import { viewResolvers } from "../views";
import { getCorrelationId } from "../middleware/requestContext";
import { instrument } from "../services/devLog/instrument";

const viewRouter = Router();

/** Coerce req.query into a plain Record<string, unknown>.
 *
 *  The desktop transport sends `?args=<JSON>` as a single encoded string
 *  so resolvers can take arbitrary shapes without per-field coercion. If
 *  that's what we got, parse it. Otherwise fall back to raw query params
 *  (useful for curl / manual testing).
 *
 *  Each resolver documents its own arg contract and throws if something
 *  is missing — we don't validate shape here. */
function coerceQueryArgs(q: unknown): Record<string, unknown> {
  if (!q || typeof q !== "object") return {};
  const raw = q as Record<string, unknown>;
  if (typeof raw.args === "string") {
    try {
      const parsed = JSON.parse(raw.args);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through to raw params */
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = v;
  }
  return out;
}

viewRouter.get("/:kind", async (req, res) => {
  const slug = req.params.kind;
  const kind = `view:${slug}` as QueryKind;
  const cid = getCorrelationId();
  const resolver = (viewResolvers as Record<string, typeof viewResolvers[QueryKind] | undefined>)[kind];
  if (!resolver) {
    res
      .status(404)
      .json(envelopeError(kind, "unknown_view", `Unknown view kind: ${kind}`, undefined, cid));
    return;
  }
  try {
    const args = coerceQueryArgs(req.query);
    const data = await instrument(
      {
        type: "query",
        actor: "backend",
        startSummary: `resolve ${kind}`,
        startDetails: { args },
        endSummary: (_r, ms) => `${kind} ✓ (${ms}ms)`,
      },
      () => resolver(args),
    );
    res.json(envelope(kind, data, undefined, cid));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json(envelopeError(kind, "view_failed", message, undefined, cid));
  }
});

export default viewRouter;

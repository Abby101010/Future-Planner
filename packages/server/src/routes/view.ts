/* NorthStar server — view route
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
import { envelope, envelopeError } from "@northstar/core";
import type { QueryKind } from "@northstar/core";
import { viewResolvers } from "../views";

const viewRouter = Router();

/** Coerce req.query (Express gives us strings-or-arrays-of-strings) into
 *  a plain Record<string, unknown>. We don't validate shape here — each
 *  resolver documents its own arg contract and throws if something is
 *  missing. */
function coerceQueryArgs(q: unknown): Record<string, unknown> {
  if (!q || typeof q !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q as Record<string, unknown>)) {
    out[k] = v;
  }
  return out;
}

viewRouter.get("/:kind", async (req, res) => {
  const slug = req.params.kind;
  const kind = `view:${slug}` as QueryKind;
  const resolver = (viewResolvers as Record<string, typeof viewResolvers[QueryKind] | undefined>)[kind];
  if (!resolver) {
    res
      .status(404)
      .json(envelopeError(kind, "unknown_view", `Unknown view kind: ${kind}`));
    return;
  }
  try {
    const args = coerceQueryArgs(req.query);
    const data = await resolver(args);
    res.json(envelope(kind, data));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json(envelopeError(kind, "view_failed", message));
  }
});

export default viewRouter;

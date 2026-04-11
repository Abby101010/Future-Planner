/* NorthStar server — HTTP entry point
 *
 * Mirrors the Electron IPC surface as REST routes. The renderer's
 * src/repositories/index.ts routes CLOUD_CHANNELS through fetch() to this
 * server; everything else continues over the local IPC bridge.
 *
 * Route path convention: IPC channel "domain:action" becomes "/domain/action".
 * For example, "entities:new-goal" → POST /entities/new-goal.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import { storeRouter } from "./routes/store";
import { entitiesRouter } from "./routes/entities";
import { aiRouter } from "./routes/ai";
import { calendarRouter } from "./routes/calendar";
import { remindersRouter } from "./routes/reminders";
import { monthlyContextRouter } from "./routes/monthlyContext";
import { modelConfigRouter } from "./routes/modelConfig";
import { chatRouter } from "./routes/chat";
import { memoryRouter } from "./routes/memory";
import { notificationsRouter } from "./routes/notifications";
import { getPool, closePool } from "./db/pool";
import { startWatcher } from "./watcher";

const PORT = Number(process.env.PORT) || 3741;

const app = express();

// ── Global middleware ────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "25mb" })); // chat payloads can carry base64 images
app.use(express.urlencoded({ extended: true }));

// ── Unauthenticated routes ───────────────────────────────
app.get("/health", async (_req, res) => {
  try {
    await getPool().query("select 1");
    res.json({ ok: true, db: "connected" });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ── Authenticated routes ─────────────────────────────────
// Every route past this point runs with req.userId populated.
app.use(authMiddleware);

app.use("/store", storeRouter);
app.use("/entities", entitiesRouter);
app.use("/ai", aiRouter);
app.use("/calendar", calendarRouter);
app.use("/reminder", remindersRouter);
app.use("/monthly-context", monthlyContextRouter);
app.use("/model-config", modelConfigRouter);
app.use("/chat", chatRouter);
app.use("/memory", memoryRouter);
app.use("/notifications", notificationsRouter);

// ── Error handler (must be last) ─────────────────────────
app.use(errorHandler);

// ── Startup ──────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[server] NorthStar API listening on :${PORT}`);
  console.log(`[server] DEV_USER_ID=${process.env.DEV_USER_ID ?? "(unset)"}`);
});

// Opt-in background task watcher. Off by default so local dev doesn't burn
// Postgres connections unless you're actually working on watcher features.
let stopWatcher: (() => void) | null = null;
if (process.env.ENABLE_TASK_WATCHER === "true") {
  const intervalMs = Number(process.env.TASK_WATCHER_INTERVAL_MS) || undefined;
  stopWatcher = startWatcher(intervalMs);
}

// ── Graceful shutdown ────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`[server] Received ${signal}, shutting down...`);
  if (stopWatcher) stopWatcher();
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[server] Force exit after 10s");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

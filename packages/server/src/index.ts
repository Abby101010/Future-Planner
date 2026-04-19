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
import http from "node:http";
import express from "express";
import cors from "cors";
import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import { timezoneStore } from "./dateUtils";
import { entitiesRouter } from "./routes/entities";
import { aiRouter } from "./routes/ai";
import { calendarRouter } from "./routes/calendar";
import { remindersRouter } from "./routes/reminders";
import { monthlyContextRouter } from "./routes/monthlyContext";
import { modelConfigRouter } from "./routes/modelConfig";
import { chatRouter } from "./routes/chat";
import { memoryRouter } from "./routes/memory";
import { toolChatRouter } from "./routes/toolChat";
import viewRouter from "./routes/view";
import commandsRouter from "./routes/commands";
import { getPool, closePool } from "./db/pool";
import { runMigrations } from "./db/migrate";
import { attachWebSocketServer, connectionRegistry } from "./ws";
import { startJobWorker, stopJobWorker } from "./job-worker";
import { startBullWorker, closeBullQueue } from "./jobs/queue";
import { registerAllJobHandlers } from "./jobs/handlers";
import { startScheduler, stopScheduler } from "./scheduler";

const DEBUG = process.env.DEBUG === "1" || process.env.LOG_LEVEL === "debug";

// Re-exported so later phases can `import { connectionRegistry } from
// "@northstar/server"` without reaching into the ws/ barrel directly.
export { connectionRegistry };

const PORT = Number(process.env.PORT) || 3741;

const app = express();

// ── Global middleware ────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "25mb" })); // chat payloads can carry base64 images
app.use(express.urlencoded({ extended: true }));

if (DEBUG) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      console.log(
        `[http] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`,
      );
    });
    next();
  });
}

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

// Timezone middleware — stores the X-Timezone header (IANA timezone
// string from the client) in AsyncLocalStorage so getEffectiveDate()
// can compute "today" in the user's local time (midnight boundary).
//
// Also opportunistically persists the header value into users.payload.timezone
// so background jobs (the scheduler, which has no HTTP context) can resolve
// the user's local time. Throttled to at most one update per user per
// 24h to avoid touching the DB on every request.
const lastTzPersist = new Map<string, number>();
const TZ_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;
app.use((req, _res, next) => {
  const tz = req.header("X-Timezone") || "UTC";
  if (req.userId && tz !== "UTC") {
    const last = lastTzPersist.get(req.userId) ?? 0;
    if (Date.now() - last > TZ_PERSIST_TTL_MS) {
      lastTzPersist.set(req.userId, Date.now());
      const userId = req.userId;
      void import("./middleware/requestContext").then(({ runWithUserId }) =>
        import("./repositories").then(({ users }) =>
          runWithUserId(userId, () => users.updatePayload({ timezone: tz })),
        ),
      ).catch((err) => {
        console.error("[tz-persist] failed for", userId, err);
      });
    }
  }
  timezoneStore.run(tz, () => next());
});

// ── Phase 5a: envelope-wrapped view + commands dispatchers ──
// Mounted BEFORE legacy routes so URLs on /view/* and /commands/*
// always hit the new dispatcher. Legacy routes remain for the phase 6
// cutover where several pages still fall back to them.
app.use("/view", viewRouter);
app.use("/commands", commandsRouter);

app.use("/entities", entitiesRouter);
app.use("/ai", aiRouter);
app.use("/calendar", calendarRouter);
app.use("/reminder", remindersRouter);
app.use("/monthly-context", monthlyContextRouter);
app.use("/model-config", modelConfigRouter);
app.use("/chat", chatRouter);
app.use("/memory", memoryRouter);
app.use("/ai-tools", toolChatRouter);

// ── Error handler (must be last) ─────────────────────────
app.use(errorHandler);

// ── Startup ──────────────────────────────────────────────
// Wrap Express in an http.Server so we can share the same listener
// between HTTP and the WebSocket upgrade handler (`/ws`).
const server = http.createServer(app);
attachWebSocketServer(server);

async function start() {
  try {
    await runMigrations();
  } catch (err) {
    console.error("[server] Migration failed, aborting startup:", err);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`[server] NorthStar API listening on :${PORT}`);
    console.log(`[server] WebSocket endpoint: ws://…:${PORT}/ws`);
    console.log(`[server] DEV_USER_ID=${process.env.DEV_USER_ID ?? "(unset)"}`);
    console.log(`[server] DEBUG=${DEBUG ? "on" : "off"}`);
    startJobWorker();
    registerAllJobHandlers();
    startBullWorker();
    startScheduler();
  });
}

void start();

// ── Graceful shutdown ────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`[server] Received ${signal}, shutting down...`);
  stopJobWorker();
  stopScheduler();
  await closeBullQueue().catch(() => {});
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

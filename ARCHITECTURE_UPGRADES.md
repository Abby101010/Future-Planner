# NorthStar — Additive AI Architecture Upgrades

> Describes the five additive layers shipped on top of the existing CQRS + Electron architecture. **Every phase is strictly additive** — no existing handler, route, CommandKind, or QueryKind was modified; only new files and (for `EventKind`) new enum values were appended.

For the broader app structure and end-to-end feature flows, see `APP_STRUCTURE.md` and `FLOW_DIAGRAMS.md`. This file covers the AI/agent side of the server that sits on top of that core.

---

## 1. Overview

| Phase | Capability                | New modules                                    | Status     |
|-------|---------------------------|-----------------------------------------------|------------|
| 1     | RAG knowledge layer       | `src/knowledge/`, `knowledge-base/`, `scripts/` | live       |
| 2     | Critique agent            | `src/critique/`                                | pilot live |
| 3     | BullMQ async queue        | `src/jobs/queue.ts`, `src/jobs/handlers.ts`    | live (noop handler) |
| 4     | Scheduled background jobs | `src/scheduler/`                                | live       |
| 5     | Tool-use layer            | `src/tools/`, `src/routes/toolChat.ts`          | live       |

All code lives under `packages/server/`. The renderer, `@northstar/core`, and the Electron IPC surface were left alone except for one additive enum append in `packages/core/src/protocol/kinds.ts` (`"agent:critique"` event kind).

---

## 2. Phase 1 — RAG Knowledge Layer

**Goal:** methodology (task decomposition, time estimation, psychology, goal setting) lives as editable markdown and is pulled into AI prompts on demand, instead of being baked into handler system-prompts.

### Components

- **Storage:** `knowledge_chunks` table (migration `0009_pgvector.sql`), `pgvector` + `pgcrypto` extensions. Columns: `id`, `source`, `chunk_index`, `content`, `embedding vector(1024)`, `metadata jsonb`. `ivfflat` cosine index. Globally scoped — no `user_id`.
- **Embedding provider:** Voyage AI `voyage-3-large` (1024d). Env var: `VOYAGE_API_KEY`. Lazy-initialised in `src/knowledge/embeddings.ts`.
- **Chunker:** `src/knowledge/chunker.ts` — heading-based split on `#/##/###`, paragraph fallback when a section exceeds ~2000 chars.
- **Ingest CLI:** `scripts/ingest-knowledge.ts` (`npm run ingest-knowledge`). Reads every `*.md` under `knowledge-base/`, upserts on `(source, chunk_index)`. Free-tier paced at 25–30s between files (3 RPM limit on Voyage free tier).
- **Retrieval:** `src/knowledge/retrieve.ts` — `retrieveRelevant(query, topK=4, filter?)` runs `embedding <=> $1::vector` cosine-distance search.

### Knowledge corpus (as of initial ingest)

Located at `packages/server/knowledge-base/`:

| File                         | Chunks | Topics                                                        |
|------------------------------|--------|---------------------------------------------------------------|
| `task-decomposition.md`      | 9      | Atomic-task rule, WBS, next-action, Eisenhower, dependencies  |
| `time-estimation.md`         | 9      | Planning fallacy, Hofstadter, reference-class, PERT, buffers  |
| `psychology-principles.md`   | 11     | SDT, habit loop, implementation intentions, recovery, identity|
| `goal-setting.md`            | 10     | SMART, Locke/Latham, OKRs, ladders, anti-goals, reversal test |
| **Total**                    | **39** |                                                               |

### Integration point

`src/memory.ts::buildMemoryContext` gained an optional `retrievalQuery?: string` parameter. When present AND `contextType ∈ { "planning", "daily" }`, retrieval runs and a `Retrieved Knowledge:` section is injected before `═══ END MEMORY ═══`. When absent, behaviour is identical to pre-Phase-1.

```ts
export async function buildMemoryContext(
  memory: MemoryStore,
  contextType: "planning" | "daily" | "recovery" | "general",
  contextTags: string[] = [],
  retrievalQuery?: string,   // ← Phase 1 addition, opt-in
): Promise<string>;
```

All existing callers `await` the now-async function but pass no retrievalQuery, so behaviour is byte-identical to pre-Phase-1. **No handler prompt currently opts in** — the wire is live but unused. Opting a handler in is the Phase 2+ upgrade path.

---

## 3. Phase 2 — Critique Agent

**Goal:** every meaningful AI output gets a second-pass review by a cheaper model. The critique is fire-and-forget — it never blocks the primary response.

### Components

- **Prompt:** `src/critique/prompts.ts::CRITIQUE_SYSTEM` — four-category rubric (hallucination, overcommit, memory-violation, other).
- **Agent runner:** `src/critique/agent.ts::runCritiqueAgent(client, input)` uses `getModelForTier("light")` (Haiku). Parses first balanced-brace JSON from the response; sanitises severity/category enums.
- **Orchestrator:** `src/critique/index.ts::runCritique(req)` — fire-and-forget; always swallows errors; emits an `agent:critique` WS event on completion.

### WS event

`packages/core/src/protocol/kinds.ts` appended `"agent:critique"` to `EventKind`. Payload defined in `packages/server/src/ws/events.ts`:

```ts
interface CritiqueIssue {
  severity: "info" | "warn" | "error";
  category: "hallucination" | "overcommit" | "memory-violation" | "other";
  message: string;
  suggestion?: string;
}
interface AgentCritiquePayload {
  handler: string;
  correlationId?: string;
  overallAssessment: "ok" | "concerns" | "blocking";
  issues: CritiqueIssue[];
  summary?: string;
}
```

### Pilot wiring

Only one call site dispatches a critique today:

- `src/routes/commands/planning.ts` — `cmdRegenerateGoalPlan`, after the primary generate-goal-plan response returns. Detached via `void (async () => { ... })()`.

Expanding to other handlers = copy-pasting the detached block at the bottom of a handler and calling `runCritique(...)`. No renderer changes required; the event is broadcast on the user's existing WS connection.

---

## 4. Phase 3 — BullMQ Queue (Redis)

**Goal:** a durable, retriable queue for fire-and-forget work that outlives a single request.

### Components

- **Queue runtime:** BullMQ + ioredis. Queue name: `northstar-bg`.
- **Env var:** `REDIS_URL`. When unset the module is a no-op — `enqueueJob` silently drops, `startBullWorker` skips. Matches the additive-only guarantee.
- **Backing store:** Fly Upstash Redis (`northstar-redis`, yyz region, Pay-as-you-go plan). Warning: BullMQ's continuous polling costs ~$1/mo on PAYG — if traffic grows, switch to Fixed 250MB ($10/mo flat) via `fly redis update`.
- **API:** `src/jobs/queue.ts` exports
  - `enqueueJob(name, payload, opts?)` — returns jobId or null when Redis unavailable.
  - `registerJobHandler(name, handler)` — register before `startBullWorker`.
  - `startBullWorker()` / `closeBullQueue()` — lifecycle (called from `src/index.ts`).
  - `isQueueAvailable()` — capability check.
- **Defaults:** `attempts: 2`, exponential backoff, `removeOnComplete: { age: 3600 }`.

### Current handlers

Only one registered (`src/jobs/handlers.ts`):

```ts
registerJobHandler("noop", async (payload) => {
  console.log("[job.noop] handled", payload);
});
```

This is a smoke-test handler. **No existing command was migrated off the synchronous path.** Migration is explicitly future work — phase 3 only installs the plumbing.

### How to add a new background job

1. Define handler:
   ```ts
   // src/jobs/handlers.ts
   registerJobHandler("send-daily-digest", async (payload: { userId: string }) => {
     await runWithUserId(payload.userId, async () => { /* ... */ });
   });
   ```
2. Enqueue from a route:
   ```ts
   await enqueueJob("send-daily-digest", { userId: req.userId });
   ```
3. No other wiring needed — the worker boots automatically when `REDIS_URL` is set.

---

## 5. Phase 4 — Scheduler (per-user timezone)

**Goal:** nightly reflection and morning nudges fire at each user's local time, not at a hardcoded UTC hour.

### Components

- **Runtime:** `node-cron`. Single cron at top of every UTC hour (`0 * * * *`).
- **Env flag:** `ENABLE_SCHEDULER` — must be `"1"` or `"true"` to register. Default off; when unset, module is a no-op and boot is byte-identical to pre-Phase-4.
- **Target-hour env vars** (defaults shown):
  - `NIGHTLY_REFLECTION_HOUR=23` (11 PM local)
  - `MORNING_NUDGE_HOUR=7` (7 AM local)
- **Timing model:** cron fires hourly in UTC. For each user, the scheduler reads `users.payload.timezone`, computes their current local hour via `Intl.DateTimeFormat`, and runs the matching job when local-hour equals target. Net effect: each user fires exactly once per day at their own local time.
- **DST guard:** in-memory `Map<job, Map<userId, YYYY-MM-DD>>` prevents double-fires when DST fall-back repeats the same local hour. Resets on restart; jobs are idempotent within a day anyway.
- **Fallback timezone:** `"UTC"` if `payload.timezone` is missing/invalid.

### Source of user timezone

`users.payload.timezone` (IANA string, e.g. `"America/Toronto"`).

Persisted two ways:

1. **Manual settings endpoint:** `POST /commands/settings` with `{ user: { timezone: "..." } }` calls `repos.users.updatePayload({ timezone })`.
2. **Auto-persist middleware** (Phase 4, `src/index.ts`): every authenticated request reads the client's `X-Timezone` header. If non-`UTC` and the user hasn't been persisted in the last 24h, the header value is written to `payload.timezone`. Throttled via in-memory `Map<userId, timestamp>`.

### Scheduler code shape

```ts
// packages/server/src/scheduler/index.ts
export function startScheduler(): void;   // idempotent, ENABLE_SCHEDULER-gated
export function stopScheduler(): void;    // called from SIGTERM/SIGINT
export const _internal = {
  hourlyTick,             // async () => Promise<void>
  listSchedulableUsers,   // () => Promise<{ userId, tz }[]>
  localHourAndDate,       // (tz: string) => { hour: number; date: string }
};
```

The `_internal` object is exposed specifically so operators can invoke the tick via `fly ssh console` for verification/debugging (example usage in post-deploy verification sections below).

### Verifying scheduler timing on production

```bash
fly ssh console -a northstar-api -C "node -e \"
  const s = require('/repo/packages/server/dist/scheduler');
  s._internal.listSchedulableUsers().then(u => console.log(u));
  console.log(s._internal.localHourAndDate('America/Toronto'));
\""
```

---

## 6. Phase 5 — Tool-use Layer

**Goal:** a parallel chat endpoint where Claude can call read-only server tools (Anthropic tool-use protocol) instead of receiving all context in the system prompt.

### Components

- **Endpoint:** `POST /ai-tools/chat` — body `{ message, context? }`, returns `{ reply, iterations, stopReason, toolCalls }`. Mounted alongside (not replacing) the existing `/ai/chat` routes.
- **Tools registry:** `src/tools/definitions.ts::REGISTERED_TOOLS`. Each entry has the Anthropic-SDK-shaped `Tool` definition plus a server-side impl.
- **Loop:** `src/tools/loop.ts::runToolLoop` drives the tool_use → tool_result exchange. `MAX_ITERATIONS = 6`. Each impl wrapped in try/catch — a failing tool surfaces `{error: string}` back to the model rather than aborting.
- **Guardrail:** all impls run inside `runWithUserId(userId, ...)` so the same repo-layer scoping rules apply as on HTTP routes.

### Registered tools (read-only, Phase 5)

| Name                  | Input                                      | Output                                                                 |
|-----------------------|--------------------------------------------|-----------------------------------------------------------------------|
| `get_user_goals`      | `{ status? }` (default "active")           | `[{ id, title, description, status, targetDate, importance, … }]`     |
| `get_upcoming_tasks`  | `{ startDate?, days? }` (1–14 days)        | `[{ id, title, date, completed, duration, goalId, category, priority }]` |
| `get_memory_facts`    | `{ category?, limit? }` (confidence ≥ 0.4) | `[{ category, value, confidence, updatedAt }]`                        |
| `get_today_overview`  | `{}`                                       | `{ today, totalTasks, completed, pending, activeGoalCount, activeGoalTitles }` |

**No write tools.** Phase 5 is read-only by design. Adding writes requires explicit per-tool mutation guards and a fresh approval.

### How to add a new read-only tool

Append to `src/tools/definitions.ts`:

```ts
const myTool: RegisteredTool = {
  definition: {
    name: "my_tool",
    description: "Short description surfaced to the model.",
    input_schema: { type: "object", properties: { /* ... */ } },
  },
  impl: async (input, userId) => {
    return runWithUserId(userId, async () => {
      try { /* read repo data */ }
      catch (err) { return safeError(err); }
    });
  },
};
// then:
export const REGISTERED_TOOLS = { ..., my_tool: myTool };
```

---

## 7. Environment variables

| Name                         | Phase | Required? | Default | Purpose                                     |
|------------------------------|-------|-----------|---------|---------------------------------------------|
| `VOYAGE_API_KEY`             | 1     | yes (for retrieval/ingest) | —     | Voyage embeddings API                  |
| `REDIS_URL`                  | 3     | optional (queue no-ops without) | — | BullMQ backing store                   |
| `ENABLE_SCHEDULER`           | 4     | optional  | unset (off) | Set to `1` to run cron schedules      |
| `NIGHTLY_REFLECTION_HOUR`    | 4     | optional  | 23      | Target local hour for reflection            |
| `MORNING_NUDGE_HOUR`         | 4     | optional  | 7       | Target local hour for nudges                |
| `INGEST_PACE_MS`             | 1     | optional  | 25000   | Pause between files during `npm run ingest-knowledge` (Voyage free-tier 3 RPM) |

All set as Fly secrets (except `INGEST_PACE_MS`, which is local-script-only).

---

## 8. New file layout

```
packages/server/
├── knowledge-base/                    # Phase 1 — editable markdown corpus
│   ├── task-decomposition.md
│   ├── time-estimation.md
│   ├── psychology-principles.md
│   └── goal-setting.md
├── migrations/
│   └── 0009_pgvector.sql              # Phase 1 — pgvector + knowledge_chunks
├── scripts/
│   └── ingest-knowledge.ts            # Phase 1 — ingestion CLI
└── src/
    ├── knowledge/                     # Phase 1
    │   ├── index.ts                   # Barrel + types
    │   ├── embeddings.ts              # Voyage client
    │   ├── chunker.ts                 # Markdown heading splitter
    │   ├── ingest.ts                  # File → chunks → embeddings → upsert
    │   └── retrieve.ts                # Query → cosine search
    ├── critique/                      # Phase 2
    │   ├── index.ts                   # runCritique orchestrator
    │   ├── agent.ts                   # runCritiqueAgent (Haiku call)
    │   └── prompts.ts                 # CRITIQUE_SYSTEM
    ├── jobs/                          # Phase 3
    │   ├── queue.ts                   # BullMQ wrapper
    │   └── handlers.ts                # registerAllJobHandlers
    ├── scheduler/                     # Phase 4
    │   └── index.ts                   # startScheduler, hourlyTick
    ├── tools/                         # Phase 5
    │   ├── index.ts                   # Barrel
    │   ├── definitions.ts             # REGISTERED_TOOLS
    │   └── loop.ts                    # runToolLoop
    └── routes/
        └── toolChat.ts                # Phase 5 — /ai-tools/chat
```

---

## 9. Additive-only invariants

When modifying or extending this code, preserve these:

1. **No existing CommandKind, QueryKind, or route URL was deleted or repurposed.** Adding new ones is fine; renaming or removing is not.
2. **`EventKind` is append-only.** New events are fine; do not remove or rename existing.
3. **`buildMemoryContext` must remain no-op-equivalent without `retrievalQuery`.** Any future caller that opts in must pass it explicitly.
4. **Phase 3 queue must stay optional.** Code paths must work identically when `REDIS_URL` is unset.
5. **Phase 4 scheduler must stay gated.** `ENABLE_SCHEDULER` off = byte-identical boot to pre-Phase-4.
6. **Phase 5 tools are read-only.** Adding a write tool requires explicit per-tool guards; it is not a drop-in extension.
7. **No AI handler prompt has been modified.** Phase 1 wired retrieval but no caller opts in; preserve this until a deliberate handler-level change is approved.

If you (future Claude) are about to violate one of these, stop and ask first.

---

## 10. Deployment + smoke testing

Everything runs on Fly (`northstar-api` app, `yyz` region). Two machines, rolling deploy strategy.

### Deploying server changes

From repo root:
```bash
fly deploy
```

Server migrations run automatically on boot (`src/db/migrate.ts` called from `src/index.ts`).

### Running Phase 1 ingestion

```bash
# Set secrets first
fly secrets set VOYAGE_API_KEY=... -a northstar-api

# Ingest (local — needs DATABASE_URL which you can grab from Fly)
DATABASE_URL=$(fly ssh console -a northstar-api -C "sh -c 'printenv DATABASE_URL'" | tail -1) \
VOYAGE_API_KEY=... \
npm run ingest-knowledge --workspace=@northstar/server
```

Ingest is idempotent on `(source, chunk_index)`, so re-running after edits is safe.

### Smoke-testing Phase 5 tools from CLI

```bash
curl -X POST https://northstar-api.fly.dev/ai-tools/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_JWT" \
  -d '{"message": "what do I have on my plate today?"}'
```

Response shape:
```json
{
  "reply": "...",
  "iterations": 2,
  "stopReason": "end_turn",
  "toolCalls": [{ "name": "get_today_overview", "ms": 47 }]
}
```

---

## 11. Explicit non-goals

These are intentionally NOT implemented. If a future change appears to require them, stop and get approval first:

- **No handler prompts migrated to retrieval.** Phase 1 wires the capability; adoption is per-handler and pending.
- **No existing blocking commands moved to the BullMQ queue.** Phase 3 is plumbing only.
- **No write tools in Phase 5.** The tool-use endpoint is read-only.
- **No RLS on `knowledge_chunks`.** The table is intentionally global, not user-scoped.
- **Critique is a pilot.** Only `generate-goal-plan` dispatches one. Expanding is a deliberate per-handler change, not an automatic sweep.

---

## 12. Debugging cheat sheet

```bash
# Current Fly state
fly status -a northstar-api

# Recent logs
fly logs -a northstar-api --no-tail | tail -40

# SSH into the running machine
fly ssh console -a northstar-api

# Verify a module in the deployed image
fly ssh console -a northstar-api -C "sh -c 'grep -c per-user /repo/packages/server/dist/scheduler/index.js'"

# Invoke the scheduler tick manually (does not wait for the cron)
fly ssh console -a northstar-api -C "node -e \"
  require('/repo/packages/server/dist/scheduler')._internal.hourlyTick()
    .then(() => process.exit(0));
\""

# Check a user's persisted timezone
fly ssh console -a northstar-api -C "node -e \"
  require('/repo/packages/server/dist/scheduler')._internal.listSchedulableUsers()
    .then(u => { console.log(u); process.exit(0); });
\""

# Inspect what's in the knowledge_chunks table
fly ssh console -a northstar-api -C "node -e \"
  const { Pool } = require('/repo/node_modules/pg');
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  p.query('SELECT source, count(*) FROM knowledge_chunks GROUP BY source')
    .then(r => { console.log(r.rows); return p.end(); })
    .then(() => process.exit(0));
\""
```

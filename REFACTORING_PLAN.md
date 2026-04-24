# Starward Refactoring Plan

## Prompt for Claude Code

Copy everything below the line into Claude Code as a single prompt.

---

I need you to refactor this Starward codebase. Do each phase completely before moving to the next. After each phase, the app must still compile and work. Never break the build mid-phase.

## Current Architecture & Deployment

Starward is a personal AI-powered goal planner. It runs as two cooperating pieces:

1. **Electron desktop app** (`frontend/`) — React 18 + Vite renderer, Electron 33 main process with a full local AI pipeline (14 Claude handlers via `@anthropic-ai/sdk`). Currently has a local SQLite database (better-sqlite3) and JSON file fallback — **both should be removed**. All data should go through Supabase Postgres via the cloud backend. Users install a `.dmg`/`.exe`/`.AppImage`.

2. **Cloud backend** (`backend/`) — Express 5 + TypeScript server deployed on **Fly.io** (`app = "starward-api"`, region `yyz`, shared-cpu-1x 512MB, auto-stop/start). Database is **Supabase Postgres** (every table has `user_id` column, multi-user-ready). Auth is currently hardcoded phase 1 (`Bearer sophie` → `DEV_USER_ID=sophie` on server).

**Transport seam:** The renderer's `src/services/cloudTransport.ts` decides routing. If `VITE_CLOUD_API_URL` is set at build time (the `electron:dev` script sets it to `https://starward-api.fly.dev`), ~50 IPC channels route via HTTP POST to the Fly.io backend. Otherwise everything stays on local Electron IPC. The `src/repositories/index.ts` layer dispatches transparently — same function signature whether it goes to cloud or IPC.

**Backend Fly.io config:**
- Dockerfile: 2-stage build (node:22-alpine), copies `dist/` + `node_modules` + `schema.sql`
- Secrets (set via `fly secrets set`): `DATABASE_URL`, `ANTHROPIC_API_KEY`, `DEV_USER_ID`
- Health check: `GET /health` (queries Postgres)
- Routes mirror IPC channels: `POST /ai/home-chat`, `POST /entities/new-goal`, `POST /store/load`, etc.
- Auth middleware: requires `Authorization: Bearer <token>` header, reads `DEV_USER_ID` from env, sets `req.userId` via AsyncLocalStorage (`requestContext.ts`) so deeply-nested code can call `getCurrentUserId()`

**The core problems:**
1. ~5,000 lines of AI handlers, prompts, domain logic, types, and model config are **copy-pasted** between `frontend/electron/` and `backend/src/` and already drifting apart
2. The folder structure is a mess — `frontend/` contains both the React renderer AND the entire Electron main process (10,600 lines of Node.js code including AI handlers, a SQLite database layer that should be deleted, agents, memory, reflection workers, and a full Express API server)
3. No monorepo tooling — two independent `package.json` files with duplicated dependencies, no workspace, no shared package
4. The Electron app has its own SQLite database AND a JSON file fallback — both are unnecessary since Supabase Postgres is the single source of truth. All data access should route through the cloud backend.
5. Giant files everywhere — 882-line Zustand store, 900-1200 line page components, co-located `.css` files with no design system
6. No tests anywhere
7. No proactive task monitoring — the app only reacts when the user opens it, never checks on task progress or sends notifications

## Phase 1: Extract `packages/core` (shared code)

**Goal:** Eliminate all duplication by creating a shared package that both apps import.

### 1a. Create the monorepo package structure

Create `packages/core/` with this layout:

```
packages/core/
  package.json          # name: "@starward/core", no runtime deps except @anthropic-ai/sdk
  tsconfig.json         # target: ES2022, module: NodeNext, composite: true
  src/
    index.ts            # barrel export
    types/
      index.ts          # ALL shared types (merge frontend/src/types/index.ts + frontend/src/types/agents.ts)
    ai/
      handlers/         # Move the 14 handler files here (the FRONTEND versions are canonical)
        analyzeMonthlyContext.ts
        analyzeQuickTask.ts
        classifyGoal.ts
        dailyTasks.ts
        generateGoalPlan.ts
        goalBreakdown.ts
        goalPlanChat.ts
        goalPlanEdit.ts
        homeChat.ts
        onboarding.ts
        paceCheck.ts
        reallocate.ts
        recovery.ts
      prompts.ts        # Move from frontend/electron/ai/prompts.ts
      sanitize.ts       # Move from frontend/electron/ai/sanitize.ts
      personalize.ts    # Move from frontend/electron/ai/personalize.ts
      router.ts         # NEW: shared handleAIRequestDirect() switch statement only
    domain/
      cognitiveBudget.ts  # Move from frontend/electron/domain/cognitiveBudget.ts
      contextEvaluator.ts # Move from frontend/electron/agents/context-evaluator.ts
    model-config.ts     # Move from frontend/electron/model-config.ts (identical in both)
```

### 1b. Reconcile diverged files before moving

These files have drifted between frontend and backend. Reconcile them INTO the frontend version (which is more complete), incorporating backend-only additions:

- `ai/handlers/homeChat.ts` — The backend version has the `insertJob` eager plan generation. The frontend version removed that (slice 6 deleted the job queue). **Use the frontend version** (no insertJob). The server-side router can handle eager plan generation at the route level if needed.
- `ai/handlers/classifyGoal.ts` — Backend has different `max_tokens` (2048 vs 1024) and extra entity-creation logic with `getCurrentUserId`. **Use the frontend version's max_tokens (1024).** The entity creation logic in the backend version is a route concern, not an AI handler concern — that stays in `backend/src/routes/ai.ts`.
- `ai/handlers/dailyTasks.ts` — Backend imports `getCurrentUserId`. **Use the frontend version.** User ID threading is a caller concern.
- `ai/handlers/recovery.ts` — Backend has `randomUUID` import and different reflection call. **Use the frontend version.** Backend-specific reflection wiring stays in the backend route.
- `ai/handlers/paceCheck.ts` — Backend imports `getCurrentUserId`. **Use the frontend version.**
- `ai/prompts.ts` — Two-line diff (monthly context suggestion line is at different positions). **Merge: take the frontend version** which has the line in the correct position.

### 1c. Make handlers environment-agnostic

Every handler in `packages/core/src/ai/handlers/` must:
1. Take `(client: Anthropic, payload: Record<string, unknown>, memoryContext: string)` — NO imports from electron, pg, express, or any platform module.
2. Return a pure data result — no side effects (no DB writes, no IPC calls, no job insertion).
3. Import prompts from `../prompts`, model config from `../../model-config`, etc. — all relative within core.

Remove from handlers: any `import { insertJob }`, `import { getCurrentUserId }`, `import { loadMemory }`, `import { getMonthlyContext }`. Those are caller concerns.

### 1d. Update both apps to import from `@starward/core`

**Frontend `electron/ai/router.ts`:**
- Change all handler imports from `./handlers/xxx` to `@starward/core/ai/handlers/xxx`
- Change prompt/sanitize/personalize imports similarly
- Keep the coordinator routing logic (it's desktop-only for now)
- Keep `getClient()` in `electron/ai/client.ts` (it reads from user settings — desktop-specific)

**Backend `src/ai/router.ts`:**
- Change all handler imports to `@starward/core`
- Keep `getClient()` in `backend/src/ai/client.ts` (reads from env — server-specific)

**Delete the following duplicated files after imports are updated:**
- All 14 files in `backend/src/ai/handlers/`
- `backend/src/ai/prompts.ts`
- `backend/src/ai/sanitize.ts`
- `backend/src/ai/personalize.ts`
- `backend/src/model-config.ts`
- `backend/src/domain/cognitiveBudget.ts`
- `backend/src/database.ts` (the stub that returns null — callers should handle null at call site)
- All 14 files in `frontend/electron/ai/handlers/` (now in core)
- `frontend/electron/ai/prompts.ts`
- `frontend/electron/ai/sanitize.ts`
- `frontend/electron/ai/personalize.ts`
- `frontend/electron/model-config.ts`
- `frontend/electron/domain/cognitiveBudget.ts`

**Keep these (they're platform-specific):**
- `frontend/electron/ai/client.ts` — reads API key from user settings
- `frontend/electron/ai/router.ts` — has coordinator routing + memory loading
- `backend/src/ai/client.ts` — reads API key from env
- `backend/src/ai/router.ts` — simplified direct routing

### 1e. Wire up the monorepo

Add a root `pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
  - frontend
  - backend
```

Add a root `package.json` with `"private": true` and scripts for building.

In `frontend/package.json` and `backend/package.json`, add:
```json
"dependencies": {
  "@starward/core": "workspace:*"
}
```

Update `frontend/tsconfig.node.json` and `backend/tsconfig.json` to add a project reference to `packages/core/tsconfig.json`.

Make sure `frontend/vite.config.ts` resolves `@starward/core` properly (Vite should handle workspace packages, but verify).

### 1f. Verify

Run `cd frontend && npx tsc --noEmit` and `cd backend && npx tsc --noEmit`. Both must pass. The app must launch in dev mode.

---

## Phase 2: Delete the embedded Express server

**Goal:** Remove the third redundant API surface (`frontend/electron/api-server.ts`).

### Steps:

1. Delete `frontend/electron/api-server.ts` (333 lines).
2. In `frontend/electron/main.ts`, remove:
   - `import { startAPIServer, stopAPIServer, setAPIDBAvailable } from "./api-server"`
   - The `startAPIServer()` call in `app.whenReady()`
   - The `stopAPIServer()` call in `before-quit`
   - The `setAPIDBAvailable()` calls
3. Verify the app still works — the renderer uses IPC (local) or cloudInvoke (cloud), never localhost:3741.

---

## Phase 3: Add typed payloads to AI handlers

**Goal:** Replace `Record<string, unknown>` with strongly typed interfaces.

### Steps:

1. In `packages/core/src/types/ai-payloads.ts`, define a typed payload AND result interface for each handler:

```typescript
export interface DailyTasksPayload {
  date: string;
  goals: Array<{ title: string; goalType?: string; scope?: string; /* ... */ }>;
  pastLogs: Array<{ date: string; tasks: Array<{ title: string; completed: boolean }> }>;
  weeklyAvailability: Array<{ day: number; hour: number; importance: 1|2|3; label: string }>;
  existingTasks?: Array<{ title: string; completed: boolean; cognitiveWeight?: number }>;
  confirmedQuickTasks?: Array<{ title: string; cognitiveWeight?: number }>;
  vacationMode?: { active: boolean; startDate: string; endDate: string } | null;
  // ... every field currently accessed via `payload.xxx as Type`
}

export interface DailyTasksResult {
  date: string;
  tasks: Array<{ title: string; description: string; durationMinutes: number; /* ... */ }>;
}
```

2. Do this for ALL 14 handlers. Look at what each handler destructures from `payload` to build the interface — every `payload.xxx as SomeType` becomes a typed field.

3. Update each handler signature from:
```typescript
export async function handleDailyTasks(client: Anthropic, payload: Record<string, unknown>, memoryContext: string): Promise<unknown>
```
to:
```typescript
export async function handleDailyTasks(client: Anthropic, payload: DailyTasksPayload, memoryContext: string): Promise<DailyTasksResult>
```

4. The routers (`frontend/electron/ai/router.ts` and `backend/src/ai/router.ts`) cast at the boundary:
```typescript
case "daily-tasks":
  return handleDailyTasks(client, payload as DailyTasksPayload, memoryContext);
```

This is acceptable — the boundary is the one place where an untyped external input meets the typed internal world.

---

## Phase 4: Split the Zustand store into slices

**Goal:** Break `frontend/src/store/useStore.ts` (883 lines) into focused slice files.

### Steps:

1. Create `frontend/src/store/slices/` directory with these files:
   - `uiSlice.ts` — `currentView`, `setView`, `isLoading`, `setLoading`, `error`, `setError`
   - `userSlice.ts` — `user`, `setUser`, `updateSettings`, `conversations`, `addMessage`, `clearConversation`
   - `goalSlice.ts` — `goals`, `addGoal`, `updateGoal`, `removeGoal`, `addGoalPlanMessage`, `setGoalPlan`, `confirmGoalPlan`, `getBigGoals`, `getEverydayGoals`, `getRepeatingGoals`, `getGoalsByType`, `goalBreakdown`, `setGoalBreakdown`
   - `taskSlice.ts` — `dailyLogs`, `todayLog`, `setTodayLog`, `addDailyLog`, `toggleTask`, `snoozeTask`, `skipTask`, `startTaskTimer`, `stopTaskTimer`, `pendingTasks`, `addPendingTask`, `updatePendingTask`, `removePendingTask`, `confirmPendingTask`
   - `calendarSlice.ts` — `calendarEvents`, `addCalendarEvent`, `updateCalendarEvent`, `removeCalendarEvent`, `setCalendarEvents`, `deviceIntegrations`, `setDeviceIntegrations`, `updateIntegration`
   - `chatSlice.ts` — `chatSessions`, `activeChatId`, `homeChatMessages`, `addHomeChatMessage`, `clearHomeChat`, `startNewChat`, `switchChat`, `deleteChat`
   - `contextSlice.ts` — `monthlyContexts`, `setMonthlyContext`, `removeMonthlyContext`, `getMonthlyContext`, `getCurrentMonthContext`, `vacationMode`, `setVacationMode`
   - `memorySlice.ts` — `memorySummary`, `refreshMemorySummary`, `nudges`, `refreshNudges`, `dismissNudge`, `respondToNudge`, `activeJobs`, `setActiveJob`, `clearActiveJob`
   - `reminderSlice.ts` — `reminders`, `addReminder`, `acknowledgeReminder`, `removeReminder`
   - `persistenceSlice.ts` — `loadFromDisk`, `saveToDisk`, `resetGoalData`, `heatmapData`, `setHeatmapData`

2. Each slice file exports a creator function:
```typescript
import type { StateCreator } from "zustand";
import type { Store } from "../types"; // the full Store interface

export interface GoalSlice {
  goals: Goal[];
  addGoal: (goal: Goal) => void;
  // ...
}

export const createGoalSlice: StateCreator<Store, [], [], GoalSlice> = (set, get) => ({
  goals: [],
  addGoal: (goal) => set((s) => ({ goals: [...s.goals, goal] })),
  // ... move the implementation from useStore.ts
});
```

3. Rewrite `useStore.ts` to ~30 lines:
```typescript
import { create } from "zustand";
import { createUISlice } from "./slices/uiSlice";
import { createUserSlice } from "./slices/userSlice";
// ... all slices
import type { Store } from "./types";

const useStore = create<Store>()((...args) => ({
  ...createUISlice(...args),
  ...createUserSlice(...args),
  ...createGoalSlice(...args),
  ...createTaskSlice(...args),
  ...createCalendarSlice(...args),
  ...createChatSlice(...args),
  ...createContextSlice(...args),
  ...createMemorySlice(...args),
  ...createReminderSlice(...args),
  ...createPersistenceSlice(...args),
}));

export default useStore;
```

4. Move the `Store` interface into `frontend/src/store/types.ts` as the intersection of all slice interfaces.

5. Verify nothing breaks — every existing `useStore()` call should work identically.

---

## Phase 5: Decompose giant page components

**Goal:** No page file over 250 lines. Extract business logic into hooks, UI into components.

### 5a. GoalPlanPage.tsx (1,212 lines → ~200 lines)

Extract:
- `hooks/useGoalPlanChat.ts` — chat message sending, AI response handling, plan generation polling
- `hooks/useGoalPlanEdit.ts` — plan edit requests, suggestion application
- `components/GoalPlan/PlanTimeline.tsx` — the year/quarter/month/week tree rendering
- `components/GoalPlan/PlanChatPanel.tsx` — the chat sidebar
- `components/GoalPlan/PlanEditModal.tsx` — edit suggestion review UI
- `components/GoalPlan/PlanHeader.tsx` — goal title, status, progress bar

### 5b. TasksPage.tsx (925 lines → ~200 lines)

Extract:
- `hooks/useTaskGeneration.ts` — daily task AI generation, polling, job tracking
- `hooks/useDailyLog.ts` — task toggle/skip/snooze, timer start/stop, log management
- `components/Tasks/TaskCard.tsx` — single task with actions
- `components/Tasks/TaskList.tsx` — list of TaskCards with drag reorder
- `components/Tasks/TaskGenerationPanel.tsx` — the "generate tasks" button + progress UI

### 5c. DashboardPage.tsx (901 lines → ~200 lines)

Extract:
- `hooks/useHomeChat.ts` — message sending, intent detection, context change handling, pending task flow
- `components/Dashboard/HomeChatPanel.tsx` — chat messages + input
- `components/Dashboard/GoalSummaryCards.tsx` — goal overview cards
- `components/Dashboard/TodayOverview.tsx` — today's tasks summary
- `components/Dashboard/QuickActions.tsx` — quick-add buttons

### 5d. CalendarPage.tsx (782 lines → ~200 lines)

Extract:
- `hooks/useCalendarEvents.ts` — CRUD, device calendar sync, date navigation
- `components/Calendar/CalendarGrid.tsx` — month view grid
- `components/Calendar/EventModal.tsx` — create/edit event form
- `components/Calendar/DayDetail.tsx` — expanded day view with events

### 5e. After decomposition

Each page file should look like:
```tsx
export default function TasksPage() {
  const { tasks, isGenerating, generateTasks } = useTaskGeneration();
  const { todayLog, toggleTask, skipTask } = useDailyLog();

  return (
    <div className="tasks-page">
      <TaskGenerationPanel isGenerating={isGenerating} onGenerate={generateTasks} />
      <TaskList tasks={tasks} onToggle={toggleTask} onSkip={skipTask} />
    </div>
  );
}
```

---

## Phase 6: Add tests with Vitest

**Goal:** Test every pure function in `@starward/core` and every custom hook.

### 6a. Set up Vitest

Add to `packages/core/package.json`:
```json
"devDependencies": {
  "vitest": "^3.0.0"
}
```

Add `packages/core/vitest.config.ts`.

### 6b. Write tests for core domain logic

Create these test files in `packages/core/src/__tests__/`:

- `cognitiveBudget.test.ts` — test the budget calculation with various task weights, verify it caps at 12, verify monthly context multiplier works correctly
- `contextEvaluator.test.ts` — test `evaluateSchedulingContext()` with:
  - Empty day → full-load recommendation
  - 0% completion rate in last 7 days → recovery-day
  - 90% completion rate → momentum-day
  - All slots filled → overload risk flag
  - Yesterday's incomplete tasks → populated in unfinishedFromYesterday
  - Monthly context with intense (0.3x) → reduced budget and task cap
- `modelConfig.test.ts` — test tier mapping for each task type, test override application
- `sanitize.test.ts` — test lone surrogate stripping, test deeply nested object sanitization

### 6c. Write tests for AI handler JSON parsing

For each handler that parses JSON from Claude's response, write a test that:
1. Mocks the Anthropic client to return a known response string
2. Calls the handler
3. Asserts the parsed output matches expected structure

Priority handlers to test:
- `classifyGoal` — returns `{ importance, scope, goalType, reasoning, ... }`
- `analyzeMonthlyContext` — returns `{ intensity, capacityMultiplier, maxDailyTasks }`
- `analyzeQuickTask` — returns analysis with cognitive weight, conflicts
- `homeChat` — returns structured JSON with intent detection

### 6d. Add test script

Root `package.json`:
```json
"scripts": {
  "test": "pnpm -r run test",
  "test:core": "cd packages/core && npx vitest run"
}
```

---

## Phase 7 — Bug Fix: Structured Logging System (HIGH)

**Problem:** There is zero logging anywhere. No `console.log`, no structured logger, nothing. When AI calls fail, intents misfire, or handlers throw — dev mode shows nothing. Debugging requires manually adding `console.log` and removing it later.

### 7a. Create a shared logger

Create `packages/core/src/logger.ts` (or `frontend/src/utils/logger.ts` if Phase 1 hasn't happened yet):

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
};

const currentLevel: LogLevel =
  import.meta.env.DEV || import.meta.env.MODE === "development"
    ? "debug"
    : "warn";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function createLogger(namespace: string) {
  const prefix = `[${namespace}]`;
  return {
    debug: (...args: unknown[]) => shouldLog("debug") && console.debug(prefix, ...args),
    info:  (...args: unknown[]) => shouldLog("info")  && console.info(prefix, ...args),
    warn:  (...args: unknown[]) => shouldLog("warn")  && console.warn(prefix, ...args),
    error: (...args: unknown[]) => shouldLog("error") && console.error(prefix, ...args),
  };
}

export { createLogger };
export type { LogLevel };
```

### 7b. Add logging to critical paths

Add `createLogger` calls to these files (at minimum):

1. **`frontend/src/services/ai.ts`** — log every `submitAndWait` call with `{ type, payloadKeys }`, log errors with full details, log response timing
2. **`frontend/src/services/cloudTransport.ts`** — log `cloudInvoke` calls with channel, URL, response status, timing
3. **`frontend/electron/ai/handlers/homeChat.ts`** — log the raw LLM response, the `tryExtractJson` result (success/failure), the detected intent, any fallback to plain chat
4. **`frontend/electron/ai/router.ts`** — log which handler is dispatched for each incoming AI request
5. **`frontend/src/pages/DashboardPage.tsx`** — log the intent dispatch decision (what was detected, what store actions were called)

### 7c. Verification

- Run `npm run electron:dev` and interact with home chat
- Dev console should show timestamped, namespaced logs like:
  ```
  [ai:transport] POST /ai/home-chat → 200 (1.2s)
  [ai:homeChat] LLM response: { is_task: true, task_description: "..." }
  [dashboard] Intent detected: task — dispatching addTask()
  ```

---

## Phase 8 — Bug Fix: Restore Local Dev AI Fallback (MID)

**Problem:** `submitAndWait()` in `frontend/src/services/ai.ts:56-59` throws unconditionally when `VITE_CLOUD_API_URL` is not set. This means running `npm run dev` (which does NOT set the env var) breaks ALL AI features. Only `npm run electron:dev` works, because it hardcodes `VITE_CLOUD_API_URL=https://starward-api.fly.dev`.

The Electron main process still has all 14 AI handlers locally (`frontend/electron/ai/router.ts` → `handleAIRequestDirect()`), and the IPC bridge is intact (`window.electronAPI.invoke()` in `frontend/electron/preload.ts`). The bridge was just never wired into `submitAndWait()` after slice 6 deleted the job queue.

### 8a. Add IPC fallback to `submitAndWait()`

In `frontend/src/services/ai.ts`, change `submitAndWait()` (lines 52-63) from:

```typescript
async function submitAndWait<T = unknown>(
  type: string,
  payload: Record<string, unknown>,
  _onProgress?: (progress: number, log: unknown[]) => void,
): Promise<T> {
  if (!isCloudEnabled()) {
    throw new Error(
      `AI call "${type}" requires VITE_CLOUD_API_URL to be set at build time. The local job queue was removed in slice 6.`,
    );
  }
  return cloudInvoke<T>(`ai:${type}`, payload);
}
```

To:

```typescript
async function submitAndWait<T = unknown>(
  type: string,
  payload: Record<string, unknown>,
  _onProgress?: (progress: number, log: unknown[]) => void,
): Promise<T> {
  // Cloud path — HTTP POST to the deployed backend
  if (isCloudEnabled()) {
    return cloudInvoke<T>(`ai:${type}`, payload);
  }

  // Local path — IPC to Electron main process (desktop dev mode)
  if (window.electronAPI?.invoke) {
    return window.electronAPI.invoke(`ai:${type}`, payload) as Promise<T>;
  }

  throw new Error(
    `AI call "${type}" has no transport: VITE_CLOUD_API_URL is not set and window.electronAPI is not available. ` +
    `Run with "npm run electron:dev" or set VITE_CLOUD_API_URL.`,
  );
}
```

### 8b. Ensure `window.electronAPI` type exists

Check `frontend/src/types/` for a `global.d.ts` or `electron.d.ts` that declares the type. If missing, create `frontend/src/types/electron.d.ts`:

```typescript
export {};
declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      send: (channel: string, data: unknown) => void;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    };
  }
}
```

### 8c. Also fix `cloudTransport.ts` routing

`isCloudChannel()` at line 120 already returns `false` when cloud is disabled, which is correct. But verify that the non-AI channels (entities, calendar, etc.) that call `cloudInvoke` directly also have IPC fallbacks. If they don't, they'll also break in local dev. Check every call site of `cloudInvoke` and `isCloudChannel` in the renderer codebase and ensure each has a local fallback.

### 8d. Verification

- Run `npm run electron:dev` **without** `VITE_CLOUD_API_URL` set (remove it from the script temporarily)
- Open home chat, type a message — should work via IPC
- Create a goal on Planning page — classify-goal should work via IPC
- Restore the env var in the script when done

---

## Phase 9 — Bug Fix: Home Chat Intent Detection Reliability (MID)

**Problem:** Home chat intent detection (task/event/goal/reminder extraction from user messages) doesn't work reliably. The system prompt (`HOME_CHAT_SYSTEM` in `prompts.ts:474-590`) asks the LLM to return structured JSON with flags like `{ "is_task": true, "task_description": "..." }`, but the LLM often returns plain conversational text instead, or wraps JSON in markdown that `tryExtractJson` can't parse.

Root cause: `home-chat` maps to the `"light"` tier (`model-config.ts:41`), which resolves to `claude-haiku-4-5-20251001`. Haiku is less reliable at following complex structured-output instructions compared to Sonnet.

### 9a. Upgrade home-chat model tier

In `frontend/electron/model-config.ts` (and `backend/src/model-config.ts` if it still exists), change:

```typescript
"home-chat": "light",
```

To:

```typescript
"home-chat": "medium",
```

This switches from Haiku to Sonnet for home chat, which is much more reliable at returning structured JSON. The latency hit (~1-2s extra) is acceptable for a chat interaction.

### 9b. Harden `tryExtractJson()` in `homeChat.ts`

The current `tryExtractJson()` (`homeChat.ts:95-110`) uses regex to find JSON in the response. Make it more robust:

1. First try `JSON.parse(fullResponse)` — handles clean JSON responses
2. Then try extracting from markdown code fences: `` ```json\n{...}\n``` `` and `` ```\n{...}\n``` ``
3. Then try finding the first `{` and last `}` and parsing the substring
4. Add logging (from Phase 7) on every failed parse attempt, including the raw response text so you can debug what the LLM actually returned

```typescript
function tryExtractJson(text: string): Record<string, unknown> | null {
  const log = createLogger("ai:homeChat:json");

  // 1. Clean JSON?
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch { /* not clean JSON */ }

  // 2. Markdown code fence?
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch { /* fence content not valid JSON */ }
  }

  // 3. Greedy brace extraction
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch { /* braces didn't contain valid JSON */ }
  }

  log.warn("Failed to extract JSON from LLM response:", text.slice(0, 500));
  return null;
}
```

### 9c. Add fallback for missing intent flags

In the intent detection chain (`homeChat.ts:298-437`), after checking all intent flags (`is_task`, `is_event`, etc.), if `tryExtractJson` returned `null` but the user's message clearly looks like a task (e.g., starts with "remind me to", "I need to", "add task"), do a simple keyword-based fallback classification. This is a safety net for when the LLM returns plain text.

### 9d. Verification

- Open home chat, type "remind me to buy groceries tomorrow"
- Should detect as a task or reminder and create it (not just respond conversationally)
- Type "I want to learn Spanish by next year"
- Should detect as a goal
- Type "how are my goals going?"
- Should NOT detect any intent — just conversational response
- Check dev console (Phase 7 logging) to see the parsed intent for each message

---

## Phase 10 — Bug Fix: Multi-Line Chat Input (LOW)

**Problem:** All chat inputs use `<input type="text">` which cannot display or accept multi-line text. The `onKeyDown` handler already checks for `Shift+Enter`, but pressing it in an `<input>` does nothing visible because `<input>` doesn't support newlines.

**Affected files:**
- `frontend/src/pages/DashboardPage.tsx:455` — home chat input (`<input ref={inputRef} className="home-input" type="text" ...>`)
- `frontend/src/pages/GoalPlanPage.tsx:985` — goal plan chat input (`<input ref={gpChatInputRef} className="input gp-chat-input" ...>`)
- `frontend/src/pages/PlanningPage.tsx:195` — goal entry input (this one is fine as single-line for goal titles)

### 10a. Replace `<input>` with auto-resizing `<textarea>` for chat inputs

For DashboardPage and GoalPlanPage only (not PlanningPage goal title entry):

1. Change `<input>` to `<textarea>` with `rows={1}`
2. Change ref types from `HTMLInputElement` to `HTMLTextAreaElement`
3. Add auto-resize on input: adjust `textarea.style.height` based on `scrollHeight`
4. Set `max-height` in CSS (e.g., `max-height: 150px; overflow-y: auto`) so it doesn't grow infinitely
5. Ensure `Enter` still sends (without Shift), and `Shift+Enter` inserts a newline

Example for DashboardPage:

```tsx
// Change ref type
const inputRef = useRef<HTMLTextAreaElement>(null);

// Auto-resize handler
const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  setInput(e.target.value);
  const el = e.target;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 150) + "px";
};

// In JSX:
<textarea
  ref={inputRef}
  className="home-input"
  placeholder="Ask anything, add a task, or check your progress..."
  value={input}
  onChange={handleInputChange}
  onKeyDown={(e) => {
    if (e.key === "Enter" && !e.shiftKey && input.trim()) {
      e.preventDefault();
      handleSend();
    }
  }}
  rows={1}
  disabled={isLoading}
/>
```

### 10b. Add CSS for the auto-resize textarea

In the relevant CSS files, add:

```css
.home-input {
  resize: none;
  min-height: 38px;
  max-height: 150px;
  overflow-y: auto;
  line-height: 1.4;
}
```

Do the same for `.gp-chat-input` in GoalPlanPage.

### 10c. Verification

- Open home chat, type a short message — input should look like the old single-line input
- Press Shift+Enter — a new line should appear, and the input should grow taller
- Type 10+ lines — input should stop growing at 150px and show a scrollbar
- Press Enter (without Shift) — message should send and input should shrink back to 1 row

---

## Phase 11 — Bug Fix: Streaming Responses (LOW)

**Problem:** AI responses appear all at once after a long delay. The comment in `ai.ts:47-49` confirms: `"The optional onProgress callback is accepted for source compatibility with the old job-queue API but never fires — phase 1c will add SSE streaming."` Users see a loading spinner for 5-15 seconds, then the full response pops in. This feels broken.

### 11a. Add SSE endpoint on the backend

In `backend/src/routes/ai.ts` (or wherever AI routes are registered), add SSE support:

1. For each `POST /ai/<channel>`, add a corresponding `POST /ai/<channel>/stream` endpoint
2. The stream endpoint sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
3. Instead of returning the full Anthropic response, use the Anthropic streaming API (`client.messages.stream()`) and forward each `content_block_delta` event as an SSE `data:` line
4. Send a final `data: [DONE]` event when the stream completes
5. Include the parsed structured data (intents, etc.) in the final SSE event

### 11b. Add SSE client in `cloudTransport.ts`

Create a `cloudInvokeStream()` function:

```typescript
export async function cloudInvokeStream(
  channel: string,
  payload: unknown,
  onChunk: (text: string) => void,
  onDone: (fullResponse: unknown) => void,
): Promise<void> {
  const url = `${CLOUD_API_URL}${channelToPath(channel)}/stream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify(payload ?? {}),
  });

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "chunk") onChunk(parsed.text);
          if (parsed.type === "done") onDone(parsed.result);
        } catch { onChunk(data); }
      }
    }
  }
}
```

### 11c. Wire `onProgress` in `submitAndWait()`

When a caller passes `onProgress`, use `cloudInvokeStream` instead of `cloudInvoke`. For the local IPC path, Electron can emit progress events via `event.sender.send()` during handler execution.

### 11d. Update chat UIs for streaming display

In DashboardPage and GoalPlanPage, when a message is being streamed:
1. Add the AI message to the chat immediately with empty content
2. Append each chunk to the message content as it arrives
3. Auto-scroll to bottom on each chunk
4. Show a cursor/blinking indicator at the end of the streaming text

### 11e. Verification

- Open home chat, send a message
- Response should appear token-by-token (like ChatGPT/Claude web UI)
- If network fails mid-stream, a clean error should appear (not a hanging spinner)

---

## Phase 12 — Folder Structure Overhaul

**Problem:** The current folder layout is deeply confused about what belongs where. The `frontend/` directory isn't a frontend — it's the entire Electron app (10,600 lines of Node.js main-process code) with a React renderer stapled on. The `backend/` directory is a thin HTTP mirror of the Electron IPC surface. There's no monorepo root, no workspace config, no shared packages.

### Current layout (what's wrong)

```
Future-Planner/
├── .env                              # Root env — but what's it for?
├── README.md
├── frontend/                         # MISLEADING NAME — this is the whole Electron app
│   ├── package.json                  # Has BOTH react AND better-sqlite3/express/anthropic (sqlite should be removed)
│   ├── vite.config.ts
│   ├── index.html                    # Renderer entry
│   ├── src/                          # React renderer (~6,000 lines)
│   │   ├── pages/                    # 11 page components, each 200-1200 lines
│   │   ├── components/               # 8 components
│   │   ├── store/useStore.ts         # 882 lines — one monolith
│   │   ├── services/                 # Cloud transport, AI client, auth
│   │   ├── repositories/             # IPC/HTTP dispatch layer
│   │   └── types/                    # Shared types (also duplicated in backend)
│   ├── electron/                     # Electron main process (~10,600 lines)
│   │   ├── main.ts                   # 254-line bootstrap
│   │   ├── preload.ts                # IPC bridge
│   │   ├── api-server.ts             # 333-line Express server INSIDE Electron (!)
│   │   ├── database.ts → db/         # Full SQLite layer (11 files) — DELETE ALL OF THIS
│   │   ├── ai/                       # 14 AI handlers + prompts + router (~3,500 lines)
│   │   ├── agents/                   # Multi-agent coordinator
│   │   ├── ipc/                      # 13 IPC handler modules
│   │   ├── domain/                   # Cognitive budget calculator
│   │   ├── memory.ts                 # Memory manager
│   │   ├── reflection.ts             # Reflection engine
│   │   ├── reflection-worker.ts      # Background worker thread
│   │   ├── calendar.ts               # macOS calendar integration
│   │   └── model-config.ts           # Model tier mapping (duplicated)
│   ├── dist/                         # Vite build output (renderer)
│   └── dist-electron/                # Electron compiled output (~120 stale hashes)
├── backend/                          # Cloud backend — Fly.io
│   ├── package.json
│   ├── Dockerfile
│   ├── fly.toml
│   └── src/                          # ~7,500 lines, ~60% duplicated from frontend/electron/
│       ├── ai/                       # COPIED from frontend/electron/ai/ (already drifting)
│       ├── routes/                   # Express routes mirroring IPC
│       ├── middleware/               # Auth + error handling + AsyncLocalStorage
│       ├── db/                       # Postgres pool + schema + migrate
│       ├── domain/                   # COPIED cognitiveBudget.ts
│       ├── database.ts               # Stub (returns null — phase 1 incomplete)
│       ├── model-config.ts           # COPIED from frontend/electron/
│       └── memory.ts, reflection.ts  # COPIED from frontend/electron/
```

### Target layout (after all phases)

```
northstar/                            # Renamed from Future-Planner
├── package.json                      # ROOT — pnpm workspaces
├── pnpm-workspace.yaml               # workspace: ["packages/*", "apps/*"]
├── tsconfig.base.json                # Shared compiler options
├── .env.example                      # Documents ALL env vars for all apps
├── README.md
│
├── packages/
│   └── core/                         # @starward/core — shared business logic
│       ├── package.json
│       ├── tsconfig.json             # extends ../../tsconfig.base.json
│       └── src/
│           ├── index.ts              # Barrel export
│           ├── types/                # ALL types (merged from frontend + backend)
│           ├── ai/
│           │   ├── handlers/         # 14 AI handlers (SINGLE SOURCE OF TRUTH)
│           │   ├── client.ts         # Anthropic client factory
│           │   ├── prompts.ts        # All system prompts
│           │   ├── router.ts         # Handler dispatch switch
│           │   ├── sanitize.ts
│           │   └── personalize.ts
│           ├── domain/
│           │   └── cognitiveBudget.ts
│           ├── agents/
│           │   ├── coordinator.ts
│           │   ├── context-evaluator.ts
│           │   └── research-agent.ts
│           └── model-config.ts       # Model tier mapping
│
├── apps/
│   ├── desktop/                      # Electron app (was frontend/)
│   │   ├── package.json              # Deps: @starward/core, react, electron (NO better-sqlite3)
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── electron/                 # Main process (MUCH smaller now)
│   │   │   ├── main.ts              # Bootstrap only — no AI/domain logic, no DB
│   │   │   ├── preload.ts
│   │   │   ├── ipc/                 # Thin IPC handlers → delegate to cloud via HTTP
│   │   │   ├── calendar.ts          # macOS-specific calendar (stays here)
│   │   │   ├── memory.ts            # Local memory manager (delegates to core)
│   │   │   └── reflection-worker.ts # Worker thread (delegates to core)
│   │   └── src/                     # React renderer
│   │       ├── pages/               # Decomposed — each <250 lines
│   │       ├── components/
│   │       ├── hooks/               # NEW: extracted from pages
│   │       ├── store/               # Sliced Zustand — 10 files of ~80 lines
│   │       ├── services/
│   │       ├── repositories/
│   │       └── styles/              # Design tokens + component styles
│   │
│   └── server/                      # Cloud API (was backend/)
│       ├── package.json             # Deps: @starward/core, express, pg
│       ├── Dockerfile               # Same 2-stage build, new paths
│       ├── fly.toml                 # Same Fly.io config
│       └── src/
│           ├── index.ts             # Express bootstrap
│           ├── routes/              # Thin route handlers → delegate to @starward/core
│           ├── middleware/           # Auth + error + requestContext (stays here)
│           └── db/                  # Postgres pool + schema + migrate
```

### 12a. Set up pnpm workspaces

Create root `package.json`:

```json
{
  "name": "northstar",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter @starward/desktop run dev",
    "dev:server": "pnpm --filter @starward/server run dev",
    "build": "pnpm -r run build",
    "typecheck": "pnpm -r run typecheck",
    "test": "pnpm -r run test"
  },
  "packageManager": "pnpm@9.15.0"
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

### 12b. Move and rename directories

```bash
# From the repo root:
mkdir -p packages apps

# Phase 1 already created packages/core/ — it stays

# Rename frontend/ → apps/desktop/
mv frontend apps/desktop

# Rename backend/ → apps/server/
mv backend apps/server

# Update apps/desktop/package.json name to "@starward/desktop"
# Update apps/server/package.json name to "@starward/server"
# Add "@starward/core": "workspace:*" to both dependencies
```

### 12c. Update all import paths

After the move, fix:
1. `apps/server/Dockerfile` — adjust `COPY` paths if the build context changes (or keep `docker build -f apps/server/Dockerfile .` from root)
2. `apps/server/fly.toml` — no path changes needed (Fly reads from cwd)
3. `apps/desktop/vite.config.ts` — `__dirname` still works since the file moved with its directory
4. `.github/` workflows — update any paths referencing `frontend/` or `backend/`
5. Root `.gitignore` — already covers `node_modules/`, `dist/`, etc. with globs

### 12d. Delete dead build artifacts

The `dist-electron/` directory contains ~120 stale hashed build outputs. These are NOT tracked in git (`.gitignore` covers them), but they pollute the workspace tree:

```bash
rm -rf apps/desktop/dist-electron/
rm -rf apps/desktop/dist/
rm -rf apps/desktop/dist-tsnode/
rm -rf apps/server/dist/
```

### 12e. Fly.io deployment updates

The server Dockerfile and fly.toml stay in `apps/server/`. Deployment commands remain the same:

```bash
cd apps/server
fly deploy
fly secrets set DATABASE_URL=... ANTHROPIC_API_KEY=... DEV_USER_ID=sophie
```

But the Dockerfile needs to be aware of the monorepo structure if `@starward/core` is a workspace dependency. Two options:

**Option A (recommended for now):** Make `@starward/core` a pre-built package. Add a `"prepack"` script to `packages/core/` that compiles TS → JS. The `apps/server/` Dockerfile copies the compiled core into `node_modules/` during build.

**Option B (better long-term):** Use a Dockerfile at the repo root that copies the full monorepo, runs `pnpm install --frozen-lockfile`, builds all packages, then copies only `apps/server/dist` + `node_modules` into the runtime stage. Update `fly.toml` to set the build context to the repo root:

```toml
[build]
  dockerfile = "apps/server/Dockerfile"
  # If using repo root as context:
  # dockerfile = "Dockerfile.server"
```

### 12f. Verification

- `pnpm install` from root succeeds
- `pnpm typecheck` passes for all three packages
- `pnpm dev` starts the Electron app (with local IPC)
- `pnpm dev:server` starts the Express server
- `cd apps/server && fly deploy` deploys successfully
- The Electron app can talk to `https://starward-api.fly.dev` when `VITE_CLOUD_API_URL` is set

---

## Phase 13 — Remove SQLite & JSON Fallback (Cloud-Only Data)

**Problem:** The Electron main process has an entire SQLite database layer (`frontend/electron/db/` — 11 files, ~1,023 lines) plus a JSON file fallback (`northstar-data.json`). This is redundant because Supabase Postgres (via the Fly.io backend) is the single source of truth. The SQLite layer:
- Duplicates the Postgres schema
- Creates a sync problem (which copy is authoritative?)
- Adds `better-sqlite3` as a native dependency — causing painful `@electron/rebuild` issues on every install
- Makes the `.dmg`/`.exe` larger than necessary

**Decision:** Supabase Postgres is the only database. The desktop app is a thin client — all data reads/writes go through the cloud backend via HTTP. No local database of any kind.

### 13a. Route ALL IPC handlers through the cloud backend

Currently `frontend/src/repositories/index.ts` has the `invoke()` helper that checks `isCloudChannel()`. After this phase, ALL channels are cloud channels. The `invoke()` function should always call `cloudInvoke()`:

```typescript
// Before:
async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  if (isCloudChannel(channel)) {
    return cloudInvoke<T>(channel, payload);
  }
  return (await window.electronAPI.invoke(channel, payload)) as T;
}

// After:
async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return cloudInvoke<T>(channel, payload);
}
```

Remove the `CLOUD_CHANNELS` set from `cloudTransport.ts` — it's no longer needed since everything goes to cloud. `isCloudEnabled()` should always return true (or just remove the check — `VITE_CLOUD_API_URL` is always required now).

### 13b. Delete the entire SQLite layer

Delete these files entirely:
- `frontend/electron/db/connection.ts` (61 lines — SQLite singleton)
- `frontend/electron/db/helpers.ts` (49 lines — generic CRUD wrappers)
- `frontend/electron/db/migrations.ts` (157 lines — SQLite schema)
- `frontend/electron/db/appStore.ts` (37 lines — key-value store)
- `frontend/electron/db/calendar.ts` (105 lines — calendar events)
- `frontend/electron/db/chat.ts` (109 lines — chat sessions)
- `frontend/electron/db/memory.ts` (207 lines — memory facts/prefs/signals)
- `frontend/electron/db/monthlyContext.ts` (63 lines)
- `frontend/electron/db/reminders.ts` (73 lines)
- `frontend/electron/db/semanticSearch.ts` (163 lines — local cosine similarity)
- `frontend/electron/database.ts` (17 lines — barrel re-export)
- `frontend/electron/db/README.md`

**Total deleted: ~1,040 lines**

### 13c. Delete JSON file fallback from `main.ts`

In `frontend/electron/main.ts`, delete:
- The `dataFilePath` constant (line 68)
- `loadDataFromJSON()` function (lines 72-81)
- `saveDataToJSON()` function (lines 83-91)
- The SQLite init block in `app.whenReady()` (lines 175-198: `testConnection`, `runMigrations`, `ensureVectorColumn`, `backfillPreferenceEmbeddings`)
- The `_dbAvailable` flag and all references to it
- All imports from `./database`

The `loadData()` / `saveData()` / `loadDataSync()` functions should now call the cloud backend via HTTP (through the same `cloudInvoke` path the renderer uses).

### 13d. Remove `better-sqlite3` from dependencies

In `frontend/package.json`:
- Remove `"better-sqlite3"` from dependencies
- Remove `"@types/better-sqlite3"` from devDependencies
- Remove `"@electron/rebuild"` from devDependencies (it was only needed for native SQLite bindings)
- Remove the `better-sqlite3` entries from the `electron-builder` config `files` array (lines 63-66)

### 13e. Update the reflection worker

`frontend/electron/reflection-worker.ts` and `reflection.ts` currently write memory facts/preferences directly to SQLite via `memory.ts → db/memory.ts`. After removing SQLite:
- The reflection worker should call the cloud backend's memory endpoints (`POST /memory/signal`, `POST /memory/reflect`, etc.) via HTTP instead of writing to SQLite
- Or: move reflection entirely to the server side (better long-term — the server can run reflections on a schedule without the desktop app being open)

### 13f. Update the memory manager

`frontend/electron/memory.ts` (the in-memory `MemoryManager` class) currently loads from SQLite on startup. After this phase:
- It should load from the cloud backend (`GET /memory/load`)
- It should save to the cloud backend (`POST /memory/signal`, etc.)
- Consider whether the in-process `MemoryManager` cache is still needed, or if the server should be the sole owner of memory state

### 13g. Ensure `VITE_CLOUD_API_URL` is always required

Update the `electron:dev` script comment and the README to make it clear that `VITE_CLOUD_API_URL` is **mandatory**, not optional. The app cannot function without the cloud backend.

Update `.env.example` at the project root:
```bash
# REQUIRED — the app talks to this backend for all data + AI
VITE_CLOUD_API_URL=https://starward-api.fly.dev
```

### 13h. Verification

- Remove `~/.config/Starward/northstar.db` and `northstar-data.json` from the dev data directory
- Start the Electron app — it should boot with no errors (no SQLite)
- All data loads from Supabase Postgres via the Fly.io backend
- Creating a goal, adding a task, chatting — all data persists in Postgres
- Kill and restart the app — all data is still there (came from cloud)
- `npm ls better-sqlite3` returns empty (dependency removed)

---

## Summary of what gets deleted/moved

| Action | Files | Lines saved |
|--------|-------|-------------|
| Move to `@starward/core` | 14 handlers + prompts + sanitize + personalize + model-config + cognitiveBudget + contextEvaluator | — |
| Delete backend duplicates | `backend/src/ai/handlers/*`, `backend/src/ai/prompts.ts`, `backend/src/ai/sanitize.ts`, `backend/src/ai/personalize.ts`, `backend/src/model-config.ts`, `backend/src/domain/cognitiveBudget.ts`, `backend/src/database.ts` | ~2,000 lines |
| Delete frontend duplicates (now in core) | `frontend/electron/ai/handlers/*`, `frontend/electron/ai/prompts.ts`, etc. | ~1,700 lines |
| Delete api-server.ts | `frontend/electron/api-server.ts` | 333 lines |
| Delete entire SQLite layer | `frontend/electron/db/*`, `frontend/electron/database.ts`, JSON fallback in `main.ts`, `better-sqlite3` dep | ~1,040 lines |
| Split useStore.ts | 883 lines → 10 files of ~80 lines each | net zero but massive readability gain |
| Decompose pages | 4 pages from ~3,800 lines total to ~800 lines + hooks/components | net ~+500 but each file <250 lines |
| Restructure folders | `frontend/` → `apps/desktop/`, `backend/` → `apps/server/`, new `packages/core/` + pnpm workspaces | net zero but sane project navigation |

**Total lines of dead code eliminated: ~5,000+**

## Bug fixes summary

| # | Priority | Bug | Root Cause | Key Files |
|---|----------|-----|------------|-----------|
| 7 | HIGH | No logging/debug output | Zero `console.log` or structured logging anywhere | New `logger.ts` + all AI service files |
| 8 | MID | All AI fails without `VITE_CLOUD_API_URL` | `submitAndWait()` throws instead of falling back to IPC | `ai.ts:56-59`, `cloudTransport.ts`, `preload.ts` |
| 9 | MID | Home chat intent detection unreliable | Haiku model + fragile JSON parsing | `model-config.ts:41`, `homeChat.ts:95-110` |
| 10 | LOW | Chat inputs can't do multi-line | `<input type="text">` used instead of `<textarea>` | `DashboardPage.tsx:455`, `GoalPlanPage.tsx:985` |
| 11 | LOW | Responses appear all at once | No SSE streaming — one-shot HTTP POST | `ai.ts:47-49`, `cloudTransport.ts` |

## New features summary

| # | Feature | What it does | Key Files |
|---|---------|-------------|-----------|
| 13 | Remove SQLite | Delete entire local DB layer, make Supabase Postgres the only database, remove `better-sqlite3` dependency | `electron/db/*` (delete), `main.ts`, `repositories/index.ts`, `cloudTransport.ts` |
| 14 | Task Watcher | Server-side background worker that polls every 30m, uses AI to evaluate task risk, sends push notifications | New `watcher/` module in server, `notifications` Postgres table, notification UI |

## Order of operations

1. **Phase 12 (folder restructure)** — do this FIRST so all subsequent phases use the correct paths (`apps/desktop/`, `apps/server/`, `packages/core/`). The pnpm workspace setup also unblocks Phase 1.
2. Phase 1 (core package) — highest-value change, eliminates all duplication
3. Phase 2 (delete api-server) — quick win, 5 minutes
4. **Phase 13 (remove SQLite)** — do right after Phase 2. Once the core package exists and api-server is deleted, rip out the SQLite layer and make everything cloud-only. This massively simplifies the Electron main process.
5. Phase 3 (typed payloads) — do while you're already touching every handler
6. **Phase 7 (logging)** — do early so all subsequent work benefits from debug output
7. **Phase 8 (local dev fallback)** — NOTE: with Phase 13 done, this phase changes meaning. The "fallback" is no longer IPC→SQLite but rather ensuring the cloud URL is always configured. May simplify to just good error messages.
8. Phase 4 (store slices) — independent of phases 1-3
9. Phase 5 (page decomposition) — independent, can be done page by page
10. **Phase 9 (intent detection)** — do after Phase 7 (logging helps debug this) and Phase 1 (handler lives in core)
11. **Phase 10 (multi-line input)** — do during Phase 5 since you're already touching the components
12. Phase 6 (tests) — test the final architecture
13. **Phase 11 (streaming)** — complex, depends on the transport layer being stable
14. **Phase 14 (task watcher)** — do last. Requires Phase 13 (cloud-only data) and Phase 7 (logging). This is a new feature, not a fix — everything else should be stable first.

After each phase, run `pnpm typecheck` from the root to verify no type errors across all packages. Launch the Electron app and verify the core flows work: onboarding, goal creation, daily task generation, home chat. For cloud changes, verify `fly deploy` succeeds and the deployed API responds at `https://starward-api.fly.dev/health`.

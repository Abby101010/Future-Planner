# backend/src/ai/handlers/

One file per AI task. Each exports a function with the shape:

```ts
async function handle<Task>(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string,
): Promise<...>
```

## Handler index

| File | What it does |
|---|---|
| `onboarding.ts` | First-launch interview flow — gathers goals, context, preferences |
| `classifyGoal.ts` | Decides if a goal is "big" (multi-month roadmap) or "small" (today-actionable), suggests scope/importance |
| `goalBreakdown.ts` | One-shot decomposition of a big goal into milestones |
| `generateGoalPlan.ts` | Full hierarchical plan (years → months → weeks → days) for a big goal — the heaviest single AI call in the app |
| `goalPlanChat.ts` | Conversational refinement of an existing goal plan |
| `goalPlanEdit.ts` | Apply a structured edit to an existing goal plan |
| `dailyTasks.ts` | Suggests today's task list given goals + memory + cognitive budget |
| `homeChat.ts` | The dashboard chat box. Detects intents (event/goal/reminder/task/manage-goal/context-change) and returns a structured payload alongside the reply |
| `analyzeQuickTask.ts` | Triage a free-text task description into duration, weight, category |
| `analyzeMonthlyContext.ts` | Decides intensity / capacity multiplier / max-daily-tasks for a month |
| `recovery.ts` | Handles "I'm stuck" / blocker reports — proposes a recovery action and writes a `blocker_reported` + `recovery_triggered` signal pair |
| `paceCheck.ts` | Weekly pace check-in. Triggers `runReflection("weekly_pace_check")` |
| `reallocate.ts` | Shifts tasks in a goal plan when the user is falling behind |

## Conventions

- **Always use `getModelForTask("<task>")` from `model-config.ts`** — never
  hardcode a model ID. This honors per-user tier overrides.
- **Inject memory via `personalizeSystem(prompt, memoryContext)`** — keeps
  the prompt constants in `prompts.ts` user-agnostic.
- **Parse JSON tolerantly** — Haiku occasionally appends commentary after
  the JSON object. Use the first-`{` to last-`}` slice pattern from
  `homeChat.ts` and `reflection.ts`.
- **Don't call `Anthropic` directly** — always go through the `client`
  parameter so tests can swap in a fake.

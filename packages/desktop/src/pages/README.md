# desktop/src/pages/

One file per top-level screen. Pages are the orchestrators — they run
`useQuery` for reads, `useCommand` for writes, and compose components
to render the result.

## Pages

| File | Screen |
|---|---|
| `WelcomePage.tsx` | First launch — language picker + "get started" |
| `OnboardingPage.tsx` | The interview flow that seeds memory + first goals |
| `DashboardPage.tsx` | The main "today" screen — tasks, calendar, home chat |
| `RoadmapPage.tsx` | Long-horizon view across all big goals |
| `CalendarPage.tsx` | Month/week calendar with in-app events + device calendar import |
| `TasksPage.tsx` | All tasks across goals with filters |
| `NewsFeedPage.tsx` | AI-generated daily briefing |
| `PlanningPage.tsx` | Standalone planning chat |
| `GoalPlanPage.tsx` | Per-goal hierarchical timeline with AI plan generation and reallocation |
| `SettingsPage.tsx` | Preferences, model tier overrides, memory inspector |

## The one rule

**Pages read via `useQuery("view:*")` and mutate via
`useCommand().run("command:*")`.** Any other way of reaching the
server (direct `fetch`, `cloudTransport.cloudInvoke`, a repository
call) is technical debt to be migrated, not a template to copy.

## What NOT to put here

- Components that are reused on more than one page — lift them into
  `../components/`.
- Pure data transformations — put them in `../lib/` and unit-test them.
- Persistent state — it belongs on the server (add a view field) or
  in `../store/useStore.ts` (only if it's ephemeral UI state).

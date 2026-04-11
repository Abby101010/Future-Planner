# frontend/src/pages/

One file per top-level screen. Pages are the only React components that
consume `useStore` directly for navigation-level state and orchestrate
calls to `services/` and `repositories/`.

## Pages

| File | Screen |
|---|---|
| `WelcomePage.tsx` | First launch — language picker + "get started" |
| `OnboardingPage.tsx` | The interview flow that seeds memory + first goals |
| `DashboardPage.tsx` | The main "today" screen — tasks, calendar, home chat |
| `RoadmapPage.tsx` | Long-horizon view across all big goals |
| `CalendarPage.tsx` | Month/week calendar with in-app events + macOS Calendar import |
| `TasksPage.tsx` | All tasks across goals with filters |
| `NewsFeedPage.tsx` | AI-generated daily briefing |
| `PlanningPage.tsx` | Standalone planning chat (separate from goal-specific planning) |
| `GoalPlanPage.tsx` | Per-goal hierarchical timeline (years → months → weeks → days) with AI plan generation and reallocation |
| `SettingsPage.tsx` | Preferences, model tier overrides, memory inspector |

## Conventions

- **Pages own loading + error UI.** Don't bubble exceptions up — catch and
  surface them with `setError(...)` so the user sees what went wrong.
- **Pages are the only place that calls AI service wrappers.** Components
  receive results as props.
- **Heavy AI calls (`generateGoalPlan`, `reallocate`) should show
  `<AgentProgress />`** for the duration. The cloud round-trip can take
  10-30 seconds.
- **Every page handles language switching.** Use `useT()` from `../i18n`
  for any user-visible string.

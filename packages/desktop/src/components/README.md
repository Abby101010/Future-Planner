# frontend/src/components/

Reusable React components shared across pages. If a component is used by
exactly one page, it can live alongside that page instead — this dir is
for things that show up in two or more places, or that encapsulate a
reusable interaction pattern.

## Highlights

- **`Sidebar.tsx`** — left-rail navigation
- **`Heatmap.tsx`** — GitHub-style activity grid
- **`MoodLogger.tsx`** — quick daily mood capture
- **`RecoveryModal.tsx`** — the "I'm stuck" / blocker flow that triggers
  the recovery AI handler
- **`AgentProgress.tsx`** — live progress display for long-running AI
  tasks (goal plan generation, reallocation)
- **`MonthlyContext.tsx`** — monthly intensity / capacity editor
- **`RichTextToolbar.tsx`** + **`IconPicker.tsx`** — shared editor UI
  used by goal description fields

## Conventions

- **Components don't call services or repositories directly.** Pages do
  the I/O and pass the result as props. This keeps components pure and
  testable, and avoids accidental network calls from re-renders.
- **Style with CSS modules or co-located `.css` files**, not inline
  style props (for anything beyond a one-off override).
- **Localize user-facing strings via `useT()`** — never hardcode English
  in a component.

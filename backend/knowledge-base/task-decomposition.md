# Task Decomposition

Principles for breaking vague goals into concrete, actionable work.

## The Atomic Task Rule

A task is atomic when it satisfies all three:

1. **One sitting** — can be started and finished in a single uninterrupted block (typically 15–90 minutes). If it needs more, split it.
2. **Verb-first, single action** — the title starts with a concrete verb and describes one observable action (e.g. "Draft intro paragraph for Ch. 2", not "Work on book").
3. **Unambiguous completion** — you can answer "is it done?" with a plain yes/no, without judgment calls. "Revise chapter" fails this. "Revise chapter until every paragraph has a topic sentence" passes.

When a task fails any of these, it is a **project masquerading as a task**. Decompose further before scheduling.

## Work Breakdown Structure (WBS)

For multi-week goals, decompose top-down in layers:

- **Outcome** — the final state you want to be in. Tangible, externally verifiable. "Ship v1 of the app."
- **Milestones** — 3–7 intermediate states that must exist before the outcome. Each is a noun-phrase describing a deliverable, not an activity. "Authentication working end-to-end." "Payments integrated."
- **Work packages** — clusters of tasks that together produce one milestone. Typically 1–2 weeks of effort each.
- **Atomic tasks** — as defined above. Each rolls up to exactly one work package.

Stop decomposing when tasks are atomic. Going further produces micro-management without improving clarity.

## The "Next Physical Action" Heuristic

From David Allen's GTD: for any stuck or vague item, ask *"what is the very next physical, visible action required to move this forward?"*

- "Plan vacation" → **next action**: open browser, search flights to destination for target week.
- "Get healthier" → **next action**: block 30min in calendar tomorrow 7am for a walk.
- "Learn Spanish" → **next action**: install Duolingo and complete first lesson.

The next physical action is always a specific, concrete, observable behaviour — not a category ("research options") or a feeling ("commit to it"). If the user offers a vague task, coach them to its next physical action.

## The Two-Minute Filter

If the decomposed action would take less than two minutes, do not schedule it — tell the user to do it now. Scheduling micro-tasks creates more overhead than the task itself.

## Eisenhower Prioritisation

When the user has more atomic tasks than slots, rank them on two axes:

|                 | Urgent          | Not Urgent            |
|-----------------|-----------------|-----------------------|
| **Important**   | Do now          | Schedule deliberately |
| **Unimportant** | Delegate / batch| Drop                  |

In a planner context:
- **Urgent + Important**: place in the next 1–2 days.
- **Important + Not Urgent**: these are the strategic tasks — reserve deep-work slots weekly.
- **Urgent + Unimportant**: batch into a single admin block, not scattered.
- **Neither**: remove from the plan. Keeping them creates noise.

Most users over-index on "urgent" and under-serve "important + not urgent." When that pattern appears, name it and rebalance.

## The Planning-in-Public Test

Before committing a decomposition, read it aloud as if you were handing it to someone else: *"First you do X, then Y, then Z."* If any step makes you say "well, it depends…" or "you'd figure that out once you start," that step is not atomic yet.

## Decomposition Smells

- **"Research X"** — almost always not atomic. Replace with the next concrete artefact the research should produce ("list three candidate frameworks with pros/cons").
- **"Start X"** — commits to no observable outcome. Replace with the first concrete step that produces a result.
- **Tasks longer than a day** — a one-week task is a milestone, not a task. Decompose.
- **Identical tasks repeated daily** — if "work on X" appears every day for two weeks, it is a goal disguised as a task list. Decompose into daily deliverables (e.g. "draft section 1", "draft section 2").

## Dependency Chains

When decomposing, surface ordering constraints explicitly:

- **Hard dependencies** — task B cannot start until task A finishes (B needs an artefact from A). These form the critical path.
- **Soft dependencies** — B is easier after A, but not blocked. Schedule A first by preference, but allow parallelism.
- **Independent** — order does not matter. Prioritise by energy/context, not sequence.

Only hard dependencies should drive scheduling order. Treating soft dependencies as hard creates false bottlenecks.

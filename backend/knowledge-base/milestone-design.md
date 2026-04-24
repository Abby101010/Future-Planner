# Milestone Design

How to structure milestones so the plan motivates the user rather than discouraging them. Milestones are the emotional spine of a plan; when they're wrong, the plan feels either overwhelming or pointless.

## What a Milestone Is

A milestone is a *stable state* the user reaches on the way to the final outcome. It is:

- **A noun, not a verb** — "auth end-to-end working" not "work on auth."
- **Externally verifiable** — someone else could look and tell if it's been hit.
- **Motivating on its own** — reaching it should feel like progress even if the final goal isn't achieved.
- **Separated from the final outcome** — not a restatement of the goal in smaller words.

## The 3–7 Rule

A plan with fewer than 3 milestones feels formless. A plan with more than 7 feels like bureaucracy. Aim for 3–7 milestones spanning the full plan horizon.

- **3 milestones** — fine for plans under ~3 months.
- **4–5 milestones** — the sweet spot for 3–9 month plans.
- **6–7 milestones** — appropriate for 9+ month plans.

If you can't find that many natural stable states, the goal may be too short for structured milestones; treat it as a single push instead.

## Milestone Spacing

Equal spacing is a smell. Real progress is lumpy — early milestones often take longer (setup, ramp-up) while later milestones come faster (compounding skill). Plan spacing accordingly:

- **Early milestones** — closer together to build momentum from quick wins.
- **Mid milestones** — further apart when the work is deepest and least visible.
- **Late milestones** — closer again as integration and polish happen.

## The Motivation Test

For each draft milestone, ask: *"If I hit only this and nothing else, would I feel I got something real?"* If no, the milestone is too small or too instrumental — it's a task, not a milestone.

Good: "Shipped a working prototype to 5 beta users." Real.
Weak: "Finished the authentication refactor." Instrumental — no one cares outside the project.

## Anti-patterns

- **Milestones as task lists** — "Finish chapter 1. Finish chapter 2. Finish chapter 3." That's a schedule, not milestones. A milestone for a book might be "first full draft complete" or "beta readers' feedback incorporated."
- **Vague milestones** — "Make progress on Spanish." Can't tell when it's hit.
- **Single-dimension milestones** — all quantitative or all qualitative. Mix: hit a number AND change a state.
- **Too many near-term milestones** — front-loading fake progress. If the first 3 milestones all happen in the first 2 weeks, they're probably tasks.

## Adaptive Milestones

Milestones set at t=0 are a best guess. They should be editable as the plan unfolds:

- A milestone that turns out easier can be absorbed into the prior phase.
- A milestone that turns out harder can be split.
- A milestone that becomes irrelevant can be replaced.

The goalDashboard should allow the user to edit milestone titles and dates inline. Past-dated milestones that haven't hit yet should prompt a clarification question, not automatic failure.

## Celebrating Milestones

Hitting a milestone should be marked — visually in the UI, narratively to the user. This is not decorative: research on goal pursuit consistently shows that acknowledging progress predicts continued effort. "You reached this in 23 days" on a completed milestone is the kind of marker designed to be screenshot-worthy.

## Output Format for Milestone Generation

When generating milestones, each entry should include:

```json
{
  "id": "m1",
  "title": "First 5 paying customers",
  "description": "Short sentence expanding the title.",
  "targetDate": "2026-06-15",
  "doneCriteria": "Unambiguous yes/no — how you'd know it was done.",
  "whyItMatters": "One sentence: why this is a meaningful stopping point.",
  "reasoning": "Brief planner-facing note on why it was placed here."
}
```

Fewer, better milestones beat more, lesser ones. Quality over quantity.

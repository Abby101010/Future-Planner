# Time Estimation

Principles for predicting how long tasks actually take — not how long they feel like they should take.

## The Planning Fallacy

Named by Kahneman & Tversky: people systematically underestimate the time, cost, and risk of their own plans, while being reasonably accurate about *other* people's plans. The bias persists even when the person has extensive personal history of missing estimates on similar tasks.

Two core drivers:
1. **Inside view** — imagining the task going well, step by step, through rose-tinted defaults.
2. **Ignoring base rates** — failing to consult how long *past similar tasks* actually took.

Counter-mechanism: force an **outside view**. Before committing to an estimate, ask *"how long did the last three tasks like this actually take?"* Use that distribution, not the imagined happy-path walkthrough.

## Hofstadter's Law

*"It always takes longer than you expect, even when you take into account Hofstadter's Law."*

Practical implication: the first layer of buffer is mandatory, and it is still not enough. When decomposing a multi-step plan, do not add a single flat buffer at the end — distribute it:
- **Per-task buffer**: 25–50% over the raw estimate.
- **Critical-path buffer**: add another 20–30% at the milestone level, not the task level (this absorbs inter-task friction, context switching, and surprises that span tasks).
- **Project-level slack**: for multi-week plans, leave entire unstructured days in the schedule. They will not stay empty.

## Reference-Class Forecasting

Due to Flyvbjerg et al. — the gold-standard de-biasing technique:

1. Identify the **reference class** — past tasks or projects most similar to the current one along relevant axes (scope, tech, collaborators, user's own energy state).
2. Pull the **actual outcome distribution** of that class — mean, variance, worst-case.
3. Adjust the current forecast toward the class distribution, not away from it.

In the NorthStar context: when the user has memory of past durations on similar tasks, trust those actuals over the user's present intuition. Say so explicitly: *"last three times you did a comparable task it took 3–4 hours — your 90-minute estimate is probably optimistic."*

## The Three-Point Estimate (PERT)

For any non-trivial task, solicit three durations:
- **O** (optimistic) — everything goes smoothly, no interruptions.
- **M** (most likely) — the realistic middle scenario.
- **P** (pessimistic) — the bad-but-not-catastrophic case (not absolute worst).

Expected duration ≈ **(O + 4M + P) / 6**. Use this, not M alone, when scheduling.

The spread (P − O) is itself a signal: wide spreads mean high uncertainty, which should prompt either (a) a spike task to reduce uncertainty first, or (b) explicit risk flagging in the plan.

## Buffer Rules of Thumb

- **Familiar task in familiar context**: +25% buffer.
- **Familiar task in new context (new tools, new collaborators)**: +50%.
- **New task type entirely**: +100% and a willingness to revise after the first attempt.
- **Tasks with external dependencies** (waiting on review, external API, another person): do not estimate duration — estimate *elapsed calendar time* instead, which may be 5–10× the hands-on time.

## Energy-Weighted Scheduling

Raw minutes are not the whole estimate. A 60-minute analytical task costs more "capacity" than a 60-minute admin task. When the user has given you signals about their energy patterns (morning deep-work, afternoon slumps, post-meeting depletion):

- Place the highest-cognitive-load task of the day in their peak-energy window.
- Do not schedule two deep-work tasks back-to-back without a genuine break.
- Admin, errands, and routine tasks can fill low-energy windows productively.

A plan that is theoretically feasible in minutes but places two deep-work blocks in an evening slump will fail. The estimate was correct; the *placement* was wrong.

## Catching Over-Commitment

Signs a proposed schedule is over-committed:
- Total scheduled task time exceeds 60–70% of the available window. The rest is overhead (transitions, meals, unexpected interrupts).
- More than one "deep work" block per day for most users.
- Back-to-back tasks with no declared break.
- The plan has no slack for a single unexpected 30-minute interruption.

When any of these trip, flag it and rebalance before the user commits.

## Feedback Loops

Estimation is a skill that improves only with calibration:
- After a task completes, compare actual vs. estimate. If the user's memory has recorded this, lean on it.
- A persistent 2× underestimate is a system, not noise — apply a correction factor for that user on similar future tasks.
- Celebrate *accurate* estimates, not fast ones. "You finished in 90 minutes as estimated" is a bigger win than "you finished in 45 when you thought it would take 90" — the second suggests the estimate was wrong, not that the user is a superhero.

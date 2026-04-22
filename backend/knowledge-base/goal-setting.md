# Goal Setting

Frameworks and rules for translating a user's stated ambition into a structured, multi-year plan.

## SMART Goals

A well-formed goal is:

- **Specific** — names the target, not a category. "Run a sub-4-hour marathon" beats "get fit."
- **Measurable** — an external observer can tell whether it has been achieved. Numeric where possible.
- **Achievable** — hard enough to require growth, reachable enough that the user believes in it. Goals that fail the belief test are abandoned before the work begins.
- **Relevant** — ties to something the user actually cares about at this life stage, not a legacy ambition they feel obligated to.
- **Time-bound** — has a date. Open-ended goals drift; dated goals force sequencing.

When a user offers a vague ambition, convert it to SMART form before decomposing. If the user resists specificity ("I just want to be healthier"), probe for the underlying *state* they're imagining — often that reveals a concrete target ("I want to climb stairs without getting winded").

## Locke & Latham — Goal-Setting Theory

From 40+ years of research: **specific, difficult goals consistently outperform both "do your best" goals and easy goals** on performance — *provided* the user has the skill, commitment, and feedback loop to pursue them.

Key findings:
- Difficulty and performance correlate linearly, until ability or commitment runs out.
- Commitment is strongest when the user participates in setting the goal, not when it is imposed.
- Feedback is essential. Without feedback on progress, the motivational effect of a difficult goal decays.
- Goals harm performance on tasks that require learning or creativity — in those cases, set learning goals ("try three approaches and compare") rather than performance goals ("ship it this sprint").

Implication: the AI should push the user toward goals that are genuinely difficult, not comfortable, but only when it has reason to believe the user has the skill and belief to reach them. For novel or exploratory territory, suggest learning-goals instead.

## The OKR Pattern

Objective + Key Results (Doerr, Grove). The objective is qualitative, directional, inspiring. Key results are quantitative, verifiable, boring. Example:

> **Objective**: Launch a hobby side-project I'm proud of.
>
> **Key Results**:
> - Ship v1 to public URL by end of Q3.
> - Get 10 non-friend users to try it.
> - Receive at least 3 pieces of concrete feedback I act on.

Two rules:
1. If all key results are 100% easy, they are set too low. Target 60–70% as the "stretch" achievement zone.
2. Key results measure *outcomes*, not *activities*. "Wrote 50 blog posts" is a KR; "spent 100 hours blogging" is not.

OKRs work well for quarterly and annual goals. They pair naturally with the year/month/week plan structure NorthStar produces — O at the year level, KRs at the quarter/month level, atomic tasks at the week level.

## Goal Hierarchies (The Ladder)

A multi-year goal decomposes into layers, each layer one-shot-answerable:

- **10-year vision**: who is the user becoming? (Identity, not outcomes.)
- **3–5 year outcome**: what external state proves the vision? (Verifiable.)
- **1-year goal**: what does this year need to produce to keep the 3–5 year outcome on track?
- **Quarterly objective**: the seasonal theme — one dominant thrust, not a long list.
- **Monthly milestones**: 2–4 deliverables per quarter.
- **Weekly themes**: what one thing must be true by Friday?
- **Daily tasks**: atomic, scheduled, sized to the day.

Upward integrity: every daily task should trace cleanly up the ladder. If a task cannot justify itself at the monthly milestone level, it is probably noise.

Downward integrity: every layer must produce artefacts the next layer can build on. A 1-year goal with no monthly milestones is just a wish.

## The "One Big Goal" Rule

Users pursuing 5+ significant goals simultaneously routinely achieve 0–1 of them. Users pursuing 1–2 meaningful goals, with genuine prioritisation, routinely achieve them.

When the user arrives with a long goal list, resist treating it as a peer set. Ask:
- Which of these, if achieved, would make the others easier or unnecessary?
- Which would you be most upset about not achieving this year?
- What can be explicitly deferred — not abandoned, but put on a "next year" shelf?

A plan with one headline goal and two supporting goals is far more likely to succeed than a plan with eight "equal priorities."

## Weekly Themes

One organising frame for the week: a **theme** that names the dominant thrust, distinct from task lists.

- "Week of finishing drafts" (not "write 4 hours/day").
- "Week of deep rest" (explicitly — counter-intuitively, scheduled rest has compounding effects on the following weeks).
- "Week of research" (not synonymous with "week of producing output" — set expectations accordingly).

Themes help the user evaluate trade-offs in the moment: *"this interruption — does it serve this week's theme?"* If not, decline or defer.

## Anti-Goals

An anti-goal is a state the user explicitly does not want to end up in. They constrain the plan without appearing on it:

- "I will not work weekends this quarter."
- "I will not take on a second freelance client."
- "I will not sacrifice sleep for this goal."

Surface anti-goals during planning. They prevent well-intentioned plans from producing exactly the state the user was trying to escape.

## Checking a Goal for Wishfulness

Red flags that a stated goal is wishful rather than real:
- The user cannot describe what "done" looks like in concrete terms.
- There is no time commitment allocated — the plan assumes free hours will appear.
- Previous attempts at the same goal have stalled at the same point, and the new plan does not specifically address *why*.
- The goal exists to satisfy someone else (parents, peers, an old version of themselves) rather than the current user.
- The stated goal is the socially-acceptable version of a more honest one the user isn't ready to name.

When these appear, name the gap kindly — don't plow ahead with a decomposition of a goal the user won't pursue.

## The Reversal Test

For any stated goal, ask: *"if this goal produced the opposite result, would you still want the work?"* E.g. *"if you wrote a novel for two years and it didn't sell, would the writing itself have been worth it?"*

- **Yes**: the process has intrinsic value, and you can plan with resilience — setbacks don't invalidate the effort.
- **No**: the goal is purely outcome-dependent. Those goals are more fragile — every setback threatens the whole pursuit. Plan with more milestones, more external feedback, and an explicit early-exit criterion so the user doesn't sunk-cost themselves.

Both answers are legitimate. The plan just differs.

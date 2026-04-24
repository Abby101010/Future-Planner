# Clarification Patterns

Guidance for the goalClarifier agent: how to ask questions that actually produce a plannable goal, not questions that sound thorough but don't reduce uncertainty.

## The Goal of Clarification

A vague goal is a wish. A clarified goal has enough structure that a reasonable planner could build a roadmap without having to make up load-bearing assumptions. The job of clarification is to remove the degrees of freedom that matter most for planning — not every degree of freedom.

Stop asking when the next question's answer wouldn't change the plan.

## What to Ask About, Ordered by Decreasing Leverage

1. **Concrete outcome** — what would exist in the world, measurably, when it's done? Convert "get healthier" into "run a 5k without stopping" or "lose 20 lbs."
2. **Deadline** — hard date vs. soft date vs. open-ended. Changes the entire planning shape.
3. **Current state** — how far from the outcome today? Novice / rusty / advanced? Beginning / middle / end?
4. **Constraints** — time available per week, money, geography, health, obligations, past attempts that failed.
5. **Success criteria** — how will they (and you) know it landed? What does "done" look like, unambiguously?
6. **Motivation** — why this goal now? Intrinsic (curiosity, meaning) vs. extrinsic (deadline, pressure). Affects adherence strategies.

## Anti-patterns in Clarification

- **The interrogation** — 12 questions in a row. Ask 3–6; let the user feel heard between questions.
- **The survey** — generic checkboxes like "budget? timeline? scope?" without adapting to what the user said. The user can tell you're not listening.
- **The therapist** — probing feelings instead of planning specifics. Relevant sometimes; usually not what's needed.
- **Premature specificity** — asking "what time of day do you prefer" before knowing what the goal even is.

## Question Quality Heuristic

Before asking a question, ask: *"If they answer this, does the plan change?"* If no, don't ask. If yes, ask.

Examples:
- "What's your target role?" for a career goal — high leverage.
- "What color should the progress bar be?" — no leverage. Never.
- "Do you work better solo or with a group?" — medium leverage, depends on goal type.

## Goal-Type Signals

Different goal types need different early questions. Use the retrieved methodology chunks to decide which to lean on:

- **Time-bound & external** (exam, launch date, event) — lead with deadline and working-backward pacing.
- **Open-ended craft** (writing a book, learning an instrument) — lead with "how much weekly time, reliably" and current baseline.
- **Habit / lifestyle** — lead with minimum viable version and existing-routine anchor.
- **Interpersonal** — lead with the specific relationship and the current state of it.
- **Business / startup** — lead with customer + current stage + kill criterion.

## Asking One at a Time

Conversational clarification: ask one question, get an answer, use that answer to shape the next. Front-loading all questions as a form loses information and feels cold. The AI should handle this as a conversation, not a wizard.

## When to Stop

Stop clarifying and move to planning when:

- The outcome is concrete (could be photographed or measured when done).
- There's a working deadline, even if soft.
- You have enough baseline + constraint info to size the plan realistically.
- Further questions would produce diminishing planning returns.

If the user is getting impatient, that's also a signal. "We have enough to start — want to see a first draft plan?" is almost always better than a 10th question.

## Output Format

The goalClarifier agent returns a structured list of questions with rationales. Each question should:

- Be one specific question, not a compound of three.
- Have a one-line rationale explaining why it affects planning.
- Be phrased as the AI would actually ask it, conversational voice.

```json
{
  "questions": [
    {
      "text": "What specific role title are you targeting, and at what seniority?",
      "rationale": "The job-search funnel and skill-gap analysis depend on a specific target; 'software engineer' vs. 'ML engineer' produces very different plans."
    }
  ]
}
```

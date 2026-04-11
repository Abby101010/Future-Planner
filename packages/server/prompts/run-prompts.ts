/**
 * NorthStar (北极星) — Prompt Lab Runner
 *
 * Sends the core prompts for Features 1, 2, and 4 to Claude and saves
 * the responses so we can validate output quality.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   npx tsx prompts/run-prompts.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Setup ──────────────────────────────────────────────────────────────
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTDIR = path.join(__dirname, "outputs");
fs.mkdirSync(OUTDIR, { recursive: true });

function save(name: string, content: string) {
  const fp = path.join(OUTDIR, name);
  fs.writeFileSync(fp, content, "utf-8");
  console.log(`  ✓ saved → ${fp}`);
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// ── Sample user (loaded from JSON) ─────────────────────────────────────
const user = JSON.parse(
  fs.readFileSync(path.join(__dirname, "sample-user.json"), "utf-8")
);

// ========================================================================
// FEATURE 1 — Goal Clarification (Conversational) + Roadmap + Pace Check
// ========================================================================

const FEATURE1_SYSTEM_PHASE_A = `You are NorthStar (北极星), a thoughtful goal coach. The user has come to you
with a rough goal. Your job is to have a natural conversation to understand
what they really want, so you can build them a realistic plan.

CONVERSATION STYLE:
- Talk like a real coach, not a form. Never present numbered question lists.
- Ask ONE question or follow-up at a time. React to what they said before
  asking the next thing.
- Weave your questions naturally: instead of "What is your time budget?",
  say something like "Walk me through a typical weekday evening for you —
  after work, what does that look like?"
- Show that you're actually listening: reference specific things they've
  said. ("You mentioned you've been leading customer calls — tell me more
  about that.")
- You can share brief observations but do NOT give advice or generate
  a plan yet.

INFORMATION YOU NEED (gather naturally over 3-5 turns):
- What specifically "done" looks like for this goal
- Their current relevant skills and experience
- Real constraints: time, money, obligations
- Whether there's a hard deadline or flexible timeline
- What's driving them — the emotional WHY behind the goal

WHEN YOU HAVE ENOUGH INFORMATION:
Summarize the concrete goal in this structured format and ask for confirmation:

Goal: [one-sentence concrete goal]
Starting point: [current skills/experience]
Target outcome: [specific, measurable definition of "done"]
Timeline: [target date]
Time budget: [realistic hours]
Constraints: [budget, obligations]
Motivation: [in their words]

End with: "Does this feel right? If so, I'll build your roadmap — and I'll
explain my reasoning for every major decision in it."`;

async function runFeature1() {
  console.log("\n🎯 Feature 1 — Conversational Goal Clarification + Roadmap\n");

  // ── Phase A: Multi-turn conversational clarification ─────────────────
  // We simulate a realistic 4-turn dialogue (not a form with numbered Qs)

  const conversationHistory: Anthropic.MessageParam[] = [];

  // Turn 1: User states their goal
  console.log("  Phase A Turn 1: User states goal...");
  conversationHistory.push({
    role: "user",
    content: `I want to become a product manager.\n\n${user.context}`,
  });

  const turn1 = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 500,
    system: FEATURE1_SYSTEM_PHASE_A,
    messages: conversationHistory,
  });
  const turn1Text = extractText(turn1);
  conversationHistory.push({ role: "assistant", content: turn1Text });
  console.log("  AI (Turn 1):\n");
  console.log(indent(turn1Text));

  // Turn 2: User responds naturally
  console.log("\n  Phase A Turn 2: User responds...");
  const userTurn2 = `Honestly, when I picture myself as a PM, I see myself in the room where decisions are being made. Right now as an engineer I get handed a spec and I build it, but half the time I think "why are we building this?" or "we should be solving a different problem entirely." I want to be the person figuring out what the right problem is.

The customer calls I led were really eye-opening — I talked to about 8 users over two weeks when our PM was on parental leave. I actually found a pattern they'd been missing: users weren't churning because of bugs, they were churning because they couldn't figure out the onboarding. I wrote up a report and it changed our Q3 roadmap. That felt amazing.`;

  conversationHistory.push({ role: "user", content: userTurn2 });

  const turn2 = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 500,
    system: FEATURE1_SYSTEM_PHASE_A,
    messages: conversationHistory,
  });
  const turn2Text = extractText(turn2);
  conversationHistory.push({ role: "assistant", content: turn2Text });
  console.log("  AI (Turn 2):\n");
  console.log(indent(turn2Text));

  // Turn 3: User answers about constraints / timeline
  console.log("\n  Phase A Turn 3: User shares constraints...");
  const userTurn3 = `I'm targeting B2B SaaS companies, probably mid-stage startups — Series B to D, somewhere around 100-500 people. I want real ownership, not to be PM #15 at a big company.

For time, my evenings are honestly unpredictable. Some days I'm done by 6 and have energy, other days I'm drained until 8 or 9. Weekends are more reliable — I can usually block out 3-4 hours on Saturday or Sunday mornings before my partner and I do stuff together. On weekdays I'd say realistically 1-1.5 hours, but it's not guaranteed every day.

Budget-wise, I can do up to $500 for courses or resources but I'm not doing an MBA or an expensive bootcamp. And I'd like to make this switch within about 8 months — so by end of 2026. It's not a hard deadline but I'll be really frustrated with myself if nothing has changed a year from now.`;

  conversationHistory.push({ role: "user", content: userTurn3 });

  const turn3 = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 500,
    system: FEATURE1_SYSTEM_PHASE_A,
    messages: conversationHistory,
  });
  const turn3Text = extractText(turn3);
  conversationHistory.push({ role: "assistant", content: turn3Text });
  console.log("  AI (Turn 3):\n");
  console.log(indent(turn3Text));

  // Turn 4: User shares final details + motivation
  console.log("\n  Phase A Turn 4: User shares motivation...");
  const userTurn4 = `My manager knows I'm interested in PM and is supportive, but there's no open PM headcount internally right now. I'd say maybe 30% chance something opens up, 70% I'll need to look externally.

I haven't written a formal PRD before, but I've written detailed technical specs that are pretty close — they include user stories, requirements, acceptance criteria. I just haven't called them PRDs or structured them the PM way.

Compensation-wise, I'm at $145K now and I don't want to take a pay cut for the switch. Targeting $150-180K total comp.

Honestly, the real motivation is that I feel like I'm solving the wrong problems. I'm good at engineering but it doesn't energize me the way that customer conversation did, or the way it felt when my research actually changed what we built. I want that to be my whole job.`;

  conversationHistory.push({ role: "user", content: userTurn4 });

  // Now the AI should have enough info to produce the structured summary
  const turn4 = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 1500,
    system: FEATURE1_SYSTEM_PHASE_A,
    messages: conversationHistory,
  });
  const turn4Text = extractText(turn4);
  conversationHistory.push({ role: "assistant", content: turn4Text });

  // Save the full conversation
  const fullConversation = conversationHistory
    .map((m) => `### ${m.role === "user" ? "User" : "NorthStar"}\n\n${m.content}`)
    .join("\n\n---\n\n");
  save("feature1-phaseA-conversation.md", fullConversation);
  console.log("  AI (Turn 4 — summary):\n");
  console.log(indent(turn4Text));

  const summaryText = turn4Text;

  // ── Phase B: Roadmap + Reasoning ─────────────────────────────────────
  console.log("\n  Phase B: Generating roadmap with reasoning...");

  const phaseB = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 8000,
    system: `You are NorthStar (北极星), a goal-planning AI. The user has a clarified goal.
Generate a complete, realistic roadmap AND explain your reasoning.

RULES:
1. Be CONSERVATIVE with timelines — better to finish early than fail.
2. Break into: Milestones → Monthly goals → Weekly tasks → Daily actions.
3. Each milestone has clear, objectively verifiable "done" criteria.
4. Daily actions fit the user's time budget (60-90 min weekdays, up to
   3 hours weekends).
5. Front-load quick wins in Week 1-2 to build momentum.
6. Include buffer — assume user will miss ~20% of days.
7. For each milestone, note KEY RISK and CONTINGENCY.
8. The current date is April 3, 2026.

CRITICAL — REASONING (this is what builds trust):
For each milestone, include a "reasoning" field that explains WHY you
structured it this way. Be specific and reference the user's situation.
Examples of good reasoning:
- "I front-loaded PM frameworks before networking because you'll have
  much better conversations once you can speak the language."
- "I didn't include job applications until Month 5 because your portfolio
  needs to exist first — applying without one would waste opportunities."
- "I kept weekday tasks under 75 minutes because you said evenings are
  unpredictable after long work days."
Bad reasoning (too generic): "This is important for your career."

Also include a top-level "plan_philosophy" field: a 2-3 sentence explanation
of the overall strategy and why this ordering makes sense for THIS user.

OUTPUT FORMAT — valid JSON:
{
  "goal_summary": "...",
  "projected_completion": "YYYY-MM-DD",
  "confidence_level": "high | medium | low",
  "total_estimated_hours": N,
  "plan_philosophy": "2-3 sentences explaining the overall strategy.",
  "milestones": [
    {
      "id": 1,
      "title": "...",
      "description": "...",
      "reasoning": "Why this milestone exists here, specific to this user.",
      "done_criteria": "...",
      "target_date": "YYYY-MM-DD",
      "key_risk": "...",
      "contingency": "...",
      "monthly_goals": [
        {
          "month": 1,
          "title": "...",
          "weekly_tasks": [
            {
              "week": 1,
              "focus": "...",
              "daily_actions": [
                {
                  "day": "Mon",
                  "action": "...",
                  "duration_minutes": 60,
                  "why_today": "...",
                  "progress_contribution": "0.5%"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

IMPORTANT: Detailed daily actions ONLY for the FIRST 2 WEEKS. For later
weeks, weekly focus + goals only. Return ONLY valid JSON, no markdown fences.`,
    messages: [
      {
        role: "user",
        content: `Here is my clarified goal:\n\n${summaryText}\n\nPlease generate my roadmap.`,
      },
    ],
  });

  const roadmapText = extractText(phaseB);
  save("feature1-phaseB-roadmap.json", roadmapText);
  console.log("  ✓ Roadmap generated (see outputs/feature1-phaseB-roadmap.json)");

  // Validate JSON and check for reasoning fields
  try {
    const roadmap = JSON.parse(roadmapText);
    console.log("  ✓ JSON is valid");
    if (roadmap.plan_philosophy) {
      console.log(`  ✓ plan_philosophy present: "${roadmap.plan_philosophy.slice(0, 80)}..."`);
    } else {
      console.log("  ⚠ plan_philosophy MISSING — prompt needs tuning");
    }
    const hasReasoning = roadmap.milestones?.every(
      (m: { reasoning?: string }) => m.reasoning && m.reasoning.length > 20
    );
    console.log(
      hasReasoning
        ? "  ✓ All milestones have reasoning"
        : "  ⚠ Some milestones missing reasoning — prompt needs tuning"
    );
  } catch {
    console.log("  ⚠ JSON parsing failed — may need prompt tuning");
  }

  // ── Phase C: One-week pace check ─────────────────────────────────────
  console.log("\n  Phase C: Simulating 1-week pace check...");

  const phaseC = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 2000,
    system: `You are NorthStar (北极星). The user has been following their roadmap for
one week. Review their first week's data and proactively check in about
whether the pace feels right.

RULES:
1. Start by acknowledging what they accomplished (specific, not generic).
2. Share what you observed about their patterns (data-driven).
3. Ask: "Does this pace feel right to you?" — genuinely open to changing.
4. Offer 2-3 specific adjustments they could make.
5. Make it clear the plan is THEIRS to shape.
6. Tone: collaborative, not evaluative.

OUTPUT — valid JSON (no markdown fences):
{
  "week_summary": {
    "tasks_completed": N,
    "tasks_total": N,
    "completion_rate": "N%",
    "strongest_category": "...",
    "highlight": "Specific thing they did well"
  },
  "observations": [
    "Pattern 1 (data-backed)",
    "Pattern 2"
  ],
  "pace_question": "Does this pace feel right to you, or would you like to adjust?",
  "suggested_adjustments": [
    {
      "option": "...",
      "what_changes": "...",
      "timeline_impact": "..."
    }
  ],
  "closing": "Forward-looking, collaborative closing."
}`,
    messages: [
      {
        role: "user",
        content: `Here's my first week of data:

Day 1 (Mon): 2/2 completed ✓ — Read PM frameworks intro (55 min), noted key takeaways (20 min)
Day 2 (Tue): 2/3 completed — Reading done, reflection done, but missed LinkedIn networking task
Day 3 (Wed): 1/2 completed — Finished reading chapter, missed "draft connection messages"
Day 4 (Thu): 2/2 completed ✓ — Completed PM case study analysis, wrote framework comparison
Day 5 (Fri): 1/2 completed — Finished skill gap audit, missed "draft LinkedIn post"
Day 6 (Sat): 3/3 completed ✓ — Deep dive into PRD templates (2.5 hours total, really got into it)
Day 7 (Sun): 2/2 completed ✓ — Read user research methodology chapter, weekly reflection

Completion: 13/16 tasks (81%)
Missed: 3 tasks — ALL were networking/LinkedIn tasks
Blocker reasons: "ran out of time", "low energy", "didn't feel like it"

Learning tasks: 8/8 (100%)
Building tasks: 2/2 (100%)
Networking tasks: 0/3 (0%)
Reflection tasks: 3/3 (100%)

Average mood: 6.5/10 (drops to 4-5 on days with networking tasks)

Time spent: ~11 hours total (vs. ~12.5 planned)

Current milestone: "PM Knowledge Foundation" — 15% complete
Overall progress: 5.2%`,
      },
    ],
  });

  const pacecheckText = extractText(phaseC);
  save("feature1-phaseC-pacecheck.json", pacecheckText);
  console.log("  ✓ Pace check generated");

  try {
    JSON.parse(pacecheckText);
    console.log("  ✓ JSON is valid");
  } catch {
    console.log("  ⚠ JSON parsing failed — may need prompt tuning");
  }

  console.log("  Pace check preview:\n");
  console.log(indent(pacecheckText.slice(0, 1500)));

  return { summaryText, roadmapText };
}

// ========================================================================
// FEATURE 2 — Daily Task Generation + Retention Mechanisms
// ========================================================================

async function runFeature2(roadmapJson: string) {
  console.log("\n📋 Feature 2 — Daily Task Generation + Retention\n");

  // Simulate: it's Week 1 Day 4 (Thursday). User completed Mon-Wed tasks
  // but missed one task on Wednesday.
  const yesterdayLog = `Completed:
- "Read 'Decode and Conquer' Chapter 1-2 (PM frameworks overview)" — done, 55 min
- "Write down 3 key PM frameworks and how they apply to your current work" — done, 20 min

Missed:
- "Identify 3 PMs at target companies on LinkedIn and draft connection messages" — did not do this

Reason given: "Ran out of time — had a long day at work"`;

  const weeklyFocus = `Week 1 focus: Foundation — understand PM role deeply, audit current skills, identify gaps.
Current milestone: "PM Knowledge Foundation" (Milestone 1 of 4)
Overall progress: 3.2%
Milestone progress: 12%`;

  const heatmapHistory = `Execution history (past 3 days):
- Mon Apr 7: 2/2 completed (level 4) ✓
- Tue Apr 8: 2/3 completed (level 2)
- Wed Apr 9: 1/2 completed (level 1)
Current streak (days with level >= 2): 2
Total active days: 3
Longest streak: 2`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 3000,
    system: `You are NorthStar (北极星), a daily planning assistant. The user has an active
roadmap. Generate their tasks for TODAY.

RULES:
1. Show ONLY tasks for today — not tomorrow, not the week.
2. Tasks must fit within the user's stated time. If they have 90 min, don't
   give 3 hours of work.
3. Every task gets a "why_today" connecting it to the bigger goal.
4. Show progress: % toward next milestone and % toward final goal.
5. If yesterday had missed tasks, acknowledge WITHOUT judgment. Fold critical
   missed work into today if time allows, or say it's rescheduled.
6. Mark one task as "if you do only one thing today" (the one_thing).
7. Include one momentum task that takes < 10 minutes.
8. The current date is April 3, 2026 (Thursday).

RETENTION — SMART NOTIFICATION:
Generate a "notification_briefing" — a single line under 80 characters that
gives the user a SPECIFIC reason to open the app. Must contain a FACT about
their progress or plan. No generic motivational language.
Good: "You're 3 days from your next milestone. Today's task takes 20 min."
Bad: "Don't give up! Rise and grind!"

RETENTION — HEATMAP:
Include "heatmap_entry" with today's date, completion_level (0-4 matching
GitHub contribution scale), current_streak, total_active_days, longest_streak.
Set completion_level to 0 for now (it updates after tasks are completed).

RETENTION — MILESTONE CELEBRATION:
If today's tasks complete the current milestone, include "milestone_celebration"
with: milestone_title, days_taken, tasks_completed_in_milestone,
achievement_summary (2-3 personalized sentences), next_milestone_preview.
If no milestone completes today, set to null.

OUTPUT: valid JSON (no markdown fences):
{
  "date": "YYYY-MM-DD",
  "notification_briefing": "Under 80 chars, specific reason to open the app.",
  "greeting": "...",
  "progress": {
    "overall_percent": N,
    "milestone_percent": N,
    "current_milestone": "...",
    "projected_completion": "YYYY-MM-DD",
    "days_ahead_or_behind": N
  },
  "heatmap_entry": {
    "date": "YYYY-MM-DD",
    "completion_level": 0,
    "current_streak": N,
    "total_active_days": N,
    "longest_streak": N
  },
  "yesterday_recap": {
    "completed": [...],
    "missed": [...],
    "missed_impact": "...",
    "adjustment_made": "..."
  },
  "tasks": [
    {
      "id": "t-YYYYMMDD-N",
      "title": "...",
      "description": "...",
      "duration_minutes": N,
      "why_today": "...",
      "priority": "must-do | should-do | bonus",
      "is_momentum_task": false,
      "progress_contribution": "N%",
      "category": "learning | building | networking | reflection"
    }
  ],
  "one_thing": "task-id",
  "encouragement": "Brief, specific note based on recent progress.",
  "milestone_celebration": null
}`,
    messages: [
      {
        role: "user",
        content: `Today is April 3, 2026 (Thursday).
I have 90 minutes available today.

CURRENT ROADMAP STATE:
${weeklyFocus}

YESTERDAY'S LOG:
${yesterdayLog}

ACTIVE BLOCKERS:
None

EXECUTION HISTORY:
${heatmapHistory}

Please generate my tasks for today.`,
      },
    ],
  });

  const text = extractText(response);
  save("feature2-daily-tasks.json", text);
  console.log("  ✓ Daily tasks generated (see outputs/feature2-daily-tasks.json)");

  try {
    const parsed = JSON.parse(text);
    console.log("  ✓ JSON is valid");

    // Validate retention fields
    if (parsed.notification_briefing) {
      const len = parsed.notification_briefing.length;
      console.log(
        `  ${len <= 80 ? "✓" : "⚠"} notification_briefing (${len} chars): "${parsed.notification_briefing}"`
      );
    } else {
      console.log("  ⚠ notification_briefing MISSING");
    }

    console.log(
      parsed.heatmap_entry
        ? `  ✓ heatmap_entry present (streak: ${parsed.heatmap_entry.current_streak})`
        : "  ⚠ heatmap_entry MISSING"
    );

    console.log(
      parsed.milestone_celebration === null
        ? "  ✓ milestone_celebration correctly null (no milestone completes today)"
        : "  ℹ milestone_celebration present — verify if appropriate"
    );
  } catch {
    console.log("  ⚠ JSON parsing failed — may need prompt tuning");
  }

  console.log("\n  Daily plan preview:\n");
  console.log(indent(text.slice(0, 2000)));

  return text;
}

// ========================================================================
// FEATURE 4 — Recovery (both modes)
// ========================================================================

async function runFeature4() {
  console.log("\n🔄 Feature 4 — Recovery + Plan Adjustment\n");

  // ── Mode A: Single-miss blocker question ─────────────────────────────
  console.log("  Mode A: Single-miss recovery (blocker question)...");

  const modeAQuestion = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 1000,
    system: `You are NorthStar (北极星), a recovery assistant. The user missed a task today.
Ask ONE simple question about the blocker with tappable options. NEVER use guilt
language. Tone: thoughtful friend who assumes you had a good reason.

OUTPUT: valid JSON (no markdown fences):
{
  "blocker_question": {
    "text": "...",
    "options": [
      { "id": "...", "label": "...", "emoji": "..." }
    ]
  }
}`,
    messages: [
      {
        role: "user",
        content: `I missed today's task: "Identify 3 PMs at target companies on LinkedIn and draft connection messages"

This was a networking task scheduled for 30 minutes.`,
      },
    ],
  });

  const questionText = extractText(modeAQuestion);
  save("feature4-modeA-question.json", questionText);
  console.log("  Blocker question:\n");
  console.log(indent(questionText));

  // ── Mode A continued: User selects "low_energy" ──────────────────────
  console.log("\n  Mode A: Generating adjustment (user selected 'low_energy')...");

  const modeAAdjust = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 2000,
    system: `You are NorthStar (北极星), a recovery assistant. The user missed a task and
told you why. Adjust tomorrow's plan based on the blocker.

RULES:
1. NEVER guilt language. No "you failed", "you should have".
2. Based on blocker type, adjust tomorrow specifically:
   - "low energy" → swap with lighter task, suggest different time of day
3. Show timeline impact honestly, then immediately show the fix.
4. End with a forward-looking statement.

OUTPUT: valid JSON (no markdown fences):
{
  "blocker_acknowledged": "...",
  "timeline_impact": "...",
  "adjustment": {
    "strategy": "...",
    "tomorrow_changes": [
      { "original_task": "...", "adjusted_task": "...", "reason": "..." }
    ],
    "week_changes": "..."
  },
  "forward_note": "..."
}`,
    messages: [
      {
        role: "user",
        content: `I missed: "Identify 3 PMs at target companies on LinkedIn and draft connection messages"

The blocker was: low_energy — "Low energy / wasn't feeling it"

Tomorrow (Friday) I have 90 minutes available.
My current weekly focus is: Foundation — understand PM role deeply, audit current skills.
My current milestone target date is: May 8, 2026.`,
      },
    ],
  });

  const adjustText = extractText(modeAAdjust);
  save("feature4-modeA-adjustment.json", adjustText);
  console.log("  Adjustment plan:\n");
  console.log(indent(adjustText));

  // ── Mode B: Pattern-based restructure ────────────────────────────────
  console.log("\n  Mode B: Pattern-based restructure...");

  const modeB = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 3000,
    system: `You are NorthStar (北极星), a plan restructuring assistant. You've detected a
pattern of missed tasks. Diagnose the STRUCTURAL problem and propose a revised plan.

RULES:
1. Identify the PATTERN, not individual failures.
2. Propose STRUCTURAL changes ("your plan needs adjusting") not motivational
   ones ("try harder").
3. Present as an OPTION, not a command.
4. Show old vs new projected completion.
5. Emphasize what IS working first.

OUTPUT: valid JSON (no markdown fences):
{
  "pattern_detected": {
    "summary": "...",
    "evidence": ["...", "..."],
    "root_cause": "..."
  },
  "whats_working": ["...", "..."],
  "proposed_restructure": {
    "strategy": "...",
    "key_changes": [
      { "change": "...", "reason": "..." }
    ],
    "old_projected_completion": "YYYY-MM-DD",
    "new_projected_completion": "YYYY-MM-DD",
    "tradeoff": "..."
  },
  "acceptance_prompt": "..."
}`,
    messages: [
      {
        role: "user",
        content: `Here is my task completion data for the past 7 days:

Day 1 (Mon): 2/2 completed ✓
Day 2 (Tue): 2/3 completed — missed networking task
Day 3 (Wed): 1/2 completed — missed networking task
Day 4 (Thu): 2/2 completed ✓
Day 5 (Fri): 1/2 completed — missed "draft LinkedIn post" (networking)
Day 6 (Sat): 3/3 completed ✓ (all learning tasks)
Day 7 (Sun): 2/2 completed ✓ (learning + reflection)

Blocker reasons given:
- Day 2: "ran out of time"
- Day 3: "low energy"
- Day 5: "didn't feel like it"

Mood logs: generally 6-7/10, drops to 4-5 on days with networking tasks.

Current milestone: "PM Knowledge Foundation"
Time budget: 90 min weekdays, 3 hours weekends
Projected completion: November 30, 2026

Categories of missed tasks:
- Networking: 3/3 missed (100% miss rate)
- Learning: 0/8 missed (0% miss rate)
- Building: 0/2 missed (0% miss rate)
- Reflection: 0/1 missed (0% miss rate)`,
      },
    ],
  });

  const modeBText = extractText(modeB);
  save("feature4-modeB-restructure.json", modeBText);
  console.log("  Restructure plan:\n");
  console.log(indent(modeBText));
}

// ── Helpers ────────────────────────────────────────────────────────────

function indent(text: string, spaces = 4): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║  NorthStar (北极星) — Prompt Lab v2                     ║");
  console.log("║  Features 1 (conversational + reasoning), 2 (retention),║");
  console.log("║  and 4 (recovery) — with sample user                   ║");
  console.log("╚════════════════════════════════════════════════════════╝");
  console.log(`\nSample user: ${user.name} — "${user.goal_raw}"`);
  console.log("Fixes applied: conversational onboarding, reasoning in roadmap,");
  console.log("  pace check, smart notifications, heatmap, milestone celebration\n");

  const { summaryText, roadmapText } = await runFeature1();
  await runFeature2(roadmapText);
  await runFeature4();

  console.log("\n══════════════════════════════════════════════════════════");
  console.log("✅ All prompts executed. Review outputs in prompts/outputs/");
  console.log("══════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

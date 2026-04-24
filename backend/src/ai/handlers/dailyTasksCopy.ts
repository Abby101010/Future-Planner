/* Starward — Lightweight Daily Tasks Copy Handler
 *
 * Step 2 of the two-step daily task pipeline:
 *   Step 1: selectDailyTasks() (deterministic rule engine in @starward/core)
 *   Step 2: This handler — a Haiku call that generates only the
 *           natural-language copy for the already-selected tasks.
 *
 * Replaces the heavyweight Sonnet handler (handleDailyTasks) which
 * both selected AND described tasks in a single ~2000-token prompt.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "@starward/core";
import { personalizeSystem } from "@starward/core";
import type { TriagedTask } from "@starward/core";

const COPY_SYSTEM = `You are Starward, a concise daily planning assistant.
You receive a PRE-SELECTED, PRE-SEQUENCED list of today's tasks. Your ONLY job
is to write short motivational copy for each task and a daily briefing.

For each task, write a "why_today" (1 sentence, <80 chars) connecting the task
to the user's broader goal and explaining why today is the right day.

Also produce:
- notification_briefing: a short (under 80 chars) motivating one-liner for the day
- adaptive_reasoning: 1-2 sentences explaining the selection logic
- encouragement: a brief (under 100 chars) motivating closing line

Return ONLY valid JSON with no markdown fences.`;

interface CopyInput {
  date: string;
  selectedTasks: TriagedTask[];
  yesterdayRecap?: { tasksCompleted: number; tasksTotal: number } | null;
  memoryContext: string;
  recentCompletionRate: number;
  recommendedCount: string;
}

interface CopyResult {
  taskCopy: Record<string, { whyToday: string }>;
  notificationBriefing: string;
  adaptiveReasoning: string;
  encouragement: string;
}

export async function handleDailyTasksCopy(
  client: Anthropic,
  input: CopyInput,
): Promise<CopyResult> {
  const taskLines = input.selectedTasks.map(
    (t) =>
      `- "${t.title}" (goal: ${t.goalTitle ?? "standalone"}, weight: ${t.cognitiveWeight}, ${t.durationMinutes}min, signal: ${t.signal})`,
  );

  const yesterdayLine = input.yesterdayRecap
    ? `Yesterday: ${input.yesterdayRecap.tasksCompleted}/${input.yesterdayRecap.tasksTotal} tasks completed.`
    : "First day (no history).";

  const userMessage = `Today: ${input.date}
${yesterdayLine}
Recent completion rate: ${input.recentCompletionRate === -1 ? "new user" : `${input.recentCompletionRate}%`}
Recommended count: ${input.recommendedCount}

SELECTED TASKS (already chosen and sequenced by the rule engine):
${taskLines.join("\n")}

Generate copy for these tasks. Return JSON:
{
  "task_copy": {
    "<task_id>": { "why_today": "..." }
  },
  "notification_briefing": "...",
  "adaptive_reasoning": "...",
  "encouragement": "..."
}`;

  const response = await client.messages.create({
    model: getModelForTask("daily-tasks-copy"),
    max_tokens: 1024,
    system: personalizeSystem(COPY_SYSTEM, input.memoryContext),
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    const cleaned = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    const taskCopy: Record<string, { whyToday: string }> = {};
    if (parsed.task_copy && typeof parsed.task_copy === "object") {
      for (const [id, val] of Object.entries(parsed.task_copy)) {
        const v = val as Record<string, unknown>;
        taskCopy[id] = { whyToday: String(v.why_today ?? "") };
      }
    }

    return {
      taskCopy,
      notificationBriefing: String(parsed.notification_briefing ?? ""),
      adaptiveReasoning: String(parsed.adaptive_reasoning ?? ""),
      encouragement: String(parsed.encouragement ?? ""),
    };
  } catch {
    // Fallback: generate generic copy if parsing fails
    const taskCopy: Record<string, { whyToday: string }> = {};
    for (const t of input.selectedTasks) {
      taskCopy[t.id] = {
        whyToday: t.goalTitle
          ? `Keeps "${t.goalTitle}" on track.`
          : "Planned for today.",
      };
    }
    return {
      taskCopy,
      notificationBriefing: `${input.selectedTasks.length} tasks ready for today`,
      adaptiveReasoning: "Tasks selected by rule engine based on priority, recency, and budget.",
      encouragement: "You've got this!",
    };
  }
}

/**
 * Personalization Sub-Agent for the Big Goal Coordinator.
 *
 * Pulls user behavior data from the Daily Planner's capacity profile
 * to understand what the user can actually handle. Prevents the plan
 * generator from overwhelming the user with unrealistic workloads.
 */

import { loadMemory, buildMemoryContext, computeCapacityProfile } from "../../memory";
import { getCurrentUserId } from "../../middleware/requestContext";
import * as repos from "../../repositories";

export interface PersonalizationResult {
  /** How many tasks the user typically completes per day */
  avgTasksPerDay: number;
  /** Recent completion rate (0-100) */
  completionRate: number;
  /** Maximum cognitive weight the user should handle daily */
  maxDailyWeight: number;
  /** Days of the week where the user is weakest */
  weakDays: string[];
  /** Whether the user tends to get overwhelmed */
  overwhelmRisk: "low" | "medium" | "high";
  /** Trend: is the user getting better or worse? */
  trend: "improving" | "stable" | "declining";
  /** Whether this is a new user with little history */
  isNewUser: boolean;
  /** Formatted context string for prompt injection */
  capacityContext: string;
  /** Memory context for personalizing prompts */
  memoryContext: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function runPersonalizationAgent(): Promise<PersonalizationResult> {
  const userId = getCurrentUserId();

  // Load memory, user profile, and past logs in parallel
  const [memory, pastLogs, user] = await Promise.all([
    loadMemory(userId),
    loadRecentLogs(),
    repos.users.get(),
  ]);

  const dayOfWeek = new Date().getDay();
  void user;
  const profile = computeCapacityProfile(memory, pastLogs, dayOfWeek, null);
  const memoryContext = await buildMemoryContext(memory, "planning");

  // Determine weak days from the profile
  const weakDays: string[] = [];
  if (profile.dayOfWeekModifier < 0) {
    weakDays.push(DAY_NAMES[dayOfWeek]);
  }

  // Determine overwhelm risk
  let overwhelmRisk: "low" | "medium" | "high" = "low";
  if (profile.overwhelmDays > 3) {
    overwhelmRisk = "high";
  } else if (profile.overwhelmDays > 1) {
    overwhelmRisk = "medium";
  }

  // Build a formatted capacity context for prompt injection
  const capacityContext = [
    `## User Capacity Profile`,
    `- Average tasks completed/day: ${profile.avgTasksCompletedPerDay.toFixed(1)}`,
    `- Recent completion rate: ${profile.recentCompletionRate.toFixed(0)}%`,
    `- Cognitive budget: ${profile.capacityBudget} points/day`,
    `- Trend: ${profile.trend}`,
    `- Overwhelm risk: ${overwhelmRisk} (${profile.overwhelmDays} overwhelm days in last 14)`,
    profile.isNewUser ? "- NEW USER: limited history, start conservative (2-3 tasks/day)" : "",
    profile.chronicSnoozePatterns.length > 0
      ? `- Chronic snooze patterns: ${profile.chronicSnoozePatterns.join(", ")}`
      : "",
    "",
    "IMPORTANT: Do NOT generate more daily tasks than this user can handle.",
    `Recommended: ${Math.max(2, Math.min(5, Math.round(profile.avgTasksCompletedPerDay)))} tasks/day.`,
  ].filter(Boolean).join("\n");

  return {
    avgTasksPerDay: profile.avgTasksCompletedPerDay,
    completionRate: profile.recentCompletionRate,
    maxDailyWeight: profile.capacityBudget,
    weakDays,
    overwhelmRisk,
    trend: profile.trend,
    isNewUser: profile.isNewUser,
    capacityContext,
    memoryContext,
  };
}

type CapacityLog = {
  date: string;
  tasks: Array<{ completed: boolean; skipped?: boolean }>;
};

/** Load the last 30 days of daily task data for capacity profiling */
async function loadRecentLogs(): Promise<CapacityLog[]> {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const start = thirtyDaysAgo.toISOString().split("T")[0];
  const end = today.toISOString().split("T")[0];

  const taskRecords = await repos.dailyTasks.listForDateRange(start, end);

  // Group tasks by date
  const byDate = new Map<string, CapacityLog>();
  for (const t of taskRecords) {
    if (!byDate.has(t.date)) {
      byDate.set(t.date, { date: t.date, tasks: [] });
    }
    const pl = t.payload as Record<string, unknown>;
    byDate.get(t.date)!.tasks.push({
      completed: t.completed,
      skipped: (pl?.skipped as boolean) ?? false,
    });
  }

  return Array.from(byDate.values());
}

import type { ChatWidget } from "@northstar/core";

const CATEGORY_OPTIONS = [
  { label: "Work", value: "work" },
  { label: "Personal", value: "personal" },
  { label: "Health", value: "health" },
  { label: "Social", value: "social" },
  { label: "Travel", value: "travel" },
  { label: "Focus", value: "focus" },
  { label: "Other", value: "other" },
];

const GOAL_TYPE_OPTIONS = [
  { label: "Big Goal", value: "big" },
  { label: "Daily Habit", value: "everyday" },
  { label: "Repeating", value: "repeating" },
];

const PRIORITY_OPTIONS = [
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
];

const REPEAT_OPTIONS = [
  { label: "One-time", value: "none" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
];

const IMPORTANCE_OPTIONS = [
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
];

export function detectChatWidget(reply: string): ChatWidget | undefined {
  const lower = reply.toLowerCase();

  // Only attach widgets to messages that look like questions
  const isQuestion = /\?/.test(reply);
  if (!isQuestion) return undefined;

  // Category detection
  if (/\bcategor(y|ies)\b/i.test(reply) &&
      /\b(work|personal|health|social|travel|focus)\b/i.test(reply)) {
    return { type: "choices", options: CATEGORY_OPTIONS };
  }

  // Goal type detection
  if (/\b(goal\s*type|type\s*of\s*goal|big|everyday|repeating)\b/i.test(reply) &&
      (/\bbig\b/i.test(reply) || /\beveryday\b/i.test(reply) || /\brepeating\b/i.test(reply) || /\bhabit\b/i.test(reply))) {
    return { type: "choices", options: GOAL_TYPE_OPTIONS };
  }

  // Priority / importance detection
  if (/\b(priority|importance)\b/i.test(reply) &&
      /\b(high|medium|low)\b/i.test(reply)) {
    return { type: "choices", options: IMPORTANCE_OPTIONS };
  }

  // Repeat / frequency detection
  if (/\b(repeat|frequency|how often|recur)\b/i.test(reply) &&
      /\b(daily|weekly|monthly|one.?time)\b/i.test(reply)) {
    return { type: "choices", options: REPEAT_OPTIONS };
  }

  // Time detection — "what time" / "which time"
  if (/\b(what|which|preferred?)\s+time\b/i.test(reply)) {
    return { type: "time-picker" };
  }

  // Date detection — "what date" / "which date" / "when"
  if (/\b(what|which)\s+(date|day)\b/i.test(reply) ||
      (/\bwhen\b/i.test(lower) && /\b(would you like|should|prefer|want|schedule)\b/i.test(lower))) {
    return { type: "date-picker" };
  }

  return undefined;
}

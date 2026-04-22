/**
 * Effort Classifier — local heuristic replacing Haiku effortRouter.
 *
 * Classifies user goal requests as HIGH or LOW effort using weighted
 * keyword/pattern signals. Saves a Haiku API call per goal creation.
 *
 * Pattern: ACONIC — constraint-guided classification. The HIGH/LOW
 * decision is a binary constraint check, not a creative reasoning task.
 *
 * When confidence is low (<0.6), callers should fall back to the
 * existing Haiku effortRouter for ambiguous cases.
 */

export interface EffortClassifierInput {
  userMessage: string;
  existingGoals: Array<{ title: string; goalType: string; status: string }>;
  todayTaskCount: number;
  currentCognitiveLoad: number;
}

export interface EffortClassifierResult {
  effort: "high" | "low";
  reasoning: string;
  confidence: number; // 0-1
}

// ── Signal patterns ─────────────────────────────────────────

const HIGH_KEYWORDS = [
  "plan", "roadmap", "breakdown", "research", "restructure",
  "learn", "build", "career", "strategy", "milestone",
  "timeline", "schedule", "dependencies", "phased",
];

const HIGH_PHRASES = [
  /how should i/i,
  /what'?s the best way/i,
  /help me (plan|create|design|build|develop|start)/i,
  /i want to (learn|build|create|start|develop|launch)/i,
  /step.by.step/i,
  /long.?term/i,
];

const LOW_TASK_PATTERNS = [
  /^remind me/i,
  /^add (a )?task/i,
  /^set (a )?reminder/i,
  /^buy /i,
  /^call /i,
  /^email /i,
  /^schedule (a )?meeting/i,
];

const LOW_QUESTION_PATTERNS = [
  /how am i doing/i,
  /when is (my |the )?deadline/i,
  /what'?s my (progress|status)/i,
  /how much time/i,
  /am i on track/i,
];

const LOW_EDIT_PATTERNS = [
  /move (this |that )?(task|it) to/i,
  /push (this |that )?(task|it) (to|back)/i,
  /swap (the )?order/i,
  /change (the )?(date|time|day)/i,
  /reschedule/i,
];

// ── Classifier ──────────────────────────────────────────────

export function classifyEffort(input: EffortClassifierInput): EffortClassifierResult {
  const { userMessage, existingGoals, todayTaskCount, currentCognitiveLoad } = input;
  const msg = userMessage.trim();
  const msgLower = msg.toLowerCase();

  let highScore = 0;
  let lowScore = 0;
  const reasons: string[] = [];

  // ── HIGH signals ──

  // Long message → complex request
  if (msg.length > 200) {
    highScore += 0.15;
    reasons.push("complex request (long message)");
  }

  // Keyword matches (cap at 2 keyword hits to avoid over-counting)
  let keywordHits = 0;
  for (const kw of HIGH_KEYWORDS) {
    if (msgLower.includes(kw) && keywordHits < 2) {
      highScore += 0.15;
      keywordHits++;
      if (keywordHits === 1) reasons.push(`planning keyword: "${kw}"`);
    }
  }

  // Phrase matches
  for (const pattern of HIGH_PHRASES) {
    if (pattern.test(msgLower)) {
      highScore += 0.1;
      reasons.push("research/planning phrasing");
      break; // count once
    }
  }

  // No matching existing goal → starting something new
  const hasMatchingGoal = existingGoals.some(
    (g) =>
      g.status === "active" &&
      (msgLower.includes(g.title.toLowerCase()) ||
        g.title.toLowerCase().includes(msgLower.slice(0, 30))),
  );
  if (!hasMatchingGoal && existingGoals.length > 0) {
    highScore += 0.1;
  }

  // ── LOW signals ──

  // Short message → simple request
  if (msg.length < 80) {
    lowScore += 0.2;
    if (reasons.length === 0) reasons.push("short, simple request");
  }

  // Simple task patterns
  for (const pattern of LOW_TASK_PATTERNS) {
    if (pattern.test(msg)) {
      lowScore += 0.25;
      reasons.push("simple task addition");
      break;
    }
  }

  // Status check patterns
  for (const pattern of LOW_QUESTION_PATTERNS) {
    if (pattern.test(msg)) {
      lowScore += 0.2;
      reasons.push("status check question");
      break;
    }
  }

  // Minor edit patterns
  for (const pattern of LOW_EDIT_PATTERNS) {
    if (pattern.test(msg)) {
      lowScore += 0.2;
      reasons.push("minor plan edit");
      break;
    }
  }

  // Matching an existing active goal → follow-up, not new planning
  if (hasMatchingGoal) {
    lowScore += 0.15;
  }

  // Everyday/repeating goals are structurally simple
  const hasEverydayKeyword =
    /\b(every\s*day|daily|gym|exercise|meditat|journal|read|habit)\b/i.test(msg);
  if (hasEverydayKeyword) {
    lowScore += 0.15;
    reasons.push("everyday/habit goal pattern");
  }

  // User is currently overloaded → default to low effort to avoid piling on
  if (todayTaskCount > 6 && currentCognitiveLoad > 9) {
    lowScore += 0.1;
  }

  // ── Scoring ──

  const total = highScore + lowScore + 0.01; // avoid division by zero
  const score = highScore / total;
  const effort = score > 0.5 ? "high" : "low";
  const confidence = Math.abs(score - 0.5) * 2; // 0 at threshold, 1 at extremes

  const reasoning =
    reasons.length > 0
      ? reasons[0]
      : effort === "high"
        ? "Multi-step goal requiring planning"
        : "Simple request";

  return { effort, reasoning, confidence };
}

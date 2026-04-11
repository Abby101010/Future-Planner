/* ──────────────────────────────────────────────────────────
   NorthStar — Model Configuration

   Centralized model tier system. Each task type maps to a
   model tier (heavy / medium / light), and each tier maps
   to a Claude model. Users can override tiers in Settings.
   ────────────────────────────────────────────────────────── */

/** Available Claude models, ordered by capability */
export type ClaudeModel =
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5-20251001";

/** Model tier — maps to a default Claude model */
export type ModelTier = "heavy" | "medium" | "light";

/** Default model for each tier */
const TIER_DEFAULTS: Record<ModelTier, ClaudeModel> = {
  heavy: "claude-sonnet-4-6",      // Users can upgrade to Opus
  medium: "claude-sonnet-4-6",
  light: "claude-haiku-4-5-20251001",
};

/** Every task type and its assigned tier */
const TASK_TIERS: Record<string, ModelTier> = {
  // Heavy — complex reasoning, strategic planning
  "generate-goal-plan": "heavy",
  "goal-breakdown": "heavy",
  "reallocate": "heavy",

  // Medium — balanced quality + speed
  "daily-tasks": "medium",
  "onboarding": "medium",
  "goal-plan-chat": "medium",
  "goal-plan-edit": "medium",
  "research": "medium",          // research-agent
  "news-digest": "medium",

  // Medium — home chat must emit structured JSON for intent detection;
  // Haiku was too unreliable at following the contract (phase 9 bug fix).
  "home-chat": "medium",

  // Light — fast responses, simple tasks
  "recovery": "light",
  "pace-check": "light",
  "classify-goal": "light",
  "analyze-quick-task": "light",
  "analyze-monthly-context": "light",
  "reflection": "light",         // reflection engine
  "coordinator": "light",        // coordinator's own calls (routing only)
};

/** User overrides stored in settings (tier → model) */
let userOverrides: Partial<Record<ModelTier, ClaudeModel>> = {};

/**
 * Apply user overrides from settings.
 * Called once at startup and whenever settings change.
 */
export function setModelOverrides(overrides: Partial<Record<ModelTier, ClaudeModel>>): void {
  userOverrides = { ...overrides };
}

/**
 * Get the model for a given task type.
 * Checks user overrides first, then falls back to tier defaults.
 */
export function getModelForTask(taskType: string): ClaudeModel {
  const tier = TASK_TIERS[taskType] || "medium";
  return userOverrides[tier] || TIER_DEFAULTS[tier];
}

/**
 * Get the model for a given tier directly.
 * Used by sub-agents that don't have a request type string.
 */
export function getModelForTier(tier: ModelTier): ClaudeModel {
  return userOverrides[tier] || TIER_DEFAULTS[tier];
}

/** Get all tier assignments (for Settings UI display) */
export function getModelConfig(): {
  tiers: Record<ModelTier, ClaudeModel>;
  tasks: Record<string, ModelTier>;
  availableModels: ClaudeModel[];
} {
  return {
    tiers: {
      heavy: userOverrides.heavy || TIER_DEFAULTS.heavy,
      medium: userOverrides.medium || TIER_DEFAULTS.medium,
      light: userOverrides.light || TIER_DEFAULTS.light,
    },
    tasks: { ...TASK_TIERS },
    availableModels: [
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
  };
}

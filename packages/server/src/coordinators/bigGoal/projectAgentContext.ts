/**
 * Project Agent Context — persistent context per big goal.
 *
 * When a big goal is confirmed, saves the full chat history + research
 * findings + personalization data to the conversations table payload.
 * On follow-up, loads this context so Opus doesn't re-process from scratch.
 *
 * Storage: conversations table, kind='goal-plan', payload extended with
 * projectContext field.
 */

import * as repos from "../../repositories";
import type { ResearchResult } from "./researchAgent";
import type { PersonalizationResult } from "./personalizationAgent";

export interface ProjectAgentContext {
  /** Research findings from the initial planning session */
  research: ResearchResult | null;
  /** User capacity profile at time of plan creation */
  personalization: {
    avgTasksPerDay: number;
    completionRate: number;
    maxDailyWeight: number;
    overwhelmRisk: string;
    trend: string;
  } | null;
  /** Key decisions made during the planning conversation */
  decisions: string[];
  /** When this context was last updated */
  updatedAt: string;
}

/**
 * Save project agent context for a goal.
 * Upserts into the conversations table payload alongside chat history.
 */
export async function saveProjectContext(
  goalId: string,
  context: ProjectAgentContext,
): Promise<void> {
  // Find or create the goal-plan conversation
  const conversations = await repos.chat.listConversations();
  let conv = conversations.find(
    (c) => c.kind === "goal-plan" && c.payload?.goalId === goalId,
  );

  if (conv) {
    // Update existing conversation's payload with project context
    await repos.chat.upsertConversation({
      id: conv.id,
      kind: "goal-plan",
      title: conv.title,
      payload: {
        ...(conv.payload ?? {}),
        goalId,
        projectContext: context,
      },
    });
  } else {
    // Create new conversation with project context
    await repos.chat.upsertConversation({
      id: `goal-plan-${goalId}`,
      kind: "goal-plan",
      title: `Goal Plan: ${goalId}`,
      payload: {
        goalId,
        projectContext: context,
      },
    });
  }
}

/**
 * Load project agent context for a goal.
 * Returns null if no context exists (first interaction).
 */
export async function loadProjectContext(
  goalId: string,
): Promise<ProjectAgentContext | null> {
  const conversations = await repos.chat.listConversations();
  const conv = conversations.find(
    (c) => c.kind === "goal-plan" && c.payload?.goalId === goalId,
  );

  if (!conv?.payload?.projectContext) return null;

  return conv.payload.projectContext as ProjectAgentContext;
}

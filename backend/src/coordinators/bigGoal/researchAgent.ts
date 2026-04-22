/**
 * Research Sub-Agent for the Big Goal Coordinator.
 *
 * Does real-world research on how the goal should be planned:
 * timelines, best practices, dependencies, domain-specific advice.
 * Results are injected into _researchSummary + _researchFindings
 * on the AI handler payload.
 */

import { getClient } from "../../ai/client";
import { getModelForTask } from "@northstar/core";

export interface ResearchInput {
  goalTitle: string;
  goalDescription: string;
  targetDate: string;
  importance: string;
  /** Any user-provided context about the goal */
  additionalContext?: string;
}

export interface ResearchResult {
  /** 2-3 sentence summary of research findings */
  summary: string;
  /** Structured findings the plan generator should use */
  findings: {
    estimatedTotalHours: number;
    suggestedTimeline: string;
    keyMilestones: string[];
    bestPractices: string[];
    commonPitfalls: string[];
    dependencies: string[];
    /** Domain-specific advice */
    domainAdvice: string;
  };
}

const RESEARCH_SYSTEM = `You are a research agent for a goal planning system. Your job is to provide practical, evidence-based research on how to accomplish a specific goal.

Given a goal, research and provide:
1. **Estimated total hours** to achieve this goal (be realistic, not optimistic)
2. **Suggested timeline** with phases
3. **Key milestones** (3-6 checkpoints)
4. **Best practices** from people who have achieved similar goals
5. **Common pitfalls** to avoid
6. **Dependencies** (what needs to happen before what)
7. **Domain-specific advice** tailored to this exact goal

Be specific and practical. Don't give generic advice — tailor everything to THIS goal.

Respond with ONLY a JSON object:
{
  "summary": "2-3 sentence overview of your research",
  "findings": {
    "estimatedTotalHours": number,
    "suggestedTimeline": "string",
    "keyMilestones": ["string"],
    "bestPractices": ["string"],
    "commonPitfalls": ["string"],
    "dependencies": ["string"],
    "domainAdvice": "string"
  }
}`;

export async function runResearchAgent(
  input: ResearchInput,
): Promise<ResearchResult> {
  const client = getClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");
  const model = getModelForTask("goal-research");

  const userPrompt = [
    `## Goal: ${input.goalTitle}`,
    input.goalDescription ? `## Description: ${input.goalDescription}` : "",
    input.targetDate ? `## Target Date: ${input.targetDate}` : "",
    `## Importance: ${input.importance}`,
    input.additionalContext
      ? `## Additional Context: ${input.additionalContext}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: RESEARCH_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as ResearchResult;
      if (parsed.summary && parsed.findings) {
        return parsed;
      }
    }
  } catch {
    // Fall through to default
  }

  return {
    summary: "Research could not be completed. Proceeding with default planning.",
    findings: {
      estimatedTotalHours: 100,
      suggestedTimeline: "3-6 months",
      keyMilestones: ["Define scope", "Build foundation", "Iterate", "Complete"],
      bestPractices: ["Start small", "Be consistent", "Track progress"],
      commonPitfalls: ["Trying to do too much at once", "Not tracking progress"],
      dependencies: [],
      domainAdvice: "Focus on consistency over intensity.",
    },
  };
}

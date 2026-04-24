/* Starward server — Critique agent (Haiku)
 *
 * Thin wrapper around Anthropic Haiku that executes one critique pass. Returns
 * the parsed critique payload. Throws on network / parse failure; the caller
 * (runCritique) is responsible for swallowing errors so the primary flow is
 * never affected.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getModelForTier } from "@starward/core";
import { CRITIQUE_SYSTEM } from "./prompts";
import type { CritiqueIssue } from "../ws/events";

export interface RawCritique {
  overallAssessment: "ok" | "concerns" | "blocking";
  summary?: string;
  issues: CritiqueIssue[];
}

export interface CritiqueAgentInput {
  handler: string;
  primaryOutput: unknown;
  memoryContext: string;
  payload: unknown;
}

const VALID_SEVERITIES = new Set<CritiqueIssue["severity"]>(["info", "warn", "error"]);
const VALID_CATEGORIES = new Set<CritiqueIssue["category"]>([
  "hallucination",
  "overcommit",
  "memory-violation",
  "priority-violation",
  "other",
]);
const VALID_ASSESSMENTS = new Set<RawCritique["overallAssessment"]>([
  "ok",
  "concerns",
  "blocking",
]);

function extractFirstJson(text: string): string | null {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return null;
}

function sanitize(raw: unknown): RawCritique {
  if (!raw || typeof raw !== "object") {
    return { overallAssessment: "ok", issues: [] };
  }
  const r = raw as Record<string, unknown>;
  const assessment = VALID_ASSESSMENTS.has(r.overallAssessment as RawCritique["overallAssessment"])
    ? (r.overallAssessment as RawCritique["overallAssessment"])
    : "ok";
  const summary = typeof r.summary === "string" ? r.summary.slice(0, 280) : undefined;
  const issuesIn = Array.isArray(r.issues) ? r.issues : [];
  const issues: CritiqueIssue[] = [];
  for (const item of issuesIn.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const severity = VALID_SEVERITIES.has(it.severity as CritiqueIssue["severity"])
      ? (it.severity as CritiqueIssue["severity"])
      : "info";
    const category = VALID_CATEGORIES.has(it.category as CritiqueIssue["category"])
      ? (it.category as CritiqueIssue["category"])
      : "other";
    const message = typeof it.message === "string" ? it.message.slice(0, 400) : "";
    if (!message) continue;
    const suggestion = typeof it.suggestion === "string" ? it.suggestion.slice(0, 400) : undefined;
    issues.push({ severity, category, message, suggestion });
  }
  return { overallAssessment: assessment, summary, issues };
}

export async function runCritiqueAgent(
  client: Anthropic,
  input: CritiqueAgentInput,
): Promise<RawCritique> {
  const primaryJson = (() => {
    try {
      return JSON.stringify(input.primaryOutput, null, 2).slice(0, 6000);
    } catch {
      return String(input.primaryOutput).slice(0, 6000);
    }
  })();
  const payloadJson = (() => {
    try {
      return JSON.stringify(input.payload, null, 2).slice(0, 3000);
    } catch {
      return String(input.payload).slice(0, 3000);
    }
  })();
  const memSlice = input.memoryContext ? input.memoryContext.slice(0, 4000) : "(none)";

  const userMsg = [
    `Primary handler: ${input.handler}`,
    "",
    "Request payload:",
    payloadJson,
    "",
    "Memory context that was in scope:",
    memSlice,
    "",
    "Primary handler output:",
    primaryJson,
    "",
    "Review the output per the categories in your system prompt. Return JSON only.",
  ].join("\n");

  const response = await client.messages.create({
    model: getModelForTier("light"),
    max_tokens: 1024,
    system: CRITIQUE_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const jsonStr = extractFirstJson(text);
  if (!jsonStr) {
    throw new Error(`[critique] failed to extract JSON from response: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(jsonStr);
  return sanitize(parsed);
}

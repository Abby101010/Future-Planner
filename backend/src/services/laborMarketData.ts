/* Labor-market data fetcher (stub).
 *
 * The methodology requires live data for job-search goals:
 *   - open-role count for the title in the target city
 *   - salary range for the role
 *   - top-5 most frequent skill requirements across JDs
 *   - target-company hiring cadence
 *
 * This module is the integration point. The live fetcher (web_search tool
 * use via Claude, Tavily, Exa, or a scraping provider) lands in a follow-up
 * session — today we return an empty shape so the planner prompt + the
 * downstream persistence path are wired end-to-end. Callers should check
 * `Object.keys(data).length > 0` before rendering anything provider-backed.
 *
 * Why a stub rather than nothing: the methodology's prompt-injection step
 * depends on this data flowing through funnel + T-skill framework prompts.
 * Keeping the call site in place means the only change in the follow-up
 * is swapping the implementation — no new schema, no planner rewire.
 */

import type { LaborMarketData } from "@starward/core";

export interface LaborMarketQuery {
  /** Specific role title (e.g. "Senior Product Manager"). */
  role: string;
  /** Target city or region (e.g. "San Francisco", "remote"). */
  location?: string;
  /** Optional industry filter (e.g. "fintech", "consumer"). */
  industry?: string;
  /** Company hints — if populated, the fetcher prioritizes these for
   *  hiring-cadence signals. */
  companies?: string[];
}

/** Fetch live labor-market data for a goal. Returns `{}` today.
 *
 *  Controlled by `STARWARD_LABOR_MARKET_ENABLED=1` — when unset (the
 *  default) this returns `{}` immediately without logging, so local
 *  dev and CI never hit an external network. */
export async function fetchLaborMarketData(
  query: LaborMarketQuery,
): Promise<LaborMarketData> {
  if (process.env.STARWARD_LABOR_MARKET_ENABLED !== "1") {
    return {};
  }

  // TODO(labor-market): pick a provider (Anthropic web_search tool, Tavily,
  // Exa, etc.) and replace this stub. When implementing, normalize to:
  //   { openRoleCount, salaryRange: { low, high, currency },
  //     topSkills: [...5], hiringCadence, fetchedAt: ISO }
  // Keep the call synchronous with the coordinator path — the coordinator
  // already runs research + personalization in parallel, so a 3-5s fetch
  // fits the existing latency budget.
  void query;
  return { fetchedAt: new Date().toISOString() };
}

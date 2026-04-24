/* Starward server — nudges repository
 *
 * Wraps `nudges` (migration 0002). Each row is an AI-generated contextual
 * prompt queued for the UI. `kind` maps 1:1 to ContextualNudge.type.
 * Actions and priority/context live in payload.
 *
 * @starward/core has a ContextualNudge type, but it uses `message` / `type`
 * while the DB columns are `body` / `kind` — this repo exposes a
 * DB-faithful NudgeRecord interface instead of forcing the core type on
 * callers. View resolvers can map NudgeRecord → ContextualNudge as needed.
 */

import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

export type NudgeKind =
  | "early_finish"
  | "snooze_probe"
  | "missed_deadline"
  | "dead_zone"
  | "overwhelm"
  | "streak"
  | "proactive"
  | "pace_warning";

export interface NudgeAction {
  label: string;
  feedbackValue: string;
  isPositive: boolean;
}

export interface NudgeRecord {
  id: string;
  kind: NudgeKind;
  title: string;
  body: string;
  surfacedAt: string;
  dismissedAt: string | null;
  priority: number;
  context: string;
  actions: NudgeAction[];
  /** Raw payload for fields that haven't earned a typed getter yet. */
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface NudgeRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  surfaced_at: string;
  dismissed_at: string | null;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

function rowToNudge(r: NudgeRow): NudgeRecord {
  const payload = parseJson(r.payload);
  return {
    id: r.id,
    kind: r.kind as NudgeKind,
    title: r.title,
    body: r.body,
    surfacedAt: r.surfaced_at,
    dismissedAt: r.dismissed_at,
    priority: (payload.priority as number) ?? 0,
    context: (payload.context as string) ?? "",
    actions: (payload.actions as NudgeAction[]) ?? [],
    payload,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function list(
  undismissedOnly = false,
): Promise<NudgeRecord[]> {
  const userId = requireUserId();
  if (undismissedOnly) {
    const rows = await query<NudgeRow>(
      `select * from nudges
        where user_id = $1 and dismissed_at is null
        order by surfaced_at desc`,
      [userId],
    );
    return rows.map(rowToNudge);
  }
  const rows = await query<NudgeRow>(
    `select * from nudges
      where user_id = $1
      order by surfaced_at desc`,
    [userId],
  );
  return rows.map(rowToNudge);
}

export async function get(id: string): Promise<NudgeRecord | null> {
  const userId = requireUserId();
  const rows = await query<NudgeRow>(
    `select * from nudges where user_id = $1 and id = $2`,
    [userId, id],
  );
  return rows.length > 0 ? rowToNudge(rows[0]) : null;
}

export interface InsertNudgeInput {
  id: string;
  kind: NudgeKind;
  title?: string;
  body: string;
  surfacedAt?: string;
  priority?: number;
  context?: string;
  actions?: NudgeAction[];
  /** Extra fields to stash in payload. */
  extra?: Record<string, unknown>;
}

export async function insert(nudge: InsertNudgeInput): Promise<void> {
  const userId = requireUserId();
  const payload: Record<string, unknown> = {
    ...(nudge.extra ?? {}),
    priority: nudge.priority ?? 0,
    context: nudge.context ?? "",
    actions: nudge.actions ?? [],
  };
  await query(
    `insert into nudges (
       id, user_id, kind, title, body, surfaced_at, payload, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
     on conflict (user_id, id) do update set
       kind = excluded.kind,
       title = excluded.title,
       body = excluded.body,
       surfaced_at = excluded.surfaced_at,
       payload = excluded.payload,
       updated_at = now()`,
    [
      nudge.id,
      userId,
      nudge.kind,
      nudge.title ?? "",
      nudge.body,
      nudge.surfacedAt ?? new Date().toISOString(),
      JSON.stringify(payload),
    ],
  );
}

export async function dismiss(id: string): Promise<void> {
  const userId = requireUserId();
  await query(
    `update nudges
        set dismissed_at = now(), updated_at = now()
      where user_id = $1 and id = $2`,
    [userId, id],
  );
}

export async function remove(id: string): Promise<void> {
  const userId = requireUserId();
  await query(`delete from nudges where user_id = $1 and id = $2`, [
    userId,
    id,
  ]);
}

export async function dismissByContext(context: string): Promise<void> {
  const userId = requireUserId();
  await query(
    `update nudges
        set dismissed_at = now(), updated_at = now()
      where user_id = $1
        and dismissed_at is null
        and payload->>'context' = $2`,
    [userId, context],
  );
}

export { remove as delete_ };

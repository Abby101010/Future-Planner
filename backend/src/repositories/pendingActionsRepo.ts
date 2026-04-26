/* Starward server — pending_actions repository
 *
 * Confirmation-card queue for AI-proposed mutations. The chat handler
 * writes pending rows; the user explicitly accepts (which fires the
 * underlying command) or rejects (which leaves state unchanged).
 *
 * Append-once-then-resolve: rows are inserted with status='pending'
 * and transition to 'accepted' / 'rejected' / 'expired' exactly once.
 * No further mutation after that — the row becomes part of the audit
 * trail.
 */

import { query } from "../db/pool";
import { requireUserId, EntityNotFoundError } from "./_context";
import { parseJson } from "./_json";

export type PendingActionStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "expired";

export interface PendingAction {
  id: string;
  intentKind: string;
  intentPayload: Record<string, unknown>;
  proposedSummary: string;
  status: PendingActionStatus;
  rejectionReason: string | null;
  proposedAt: string;
  resolvedAt: string | null;
  expiresAt: string;
  sessionId: string | null;
}

interface PendingActionRow {
  id: string;
  user_id: string;
  intent_kind: string;
  intent_payload: Record<string, unknown> | string | null;
  proposed_summary: string;
  status: string;
  rejection_reason: string | null;
  proposed_at: string;
  resolved_at: string | null;
  expires_at: string;
  session_id: string | null;
}

function rowToAction(r: PendingActionRow): PendingAction {
  return {
    id: r.id,
    intentKind: r.intent_kind,
    intentPayload: parseJson(r.intent_payload),
    proposedSummary: r.proposed_summary,
    status: r.status as PendingActionStatus,
    rejectionReason: r.rejection_reason,
    proposedAt: r.proposed_at,
    resolvedAt: r.resolved_at,
    expiresAt: r.expires_at,
    sessionId: r.session_id,
  };
}

export interface InsertPendingActionInput {
  id: string;
  intentKind: string;
  intentPayload: Record<string, unknown>;
  proposedSummary: string;
  sessionId?: string | null;
  /** Override the default 24h expiry. Used by tests; production callers
   *  let the column default apply. */
  expiresAt?: string;
}

export async function insert(input: InsertPendingActionInput): Promise<void> {
  const userId = requireUserId();
  if (input.expiresAt) {
    await query(
      `insert into pending_actions (
         id, user_id, intent_kind, intent_payload, proposed_summary,
         session_id, expires_at
       ) values ($1, $2, $3, $4::jsonb, $5, $6, $7)
       on conflict (user_id, id) do nothing`,
      [
        input.id,
        userId,
        input.intentKind,
        JSON.stringify(input.intentPayload),
        input.proposedSummary,
        input.sessionId ?? null,
        input.expiresAt,
      ],
    );
  } else {
    await query(
      `insert into pending_actions (
         id, user_id, intent_kind, intent_payload, proposed_summary,
         session_id
       ) values ($1, $2, $3, $4::jsonb, $5, $6)
       on conflict (user_id, id) do nothing`,
      [
        input.id,
        userId,
        input.intentKind,
        JSON.stringify(input.intentPayload),
        input.proposedSummary,
        input.sessionId ?? null,
      ],
    );
  }
}

export async function get(id: string): Promise<PendingAction | null> {
  const userId = requireUserId();
  const rows = await query<PendingActionRow>(
    `select * from pending_actions where user_id = $1 and id = $2`,
    [userId, id],
  );
  return rows.length > 0 ? rowToAction(rows[0]) : null;
}

/** Active = status 'pending' AND expires_at > now(). Sweep handles the
 *  rest. Sorted newest-first since the FE renders the most recent
 *  proposals at the top. */
export async function listActive(): Promise<PendingAction[]> {
  const userId = requireUserId();
  const rows = await query<PendingActionRow>(
    `select * from pending_actions
       where user_id = $1
         and status = 'pending'
         and expires_at > now()
       order by proposed_at desc`,
    [userId],
  );
  return rows.map(rowToAction);
}

/** Recently-rejected actions for a chat session — fed to the AI's next
 *  turn so it can react conversationally ("Understood, what would you
 *  prefer?"). Caps the lookback at the last 30 minutes / 5 entries to
 *  keep the prompt small. */
export async function listRecentRejectionsForSession(
  sessionId: string,
): Promise<PendingAction[]> {
  const userId = requireUserId();
  const rows = await query<PendingActionRow>(
    `select * from pending_actions
       where user_id = $1
         and session_id = $2
         and status = 'rejected'
         and resolved_at > now() - interval '30 minutes'
       order by resolved_at desc
       limit 5`,
    [userId, sessionId],
  );
  return rows.map(rowToAction);
}

export async function markAccepted(id: string): Promise<void> {
  const userId = requireUserId();
  const result = await query<{ id: string }>(
    `update pending_actions
        set status = 'accepted',
            resolved_at = now()
      where user_id = $1
        and id = $2
        and status = 'pending'
      returning id`,
    [userId, id],
  );
  if (result.length === 0) {
    throw new EntityNotFoundError("pending_action", id);
  }
}

export async function markRejected(
  id: string,
  reason?: string,
): Promise<void> {
  const userId = requireUserId();
  const result = await query<{ id: string }>(
    `update pending_actions
        set status = 'rejected',
            resolved_at = now(),
            rejection_reason = $3
      where user_id = $1
        and id = $2
        and status = 'pending'
      returning id`,
    [userId, id, reason ?? null],
  );
  if (result.length === 0) {
    throw new EntityNotFoundError("pending_action", id);
  }
}

/** Hourly sweep — mark stale pending rows as expired. Returns count
 *  for telemetry. Idempotent. */
export async function sweepExpired(): Promise<number> {
  const userId = requireUserId();
  const result = await query<{ id: string }>(
    `update pending_actions
        set status = 'expired',
            resolved_at = now()
      where user_id = $1
        and status = 'pending'
        and expires_at <= now()
      returning id`,
    [userId],
  );
  return result.length;
}

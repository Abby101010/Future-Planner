/* NorthStar server — chat repository
 *
 * Wraps BOTH the new `home_chat_messages` + `conversations` tables
 * (migration 0002) AND the legacy `chat_sessions` table (used by the
 * goal-plan chat and onboarding). We keep a single repo so callers have
 * one chat surface to reach for.
 *
 * Legacy SQL patterns are lifted from packages/server/src/routes/chat.ts —
 * we do not duplicate the attachments path since it's large and already
 * well-tested in-place; when the routes are cut over in Task 13/14 the
 * attachments SQL can move here next.
 */

import type { HomeChatMessage, ChatSession } from "@northstar/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

// ── Home chat messages (new table) ──────────────────────────────

interface HomeChatMessageRow {
  id: string;
  user_id: string;
  role: string;
  content: string;
  payload: Record<string, unknown> | string | null;
  created_at: string;
}

function rowToHomeMessage(r: HomeChatMessageRow): HomeChatMessage {
  const payload = parseJson(r.payload);
  return {
    id: r.id,
    role: r.role as HomeChatMessage["role"],
    content: r.content,
    pendingTaskId: payload.pendingTaskId as string | undefined,
    timestamp: r.created_at,
  };
}

export async function listHomeMessages(
  limit?: number,
): Promise<HomeChatMessage[]> {
  const userId = requireUserId();
  const cappedLimit =
    typeof limit === "number" && limit > 0 && limit <= 1000 ? limit : 200;
  const rows = await query<HomeChatMessageRow>(
    `select id, user_id, role, content, payload, created_at
       from home_chat_messages
      where user_id = $1
      order by created_at asc
      limit $2`,
    [userId, cappedLimit],
  );
  return rows.map(rowToHomeMessage);
}

export async function insertHomeMessage(msg: HomeChatMessage): Promise<void> {
  const userId = requireUserId();
  const payload: Record<string, unknown> = {};
  if (msg.pendingTaskId) payload.pendingTaskId = msg.pendingTaskId;
  await query(
    `insert into home_chat_messages (id, user_id, role, content, payload, created_at)
     values ($1, $2, $3, $4, $5::jsonb, $6)
     on conflict (user_id, id) do update set
       role = excluded.role,
       content = excluded.content,
       payload = excluded.payload`,
    [
      msg.id,
      userId,
      msg.role,
      msg.content,
      JSON.stringify(payload),
      msg.timestamp || new Date().toISOString(),
    ],
  );
}

export async function clearHome(): Promise<void> {
  const userId = requireUserId();
  await query(`delete from home_chat_messages where user_id = $1`, [userId]);
}

// ── Conversations index (new table) ─────────────────────────────

export type ConversationKind = "home" | "goal-plan" | "onboarding";

export interface ConversationRecord {
  id: string;
  kind: ConversationKind;
  title: string;
  lastMessageAt: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ConversationRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  last_message_at: string | null;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

function rowToConversation(r: ConversationRow): ConversationRecord {
  return {
    id: r.id,
    kind: r.kind as ConversationKind,
    title: r.title,
    lastMessageAt: r.last_message_at,
    payload: parseJson(r.payload),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listConversations(
  kind?: ConversationKind,
): Promise<ConversationRecord[]> {
  const userId = requireUserId();
  if (kind) {
    const rows = await query<ConversationRow>(
      `select * from conversations
        where user_id = $1 and kind = $2
        order by coalesce(last_message_at, updated_at) desc`,
      [userId, kind],
    );
    return rows.map(rowToConversation);
  }
  const rows = await query<ConversationRow>(
    `select * from conversations
      where user_id = $1
      order by coalesce(last_message_at, updated_at) desc`,
    [userId],
  );
  return rows.map(rowToConversation);
}

export async function getConversation(
  id: string,
): Promise<ConversationRecord | null> {
  const userId = requireUserId();
  const rows = await query<ConversationRow>(
    `select * from conversations where user_id = $1 and id = $2`,
    [userId, id],
  );
  return rows.length > 0 ? rowToConversation(rows[0]) : null;
}

export async function upsertConversation(conv: {
  id: string;
  kind: ConversationKind;
  title?: string;
  lastMessageAt?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into conversations (
       id, user_id, kind, title, last_message_at, payload, updated_at
     ) values ($1, $2, $3, $4, $5, $6::jsonb, now())
     on conflict (user_id, id) do update set
       kind = excluded.kind,
       title = excluded.title,
       last_message_at = excluded.last_message_at,
       payload = excluded.payload,
       updated_at = now()`,
    [
      conv.id,
      userId,
      conv.kind,
      conv.title ?? "",
      conv.lastMessageAt ?? null,
      JSON.stringify(conv.payload ?? {}),
    ],
  );
}

// ── Legacy chat_sessions (goal-plan chats live here today) ─────
// SQL patterns mirrored from packages/server/src/routes/chat.ts so behavior
// is byte-identical when routes are cut over.

interface ChatSessionRow {
  id: string;
  title: string;
  messages: unknown;
  created_at: string;
  updated_at: string;
}

function rowToChatSession(r: ChatSessionRow): ChatSession {
  const parsed =
    typeof r.messages === "string"
      ? (JSON.parse(r.messages) as HomeChatMessage[])
      : ((r.messages as HomeChatMessage[]) ?? []);
  return {
    id: r.id,
    title: r.title,
    messages: parsed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const userId = requireUserId();
  const rows = await query<ChatSessionRow>(
    `select id, title, messages, created_at, updated_at
       from chat_sessions
      where user_id = $1
      order by updated_at desc`,
    [userId],
  );
  return rows.map(rowToChatSession);
}

export async function getChatSession(
  id: string,
): Promise<ChatSession | null> {
  const userId = requireUserId();
  const rows = await query<ChatSessionRow>(
    `select id, title, messages, created_at, updated_at
       from chat_sessions
      where user_id = $1 and id = $2`,
    [userId, id],
  );
  return rows.length > 0 ? rowToChatSession(rows[0]) : null;
}

/** Append one message to a legacy chat_sessions.messages jsonb array.
 *  Mirrors the save-session path from routes/chat.ts: we fetch the current
 *  session, append, and write the whole array back. Callers wanting to
 *  replace the entire messages array should use saveChatSession. */
export async function appendChatSessionMessage(
  sessionId: string,
  message: HomeChatMessage,
): Promise<void> {
  const userId = requireUserId();
  const existing = await getChatSession(sessionId);
  const messages: HomeChatMessage[] = existing
    ? [...existing.messages, message]
    : [message];
  const title = existing?.title || "New chat";
  const createdAt = existing?.createdAt || new Date().toISOString();
  await query(
    `insert into chat_sessions (id, user_id, title, messages, created_at, updated_at)
          values ($1, $2, $3, $4::jsonb, $5, now())
     on conflict (user_id, id) do update set
          title = excluded.title,
          messages = excluded.messages,
          updated_at = now()`,
    [sessionId, userId, title, JSON.stringify(messages), createdAt],
  );
}

/** Replace the entire messages array for a chat session (used by goal-plan
 *  chat). Mirrors routes/chat.ts save-session. */
export async function saveChatSession(session: {
  id: string;
  title: string;
  messages: HomeChatMessage[];
  createdAt?: string;
  updatedAt?: string;
}): Promise<void> {
  const userId = requireUserId();
  const createdAt = session.createdAt || new Date().toISOString();
  const updatedAt = session.updatedAt || new Date().toISOString();
  await query(
    `insert into chat_sessions (id, user_id, title, messages, created_at, updated_at)
          values ($1, $2, $3, $4::jsonb, $5, $6)
     on conflict (user_id, id) do update set
          title = excluded.title,
          messages = excluded.messages,
          updated_at = excluded.updated_at`,
    [
      session.id,
      userId,
      session.title || "New chat",
      JSON.stringify(session.messages),
      createdAt,
      updatedAt,
    ],
  );
}

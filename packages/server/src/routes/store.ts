/* NorthStar server — store routes
 *
 * HTTP mirror of the Electron store:* IPC channels.
 * Translates electron/ipc/store.ts + electron/db/appStore.ts to Postgres,
 * scoped by req.userId.
 *
 * The renderer calls these as if they were IPC: the return shape must match
 * the IPC side byte-for-byte. See src/repositories/index.ts → appDataRepo.
 */

import { Router } from "express";
import { query, getPool } from "../db/pool";
import { asyncHandler } from "../middleware/errorHandler";

export const storeRouter = Router();

// POST /store/load — load the entire app snapshot for this user
//
// IPC equivalent: invoke("store:load") → Record<string, unknown>
// Returns the object directly (not wrapped in {ok,data}) to match IPC exactly.
storeRouter.post(
  "/load",
  asyncHandler(async (req, res) => {
    const rows = await query<{ key: string; value: unknown }>(
      "select key, value from app_store where user_id = $1",
      [req.userId],
    );
    const data: Record<string, unknown> = {};
    for (const row of rows) {
      // pg already parses jsonb, so row.value is the unmarshalled value
      data[row.key] = row.value;
    }
    res.json(data);
  }),
);

// POST /store/save — upsert every top-level key in the provided snapshot
//
// IPC equivalent: invoke("store:save", data) → { ok: true }
storeRouter.post(
  "/save",
  asyncHandler(async (req, res) => {
    const data = (req.body ?? {}) as Record<string, unknown>;
    // Run all upserts in a single transaction so a partial save never
    // leaves the store in an inconsistent state.
    const client = await getPool().connect();
    try {
      await client.query("begin");
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        await client.query(
          `insert into app_store (user_id, key, value)
           values ($1, $2, $3::jsonb)
           on conflict (user_id, key) do update set value = excluded.value`,
          [req.userId, key, JSON.stringify(value)],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }),
);

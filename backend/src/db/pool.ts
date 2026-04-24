/* Starward server — Postgres connection pool
 *
 * Replaces electron/db/connection.ts. Reads DATABASE_URL from env
 * (set via Fly secrets in production, .env in local dev).
 */

import { Pool, types } from "pg";
import type pg from "pg";

// By default, node-postgres converts `date` columns (OID 1082) to JS Date
// objects in UTC midnight. That object serializes to
// "2026-04-11T00:00:00.000Z" in res.json, which breaks every
// `log.date === "2026-04-11"` equality check in view resolvers and on
// the client. We don't use `date` for anything except YYYY-MM-DD keys,
// so override the parser to return the raw string the DB sends.
types.setTypeParser(1082, (v: string) => v);

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({
      connectionString,
      // Supabase pooled connections use pgbouncer — keep pool size small.
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 30_000,
      // Supabase requires SSL on every endpoint (direct *.supabase.co AND
      // pooler *.pooler.supabase.com). Match both with a single substring check.
      ssl: /supabase\.(co|com)/.test(connectionString)
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Convenience: parameterized query with typed result rows
export async function query<T = unknown>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(text, params as never);
  return result.rows as T[];
}

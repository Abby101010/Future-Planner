/* NorthStar server — Postgres connection pool
 *
 * Replaces electron/db/connection.ts. Reads DATABASE_URL from env
 * (set via Fly secrets in production, .env in local dev).
 */

import { Pool } from "pg";
import type pg from "pg";

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

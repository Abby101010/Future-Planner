/* NorthStar — generic DB query helpers (Postgres-compat shim) */

import Database from "better-sqlite3";
import { getDB } from "./connection";

function convertPgSql(sql: string): string {
  let s = sql;
  s = s.replace(/\$\d+/g, "?");
  s = s.replace(/::\w+/g, "");
  s = s.replace(/NOW\(\)/gi, "datetime('now')");
  return s;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const d = getDB();
  const stmt = d.prepare(convertPgSql(sql));
  return (params ? stmt.all(...params) : stmt.all()) as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const d = getDB();
  const stmt = d.prepare(convertPgSql(sql));
  const row = params ? stmt.get(...params) : stmt.get();
  return (row as T) ?? null;
}

export async function execute(
  sql: string,
  params?: unknown[],
): Promise<number> {
  const d = getDB();
  const stmt = d.prepare(convertPgSql(sql));
  const result = params ? stmt.run(...params) : stmt.run();
  return result.changes;
}

export async function transaction<T>(
  fn: (db: Database.Database) => T,
): Promise<T> {
  const d = getDB();
  const txn = d.transaction(() => fn(d));
  return txn();
}

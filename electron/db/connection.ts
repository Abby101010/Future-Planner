/* ──────────────────────────────────────────────────────────
   NorthStar — SQLite connection (singleton)

   Embedded database — no external server required.

   Data location: app.getPath('userData')/northstar.db
   macOS:   ~/Library/Application Support/NorthStar/northstar.db
   Windows: %APPDATA%/NorthStar/northstar.db
   Linux:   ~/.config/NorthStar/northstar.db
   ────────────────────────────────────────────────────────── */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

let db: Database.Database | null = null;

export function getDBPath(): string {
  const isDev = !app.isPackaged;
  const userDataPath = isDev
    ? path.join(app.getPath("userData"), "dev-data")
    : app.getPath("userData");
  fs.mkdirSync(userDataPath, { recursive: true });
  return path.join(userDataPath, "northstar.db");
}

export function getDB(): Database.Database {
  if (!db) {
    const dbPath = getDBPath();
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    console.log(`[DB] SQLite opened at ${dbPath}`);
  }
  return db;
}

export async function closePool(): Promise<void> {
  if (db) {
    db.close();
    db = null;
    console.log("[DB] SQLite closed");
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const d = getDB();
    const row = d.prepare("SELECT 1 AS ok").get() as
      | { ok: number }
      | undefined;
    return row?.ok === 1;
  } catch (err) {
    console.error("DB connection test failed:", err);
    return false;
  }
}

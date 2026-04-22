/* NorthStar server — versioned migration runner
 *
 * Usage:
 *   npm run migrate
 *
 * Reads all *.sql files in packages/server/migrations sorted lexically by
 * filename and applies any that haven't been recorded in schema_migrations.
 * Each migration runs inside a transaction. 0000_schema_migrations.sql
 * bootstraps the ledger table itself (idempotent via `if not exists`).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import "dotenv/config";
import { getPool, closePool } from "./pool";

const BOOTSTRAP_VERSION = "0000_schema_migrations";

function migrationsDir(): string {
  // Works from src/ (dev via tsx) and dist/src/ (production build):
  //   src/db/migrate.ts       → ../../migrations
  //   dist/src/db/migrate.js  → ../../migrations (relative to dist/src/db)
  // In production we COPY the migrations dir to packages/server/migrations,
  // so resolving ../../migrations from dist/src/db lands at
  // dist/migrations — which is wrong. Instead we walk up to the package root.
  // __dirname at runtime is either:
  //   <repo>/packages/server/src/db                (dev)
  //   <repo>/packages/server/dist/src/db           (prod)
  // From src/db: ../../migrations == packages/server/migrations ✓
  // From dist/src/db: ../../../migrations == packages/server/migrations ✓
  const fromSrc = resolve(__dirname, "../../migrations");
  const fromDist = resolve(__dirname, "../../../migrations");
  try {
    readdirSync(fromSrc);
    return fromSrc;
  } catch {
    return fromDist;
  }
}

export async function runMigrations(): Promise<void> {
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log("[migrate] Migrations dir:", dir);
  console.log("[migrate] Found", files.length, "migration file(s)");
  console.log(
    "[migrate] Target:",
    process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@"),
  );

  const pool = getPool();

  // Bootstrap: apply 0000 unconditionally (idempotent) so the ledger exists.
  const bootstrapFile = `${BOOTSTRAP_VERSION}.sql`;
  if (files.includes(bootstrapFile)) {
    const bootstrapSql = readFileSync(join(dir, bootstrapFile), "utf8");
    await pool.query(bootstrapSql);
  } else {
    throw new Error(
      `[migrate] Missing bootstrap migration: ${bootstrapFile} (in ${dir})`,
    );
  }

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");

    const existing = await pool.query<{ version: string }>(
      "select 1 from schema_migrations where version = $1",
      [version],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      console.log("[migrate] Skipping", version, "(already applied)");
      continue;
    }

    const sql = readFileSync(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into schema_migrations (version) values ($1)",
        [version],
      );
      await client.query("commit");
      console.log("[migrate] Applied", version);
    } catch (err) {
      await client.query("rollback");
      console.error("[migrate] Failed on", version, err);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log("[migrate] Done");
}

if (require.main === module) {
  runMigrations()
    .then(() => closePool())
    .catch(async (err) => {
      console.error(err);
      await closePool().catch(() => {});
      process.exit(1);
    });
}

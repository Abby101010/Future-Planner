/* NorthStar server — one-shot migration runner
 *
 * Usage:
 *   npm run migrate
 *
 * Reads schema.sql and runs it against DATABASE_URL. The schema is idempotent
 * (`create table if not exists`) so this can be re-run safely.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import "dotenv/config";
import { getPool, closePool } from "./pool";

async function main() {
  const schemaPath = join(__dirname, "schema.sql");

  console.log("[migrate] Reading schema from", schemaPath);
  const sql = readFileSync(schemaPath, "utf8");

  console.log("[migrate] Applying schema to", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@"));
  await getPool().query(sql);

  console.log("[migrate] Done");
  await closePool();
}

main().catch((err) => {
  console.error("[migrate] Failed:", err);
  process.exit(1);
});

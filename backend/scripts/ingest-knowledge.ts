/* NorthStar server — Knowledge-base ingestion CLI
 *
 * Usage:
 *   npm run ingest-knowledge
 *
 * Reads every *.md under packages/server/knowledge-base/, chunks + embeds
 * each file, and upserts into knowledge_chunks. Idempotent via the
 * (source, chunk_index) unique constraint.
 */

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import "dotenv/config";
import { closePool } from "../src/db/pool";
import { ingestMarkdownFile } from "../src/knowledge/ingest";

function knowledgeDir(): string {
  return resolve(__dirname, "../knowledge-base");
}

async function main(): Promise<void> {
  const dir = knowledgeDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) {
    console.log("[ingest] No markdown files in", dir);
    return;
  }

  console.log("[ingest] Knowledge dir:", dir);
  console.log("[ingest] Found", files.length, "markdown file(s)");
  console.log(
    "[ingest] Target:",
    process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@"),
  );

  // Voyage free-tier rate limit is 3 RPM. Pace files at ~25s apart so
  // the first request of each file clears the previous minute's budget.
  const PACE_MS = Number(process.env.INGEST_PACE_MS ?? 25_000);

  let hadFailure = false;
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const path = join(dir, file);
    if (i > 0 && PACE_MS > 0) {
      console.log(`[ingest] pacing ${PACE_MS}ms before ${file}…`);
      await new Promise((r) => setTimeout(r, PACE_MS));
    }
    try {
      const res = await ingestMarkdownFile(path);
      console.log(
        `[ingest] ${res.source}: inserted=${res.inserted} updated=${res.updated} deleted=${res.deleted} total=${res.total}`,
      );
    } catch (err) {
      hadFailure = true;
      console.error(`[ingest] FAILED ${file}:`, err);
    }
  }

  if (hadFailure) {
    throw new Error("One or more files failed to ingest");
  }
  console.log("[ingest] Done");
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error(err);
    await closePool().catch(() => {});
    process.exit(1);
  });

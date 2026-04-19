/* NorthStar server — Knowledge-base ingestion
 *
 * Reads a markdown file, chunks it on headings, embeds each chunk with Voyage
 * voyage-3-large, and upserts into knowledge_chunks keyed by
 * (source, chunk_index). Stale rows whose chunk_index no longer exists for
 * that source are deleted so re-running the ingest CLI after edits converges
 * cleanly.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { getPool } from "../db/pool";
import { chunkMarkdown } from "./chunker";
import { embedDocuments } from "./embeddings";

export type IngestResult = {
  source: string;
  inserted: number;
  updated: number;
  deleted: number;
  total: number;
};

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function ingestMarkdownFile(path: string): Promise<IngestResult> {
  const source = basename(path);
  const markdown = await readFile(path, "utf8");
  const chunks = chunkMarkdown(markdown, source);

  const pool = getPool();
  const client = await pool.connect();

  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  try {
    await client.query("BEGIN");

    if (chunks.length === 0) {
      const res = await client.query(
        "DELETE FROM knowledge_chunks WHERE source = $1",
        [source],
      );
      deleted = res.rowCount ?? 0;
      await client.query("COMMIT");
      return { source, inserted: 0, updated: 0, deleted, total: 0 };
    }

    const embeddings = await embedDocuments(chunks.map((c) => c.content));
    if (embeddings.length !== chunks.length) {
      throw new Error(
        `[knowledge] embedding count mismatch: got ${embeddings.length} for ${chunks.length} chunks`,
      );
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const embedding = embeddings[i]!;
      const res = await client.query<{ was_insert: boolean }>(
        `INSERT INTO knowledge_chunks (source, chunk_index, content, embedding, metadata)
         VALUES ($1, $2, $3, $4::vector, $5::jsonb)
         ON CONFLICT (source, chunk_index) DO UPDATE SET
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           metadata = EXCLUDED.metadata
         RETURNING (xmax = 0) AS was_insert`,
        [
          source,
          i,
          chunk.content,
          toVectorLiteral(embedding),
          JSON.stringify(chunk.metadata),
        ],
      );
      if (res.rows[0]?.was_insert) inserted++;
      else updated++;
    }

    const delRes = await client.query(
      "DELETE FROM knowledge_chunks WHERE source = $1 AND chunk_index >= $2",
      [source, chunks.length],
    );
    deleted = delRes.rowCount ?? 0;

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return { source, inserted, updated, deleted, total: chunks.length };
}

/* Starward server — RAG retrieval
 *
 * Embeds a query string with Voyage voyage-3-large and returns the top-K
 * cosine-similarity matches from knowledge_chunks. Optional metadata filter
 * maps to a Postgres `jsonb @>` containment check.
 */

import { query } from "../db/pool";
import { embedQuery } from "./embeddings";
import type { ChunkMetadata, MetadataFilter, RetrievedChunk } from "./index";

const DEFAULT_TOP_K = 4;

type Row = {
  content: string;
  metadata: ChunkMetadata;
  score: number;
};

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function retrieveRelevant(
  queryText: string,
  topK: number = DEFAULT_TOP_K,
  filter?: MetadataFilter,
): Promise<RetrievedChunk[]> {
  const trimmed = queryText.trim();
  if (!trimmed) return [];

  const embedding = await embedQuery(trimmed);
  const vec = toVectorLiteral(embedding);

  const params: unknown[] = [vec];
  let filterClause = "";
  if (filter && Object.keys(filter).length > 0) {
    params.push(JSON.stringify(filter));
    filterClause = `WHERE metadata @> $${params.length}::jsonb`;
  }
  params.push(topK);
  const limitParam = `$${params.length}`;

  const rows = await query<Row>(
    `SELECT
       content,
       metadata,
       1 - (embedding <=> $1::vector) AS score
     FROM knowledge_chunks
     ${filterClause}
     ORDER BY embedding <=> $1::vector
     LIMIT ${limitParam}`,
    params,
  );

  return rows.map((r) => ({
    content: r.content,
    metadata: r.metadata,
    score: Number(r.score),
  }));
}

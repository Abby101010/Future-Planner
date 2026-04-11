/* NorthStar — local semantic search over memory_preferences (hash-based embeddings + cosine) */

import { getDB } from "./connection";

export function generateTagEmbedding(tags: string[], text: string): number[] {
  const dim = 64;
  const vec = new Array(dim).fill(0);
  const tokens = [
    ...tags.map((t) => t.toLowerCase()),
    ...text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  ];
  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % dim;
    vec[idx] += hash > 0 ? 1 : -1;
  }
  const norm = Math.sqrt(
    vec.reduce((sum: number, v: number) => sum + v * v, 0),
  );
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm;
  }
  return vec;
}

export async function ensureVectorColumn(): Promise<void> {
  console.log("[DB] SQLite semantic search ready (local cosine similarity)");
}

export async function dbUpsertPreferenceWithEmbedding(
  id: string,
  text: string,
  tags: string[],
  weight: number,
  frequency: number,
  examples: string[],
): Promise<void> {
  const embedding = generateTagEmbedding(tags, text);
  const d = getDB();
  d.prepare(
    `INSERT INTO memory_preferences (id, text, tags, weight, frequency, examples, embedding)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       text=excluded.text, tags=excluded.tags, weight=excluded.weight,
       frequency=excluded.frequency, examples=excluded.examples,
       embedding=excluded.embedding, updated_at=datetime('now')`,
  ).run(
    id,
    text,
    JSON.stringify(tags),
    weight,
    frequency,
    JSON.stringify(examples),
    JSON.stringify(embedding),
  );
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function searchSimilarPreferences(
  queryTags: string[],
  queryText: string,
  limit: number = 10,
): Promise<
  Array<{
    id: string;
    text: string;
    tags: string[];
    weight: number;
    frequency: number;
    similarity: number;
  }>
> {
  const queryEmbedding = generateTagEmbedding(queryTags, queryText);
  const d = getDB();
  const rows = d
    .prepare(
      "SELECT id, text, tags, weight, frequency, embedding FROM memory_preferences WHERE embedding IS NOT NULL",
    )
    .all() as Array<{
    id: string;
    text: string;
    tags: string;
    weight: number;
    frequency: number;
    embedding: string;
  }>;

  const scored = rows
    .map((row) => {
      let tags: string[];
      try {
        tags = JSON.parse(row.tags);
      } catch {
        tags = [];
      }
      let embedding: number[];
      try {
        embedding = JSON.parse(row.embedding);
      } catch {
        return null;
      }
      return {
        id: row.id,
        text: row.text,
        tags,
        weight: row.weight,
        frequency: row.frequency,
        similarity: cosineSimilarity(queryEmbedding, embedding),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return scored;
}

export async function backfillPreferenceEmbeddings(): Promise<number> {
  const d = getDB();
  const prefs = d
    .prepare(
      "SELECT id, text, tags FROM memory_preferences WHERE embedding IS NULL",
    )
    .all() as Array<{ id: string; text: string; tags: string }>;

  let count = 0;
  const update = d.prepare(
    "UPDATE memory_preferences SET embedding = ? WHERE id = ?",
  );
  const txn = d.transaction(() => {
    for (const pref of prefs) {
      let tags: string[];
      try {
        tags = JSON.parse(pref.tags);
      } catch {
        tags = [];
      }
      const embedding = generateTagEmbedding(tags, pref.text);
      update.run(JSON.stringify(embedding), pref.id);
      count++;
    }
  });
  txn();
  return count;
}

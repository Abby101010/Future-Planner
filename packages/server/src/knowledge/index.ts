/* NorthStar server — Knowledge-base (RAG) barrel
 *
 * Retrieval-Augmented Generation layer. Methodology markdown lives in
 * packages/server/knowledge-base/*.md, is chunked on headings, embedded with
 * Voyage AI voyage-3-large (1024d), and stored in the global knowledge_chunks
 * table. Callers opt in via buildMemoryContext(..., retrievalQuery) — see
 * src/memory.ts. Retrieval never fails the AI request: errors are swallowed
 * and logged.
 */

export type ChunkMetadata = {
  source: string;
  headingPath: string[];
  charCount: number;
};

export type Chunk = {
  content: string;
  metadata: ChunkMetadata;
};

export type RetrievedChunk = Chunk & { score: number };

export type MetadataFilter = Partial<Record<keyof ChunkMetadata, unknown>>;

export { retrieveRelevant } from "./retrieve";
export { ingestMarkdownFile } from "./ingest";
export { chunkMarkdown } from "./chunker";

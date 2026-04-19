-- 0009: pgvector + global knowledge base for RAG.
--
-- Enables the vector extension and adds knowledge_chunks, a GLOBAL
-- (not user-scoped) table of embedded methodology chunks used by the
-- retrieval layer in src/knowledge. Embedding dim 1024 = Voyage AI
-- voyage-3-large. Chunks are upserted by (source, chunk_index) so
-- re-ingesting a markdown file is idempotent.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,
  chunk_index integer NOT NULL,
  content     text NOT NULL,
  embedding   vector(1024) NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, chunk_index)
);

-- Approximate nearest-neighbour index for cosine similarity search.
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
    ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- GIN index on metadata for @> filter queries.
CREATE INDEX IF NOT EXISTS knowledge_chunks_metadata_idx
    ON knowledge_chunks USING gin (metadata);

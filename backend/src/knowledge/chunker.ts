/* NorthStar server — Markdown chunker for RAG ingestion
 *
 * Heading-based split on `##` / `###`. If a section exceeds ~500 tokens
 * (approx 2000 chars at ~4 chars/token) it is re-split on blank-line
 * paragraph boundaries. Output chunks preserve their heading path so the
 * retrieval layer can show `[source#H1 > H2]` provenance.
 */

import type { Chunk } from "./index";

const MAX_CHUNK_CHARS = 2000;

type RawSection = {
  headingPath: string[];
  body: string;
};

function splitIntoSections(markdown: string): RawSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: RawSection[] = [];
  let h1: string | null = null;
  let h2: string | null = null;
  let h3: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body.length === 0) return;
    const path = [h1, h2, h3].filter((v): v is string => Boolean(v));
    sections.push({ headingPath: path, body });
  };

  for (const line of lines) {
    const h1m = /^#\s+(.+)$/.exec(line);
    const h2m = /^##\s+(.+)$/.exec(line);
    const h3m = /^###\s+(.+)$/.exec(line);

    if (h1m) {
      flush();
      buffer = [];
      h1 = h1m[1]!.trim();
      h2 = null;
      h3 = null;
      continue;
    }
    if (h2m) {
      flush();
      buffer = [];
      h2 = h2m[1]!.trim();
      h3 = null;
      continue;
    }
    if (h3m) {
      flush();
      buffer = [];
      h3 = h3m[1]!.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

function splitLongBody(body: string): string[] {
  if (body.length <= MAX_CHUNK_CHARS) return [body];
  const paragraphs = body.split(/\n\s*\n/);
  const out: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (current.length + trimmed.length + 2 > MAX_CHUNK_CHARS && current.length > 0) {
      out.push(current);
      current = trimmed;
    } else {
      current = current ? `${current}\n\n${trimmed}` : trimmed;
    }
  }
  if (current) out.push(current);
  return out;
}

export function chunkMarkdown(markdown: string, source: string): Chunk[] {
  const sections = splitIntoSections(markdown);
  const chunks: Chunk[] = [];
  for (const section of sections) {
    for (const piece of splitLongBody(section.body)) {
      const content = piece.trim();
      if (!content) continue;
      chunks.push({
        content,
        metadata: {
          source,
          headingPath: section.headingPath,
          charCount: content.length,
        },
      });
    }
  }
  return chunks;
}

/* Starward server — Voyage AI embedding wrapper
 *
 * Thin client around voyage-3-large (1024d). API key is read lazily from
 * VOYAGE_API_KEY so that server boot does not require the secret unless a
 * caller actually touches the retrieval layer (mirrors ai/client.ts).
 */

import { VoyageAIClient } from "voyageai";

const MODEL = "voyage-3-large";
const BATCH_SIZE = 128;

let client: VoyageAIClient | null = null;

function getClient(): VoyageAIClient {
  if (!client) {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      throw new Error("VOYAGE_API_KEY is not set on the server");
    }
    client = new VoyageAIClient({ apiKey });
  }
  return client;
}

function extractEmbeddings(result: unknown): number[][] {
  const data = (result as { data?: Array<{ embedding?: number[] }> }).data;
  if (!Array.isArray(data)) {
    throw new Error("[knowledge] Voyage response missing data array");
  }
  return data.map((row, i) => {
    if (!row || !Array.isArray(row.embedding)) {
      throw new Error(`[knowledge] Voyage response missing embedding at index ${i}`);
    }
    return row.embedding;
  });
}

export async function embedQuery(text: string): Promise<number[]> {
  const result = await getClient().embed({
    input: text,
    model: MODEL,
    inputType: "query",
  });
  const [embedding] = extractEmbeddings(result);
  if (!embedding) throw new Error("[knowledge] embedQuery returned no embedding");
  return embedding;
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const result = await getClient().embed({
      input: batch,
      model: MODEL,
      inputType: "document",
    });
    out.push(...extractEmbeddings(result));
  }
  return out;
}

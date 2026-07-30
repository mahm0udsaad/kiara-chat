/**
 * Retrieval for the auto-reply bot.
 *
 * Kiara's service catalogue already lives in the shared `knowledge_chunks`
 * table (225 chunks — massages, nails, facials, waxing, packages…), embedded by
 * the parent app with gemini-embedding-001 at 768 dimensions. We embed the
 * customer's question the same way and call the same `match_knowledge_chunks`
 * RPC, so both products answer from one corpus and nothing needs re-indexing.
 */
import { embed } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

/** The parent app names it GOOGLE_GEMINI_API_KEY; the SDK looks for its own. */
const API_KEY =
  process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

export function isBotConfigured(): boolean {
  return Boolean(API_KEY);
}

export const googleAI = createGoogleGenerativeAI({ apiKey: API_KEY ?? "" });

/** Matches the parent app's tuned threshold — below this, chunks drift off-topic. */
const MATCH_THRESHOLD = 0.55;
/** At/above this a chunk is a confident hit, so the bot may answer from it. */
export const STRONG_HIT = 0.65;
const MATCH_COUNT = 5;
/** The dimensionality the stored embeddings were written with. */
const EMBEDDING_DIMS = 768;

export interface Retrieved {
  /** Chunk text joined for the prompt. Empty when nothing cleared the bar. */
  context: string;
  /** Highest similarity in the result set — 0 when there were no hits. */
  topSimilarity: number;
}

export async function retrieveKnowledge(query: string): Promise<Retrieved> {
  if (!isBotConfigured() || !query.trim()) return { context: "", topSimilarity: 0 };

  let embedding: number[];
  try {
    const result = await embed({
      model: googleAI.embeddingModel("gemini-embedding-001"),
      value: query,
      providerOptions: { google: { outputDimensionality: EMBEDDING_DIMS } },
    });
    embedding = result.embedding;
  } catch {
    // Embedding outage — the caller falls back to a handoff rather than guessing.
    return { context: "", topSimilarity: 0 };
  }

  const { data, error } = await getAdminSupabaseClient().rpc("match_knowledge_chunks", {
    query_embedding: embedding,
    match_restaurant_id: KIARA_RESTAURANT_ID,
    match_count: MATCH_COUNT,
    match_threshold: MATCH_THRESHOLD,
  });
  if (error || !Array.isArray(data) || !data.length) {
    return { context: "", topSimilarity: 0 };
  }

  const rows = data as { content: string; similarity: number }[];
  return {
    context: rows.map((r) => r.content).join("\n\n"),
    topSimilarity: rows.reduce((max, r) => Math.max(max, Number(r.similarity) || 0), 0),
  };
}

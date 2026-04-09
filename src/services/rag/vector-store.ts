import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

export interface VectorChunk {
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface ScoredChunk {
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

/**
 * Insert document chunks with embeddings into the vector store.
 */
export async function insertChunks(
  serviceId: string,
  chunks: VectorChunk[],
): Promise<void> {
  if (chunks.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const chunk of chunks) {
      const embeddingStr = `[${chunk.embedding.join(',')}]`;
      await client.query(
        `INSERT INTO document_chunks (service_id, content, embedding, metadata)
         VALUES ($1, $2, $3::vector, $4)`,
        [serviceId, chunk.content, embeddingStr, JSON.stringify(chunk.metadata ?? {})],
      );
    }

    await client.query('COMMIT');

    logger.debug(
      { serviceId, count: chunks.length },
      'Inserted document chunks',
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Search for similar chunks using cosine similarity.
 */
export async function searchSimilar(
  serviceId: string,
  embedding: number[],
  topK = 5,
): Promise<ScoredChunk[]> {
  const embeddingStr = `[${embedding.join(',')}]`;

  const result = await pool.query<{
    content: string;
    metadata: Record<string, unknown>;
    score: number;
  }>(
    `SELECT content, metadata,
            1 - (embedding <=> $1::vector) AS score
     FROM document_chunks
     WHERE service_id = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [embeddingStr, serviceId, topK],
  );

  return result.rows.map((row) => ({
    content: row.content,
    metadata: row.metadata ?? {},
    score: Number(row.score),
  }));
}

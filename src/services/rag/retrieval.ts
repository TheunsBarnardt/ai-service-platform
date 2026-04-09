import { BaseService, type ServiceRecord } from '../base-service.js';
import { getProvider, getEmbeddingProvider, reportError, reportSuccess } from '../../providers/failover.js';
import { searchSimilar, type ScoredChunk } from './vector-store.js';
import { logger } from '../../utils/logger.js';

const RAG_SYSTEM_PROMPT = `You are a helpful assistant that answers questions based on the provided context.
Use ONLY the information from the context below to answer. If the context does not contain enough information, say so.
Do not make up information that is not in the context.`;

export class RetrievalService extends BaseService {
  async execute(
    service: ServiceRecord,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const query = input.query as string;
    if (!query) {
      throw new Error('Missing required field: query');
    }

    const topK = (input.top_k as number) ?? 5;

    // Step 1: Embed the query
    const embeddingProvider = getEmbeddingProvider();
    const embeddingResult = await embeddingProvider.embed(query);

    // Step 2: Search vector store
    const chunks = await searchSimilar(service.id, embeddingResult.embedding, topK);

    if (chunks.length === 0) {
      return {
        answer: 'No relevant documents found for this query.',
        sources: [],
        model: 'none',
        tokensInput: embeddingResult.tokensUsed,
        tokensOutput: 0,
        latencyMs: 0,
      };
    }

    // Step 3: Synthesize answer from chunks
    const contextBlock = chunks
      .map((c, i) => `[Source ${i + 1}] (score: ${c.score.toFixed(3)})\n${c.content}`)
      .join('\n\n');

    const provider = getProvider();

    try {
      const result = await provider.complete(
        [
          {
            role: 'user',
            content: `Context:\n${contextBlock}\n\nQuestion: ${query}`,
          },
        ],
        {
          systemPrompt: service.system_prompt ?? RAG_SYSTEM_PROMPT,
        },
      );

      reportSuccess(provider.name);

      logger.debug(
        { service: service.id, chunks: chunks.length, model: result.model },
        'RAG retrieval completed',
      );

      return {
        answer: result.content,
        sources: chunks.map((c) => ({ content: c.content, score: c.score })),
        model: result.model,
        tokensInput: result.tokensInput + embeddingResult.tokensUsed,
        tokensOutput: result.tokensOutput,
        latencyMs: result.latencyMs,
      };
    } catch (err) {
      reportError(provider.name);
      throw err;
    }
  }
}

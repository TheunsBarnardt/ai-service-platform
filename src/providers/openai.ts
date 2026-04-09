import OpenAI from 'openai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type {
  LLMProvider,
  ProviderMessage,
  CompletionOptions,
  CompletionResult,
  EmbeddingResult,
} from './interface.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 4096;
const EMBEDDING_MODEL = 'text-embedding-3-small';

export class OpenAIProvider implements LLMProvider {
  public readonly name = 'openai';
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.providers.openai.apiKey,
    });
  }

  async complete(
    messages: ProviderMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    const model = options.model ?? DEFAULT_MODEL;

    const chatMessages: OpenAI.ChatCompletionMessageParam[] = [];

    if (options.systemPrompt) {
      chatMessages.push({ role: 'system', content: options.systemPrompt });
    }

    for (const msg of messages) {
      // Skip system messages if we already added systemPrompt
      if (msg.role === 'system' && options.systemPrompt) continue;
      chatMessages.push({ role: msg.role, content: msg.content });
    }

    const start = Date.now();

    const response = await this.client.chat.completions.create({
      model,
      messages: chatMessages,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options.temperature,
    });

    const latencyMs = Date.now() - start;

    const content = response.choices[0]?.message?.content ?? '';
    const usage = response.usage;

    logger.debug(
      { model, tokensIn: usage?.prompt_tokens, tokensOut: usage?.completion_tokens, latencyMs },
      'OpenAI completion finished',
    );

    return {
      content,
      tokensInput: usage?.prompt_tokens ?? 0,
      tokensOutput: usage?.completion_tokens ?? 0,
      model,
      latencyMs,
    };
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const start = Date.now();

    const response = await this.client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });

    const latencyMs = Date.now() - start;

    const data = response.data[0];
    const tokensUsed = response.usage?.total_tokens ?? 0;

    logger.debug(
      { model: EMBEDDING_MODEL, tokensUsed, latencyMs },
      'OpenAI embedding finished',
    );

    return {
      embedding: data.embedding,
      model: EMBEDDING_MODEL,
      tokensUsed,
    };
  }
}

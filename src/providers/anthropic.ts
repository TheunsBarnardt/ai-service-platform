import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type {
  LLMProvider,
  ProviderMessage,
  CompletionOptions,
  CompletionResult,
  EmbeddingResult,
} from './interface.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicProvider implements LLMProvider {
  public readonly name = 'anthropic';
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: config.providers.anthropic.apiKey,
    });
  }

  async complete(
    messages: ProviderMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    const model = options.model ?? DEFAULT_MODEL;
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

    // Separate system prompt from messages
    const systemPrompt = options.systemPrompt
      ?? messages.find((m) => m.role === 'system')?.content;

    const nonSystemMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const start = Date.now();

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: options.temperature,
      system: systemPrompt,
      messages: nonSystemMessages,
    });

    const latencyMs = Date.now() - start;

    const content = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    logger.debug(
      { model, tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens, latencyMs },
      'Anthropic completion finished',
    );

    return {
      content,
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      model,
      latencyMs,
    };
  }

  async embed(_text: string): Promise<EmbeddingResult> {
    throw new Error(
      'Anthropic does not provide an embedding API. Use OpenAI provider for embeddings.',
    );
  }
}

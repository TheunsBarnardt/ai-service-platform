export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface CompletionResult {
  content: string;
  tokensInput: number;
  tokensOutput: number;
  model: string;
  latencyMs: number;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokensUsed: number;
}

export interface LLMProvider {
  name: string;
  complete(messages: ProviderMessage[], options?: CompletionOptions): Promise<CompletionResult>;
  embed(text: string): Promise<EmbeddingResult>;
}

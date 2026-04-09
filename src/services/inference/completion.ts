import { BaseService, type ServiceRecord } from '../base-service.js';
import { getProvider, reportError, reportSuccess } from '../../providers/failover.js';
import { selectModel } from './model-router.js';
import { logger } from '../../utils/logger.js';

export class CompletionService extends BaseService {
  async execute(
    service: ServiceRecord,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const prompt = input.prompt as string;
    if (!prompt) {
      throw new Error('Missing required field: prompt');
    }

    const context = input.context as string | undefined;
    const provider = getProvider();
    const model = selectModel(prompt, service.config);

    const messages = [];
    if (context) {
      messages.push({ role: 'user' as const, content: `Context:\n${context}` });
      messages.push({ role: 'assistant' as const, content: 'Understood, I have the context.' });
    }
    messages.push({ role: 'user' as const, content: prompt });

    try {
      const result = await provider.complete(messages, {
        model,
        systemPrompt: service.system_prompt ?? undefined,
      });

      reportSuccess(provider.name);

      logger.debug(
        { service: service.id, model: result.model, latencyMs: result.latencyMs },
        'Completion service executed',
      );

      return {
        response: result.content,
        model: result.model,
        confidence: 0.9,
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
        latencyMs: result.latencyMs,
      };
    } catch (err) {
      reportError(provider.name);
      throw err;
    }
  }
}

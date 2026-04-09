import { BaseService, type ServiceRecord } from '../base-service.js';
import { getProvider, reportError, reportSuccess } from '../../providers/failover.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_RUBRIC = `Score the following text on a scale of 0-100 based on:
- Clarity (0-25): Is the text clear and well-structured?
- Accuracy (0-25): Does the text contain factual and correct information?
- Completeness (0-25): Does the text cover the topic thoroughly?
- Coherence (0-25): Is the text logically consistent and well-connected?

Respond in JSON format:
{
  "score": <number 0-100>,
  "reasoning": "<brief explanation>",
  "criteria_scores": {
    "clarity": <number 0-25>,
    "accuracy": <number 0-25>,
    "completeness": <number 0-25>,
    "coherence": <number 0-25>
  }
}`;

export class ScorerService extends BaseService {
  async execute(
    service: ServiceRecord,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const text = input.text as string;
    if (!text) {
      throw new Error('Missing required field: text');
    }

    const rubric = (input.rubric as string) ?? DEFAULT_RUBRIC;
    const criteria = input.criteria as string[] | undefined;

    let scoringPrompt = rubric;
    if (criteria && criteria.length > 0) {
      scoringPrompt += `\n\nFocus specifically on these criteria: ${criteria.join(', ')}`;
    }

    const provider = getProvider();

    try {
      const result = await provider.complete(
        [
          {
            role: 'user',
            content: `Please evaluate the following text:\n\n---\n${text}\n---`,
          },
        ],
        {
          systemPrompt: scoringPrompt,
          temperature: 0.1,
        },
      );

      reportSuccess(provider.name);

      let parsed: Record<string, unknown>;
      try {
        // Extract JSON from response (may be wrapped in markdown code block)
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch {
        logger.warn('Failed to parse scorer response as JSON, returning raw');
        parsed = { score: 0, reasoning: result.content, criteria_scores: {} };
      }

      return {
        score: parsed.score ?? 0,
        reasoning: parsed.reasoning ?? '',
        criteria_scores: parsed.criteria_scores ?? {},
        model: result.model,
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

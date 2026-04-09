import OpenAI from 'openai';
import { config } from '../../config/index.js';
import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

const openai = new OpenAI({ apiKey: config.providers.openai.apiKey });

interface AbTestResult {
  winner: 'fine-tuned' | 'base' | 'tie';
  fineTunedScore: number;
  baseScore: number;
  improvementPct: number;
  sampleSize: number;
}

/**
 * Run an A/B test comparing a fine-tuned model against the base model.
 * Samples recent successful call inputs, runs them through both models,
 * and scores the outputs. If the fine-tuned model wins by >= 5%, recommend deployment.
 */
export async function runAbTest(
  serviceName: string,
  fineTunedModel: string,
  baseModel: string,
): Promise<AbTestResult> {
  const log = logger.child({ job: 'ab-test', serviceName, fineTunedModel, baseModel });
  log.info('Starting A/B test');

  // Get test inputs from recent successful calls
  const testInputs = await pool.query<{
    request_body: Record<string, unknown>;
    response_body: Record<string, unknown>;
    system_prompt: string | null;
  }>(
    `SELECT cl.request_body, cl.response_body, s.system_prompt
     FROM call_logs cl
     JOIN services s ON s.id = cl.service_id
     WHERE s.name = $1 AND cl.status = 'success'
     ORDER BY RANDOM()
     LIMIT 20`,
    [serviceName],
  );

  if (testInputs.rows.length < 5) {
    log.warn({ available: testInputs.rows.length }, 'Not enough test data for A/B test');
    return {
      winner: 'tie',
      fineTunedScore: 0,
      baseScore: 0,
      improvementPct: 0,
      sampleSize: testInputs.rows.length,
    };
  }

  let fineTunedTotal = 0;
  let baseTotal = 0;
  let evaluated = 0;

  for (const input of testInputs.rows) {
    try {
      const userContent = extractInput(input.request_body);
      if (!userContent) continue;

      const systemPrompt = input.system_prompt ?? 'You are a helpful assistant.';

      // Run through fine-tuned model
      const fineTunedResponse = await openai.chat.completions.create({
        model: fineTunedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: 1024,
      });

      // Run through base model
      const baseResponse = await openai.chat.completions.create({
        model: baseModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: 1024,
      });

      const fineTunedOutput = fineTunedResponse.choices[0]?.message?.content ?? '';
      const baseOutput = baseResponse.choices[0]?.message?.content ?? '';
      const expectedOutput = extractExpected(input.response_body);

      // Score both outputs against the expected output
      const ftScore = scoreOutput(fineTunedOutput, expectedOutput);
      const bScore = scoreOutput(baseOutput, expectedOutput);

      fineTunedTotal += ftScore;
      baseTotal += bScore;
      evaluated++;

      log.debug(
        { fineTunedScore: ftScore, baseScore: bScore },
        'Test case evaluated',
      );
    } catch (err) {
      log.error({ err }, 'Failed to evaluate test case');
    }
  }

  if (evaluated === 0) {
    log.warn('No test cases could be evaluated');
    return { winner: 'tie', fineTunedScore: 0, baseScore: 0, improvementPct: 0, sampleSize: 0 };
  }

  const fineTunedAvg = fineTunedTotal / evaluated;
  const baseAvg = baseTotal / evaluated;
  const improvementPct = baseAvg > 0 ? ((fineTunedAvg - baseAvg) / baseAvg) * 100 : 0;

  let winner: AbTestResult['winner'];
  if (improvementPct >= 5) {
    winner = 'fine-tuned';
  } else if (improvementPct <= -5) {
    winner = 'base';
  } else {
    winner = 'tie';
  }

  const result: AbTestResult = {
    winner,
    fineTunedScore: Number(fineTunedAvg.toFixed(3)),
    baseScore: Number(baseAvg.toFixed(3)),
    improvementPct: Number(improvementPct.toFixed(2)),
    sampleSize: evaluated,
  };

  log.info(result, 'A/B test complete');

  if (winner === 'fine-tuned') {
    log.info(
      { fineTunedModel, improvementPct: result.improvementPct },
      'Fine-tuned model recommended for deployment',
    );
  }

  return result;
}

function extractInput(body: Record<string, unknown>): string | null {
  if (typeof body.input === 'string') return body.input;
  if (typeof body.prompt === 'string') return body.prompt;
  if (typeof body.message === 'string') return body.message;
  if (typeof body.content === 'string') return body.content;
  return null;
}

function extractExpected(body: Record<string, unknown>): string {
  if (typeof body.output === 'string') return body.output;
  if (typeof body.result === 'string') return body.result;
  if (typeof body.content === 'string') return body.content;
  if (typeof body.text === 'string') return body.text;
  return '';
}

/**
 * Simple similarity scorer: compares output against expected output.
 * Returns a score between 0 and 1.
 * In production, this would use a more sophisticated evaluation (LLM-as-judge, BLEU, etc.).
 */
function scoreOutput(output: string, expected: string): number {
  if (!expected || !output) return 0.5; // No expected output, neutral score

  const outputTokens = new Set(output.toLowerCase().split(/\s+/));
  const expectedTokens = new Set(expected.toLowerCase().split(/\s+/));

  if (expectedTokens.size === 0) return 0.5;

  let overlap = 0;
  for (const token of expectedTokens) {
    if (outputTokens.has(token)) overlap++;
  }

  // Weighted: overlap ratio + length penalty
  const recall = overlap / expectedTokens.size;
  const precision = outputTokens.size > 0 ? overlap / outputTokens.size : 0;
  const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;

  return f1;
}

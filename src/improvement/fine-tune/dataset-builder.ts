import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface TrainingExample {
  messages: ChatMessage[];
}

/**
 * Build a JSONL dataset from successful call logs for fine-tuning.
 * Formats data in OpenAI fine-tuning format: {messages: [{role, content}]}
 * Returns the path to the generated temp file.
 */
export async function buildDataset(serviceType: string): Promise<string> {
  const log = logger.child({ job: 'dataset-builder', serviceType });
  log.info('Building fine-tuning dataset');

  const logsResult = await pool.query<{
    request_body: Record<string, unknown>;
    response_body: Record<string, unknown>;
    system_prompt: string | null;
  }>(
    `SELECT cl.request_body, cl.response_body, s.system_prompt
     FROM call_logs cl
     JOIN services s ON s.id = cl.service_id
     WHERE s.service_type = $1
       AND cl.status = 'success'
       AND cl.request_body IS NOT NULL
       AND cl.response_body IS NOT NULL
     ORDER BY cl.created_at DESC
     LIMIT 10000`,
    [serviceType],
  );

  if (logsResult.rows.length === 0) {
    throw new Error(`No training data available for service type: ${serviceType}`);
  }

  const lines: string[] = [];

  for (const row of logsResult.rows) {
    try {
      const messages: ChatMessage[] = [];

      // Add system prompt if available
      if (row.system_prompt) {
        messages.push({ role: 'system', content: row.system_prompt });
      }

      // Extract user input from request body
      const userContent = extractUserContent(row.request_body);
      if (!userContent) continue;
      messages.push({ role: 'user', content: userContent });

      // Extract assistant response from response body
      const assistantContent = extractAssistantContent(row.response_body);
      if (!assistantContent) continue;
      messages.push({ role: 'assistant', content: assistantContent });

      const example: TrainingExample = { messages };
      lines.push(JSON.stringify(example));
    } catch {
      // Skip malformed entries
      continue;
    }
  }

  if (lines.length === 0) {
    throw new Error(`No valid training examples could be extracted for: ${serviceType}`);
  }

  const filename = `ft-${serviceType}-${randomUUID()}.jsonl`;
  const filePath = join(tmpdir(), filename);
  await writeFile(filePath, lines.join('\n'), 'utf-8');

  log.info(
    { filePath, exampleCount: lines.length, totalRows: logsResult.rows.length },
    'Dataset built successfully',
  );

  return filePath;
}

function extractUserContent(requestBody: Record<string, unknown>): string | null {
  // Handle common request formats
  if (typeof requestBody.input === 'string') return requestBody.input;
  if (typeof requestBody.prompt === 'string') return requestBody.prompt;
  if (typeof requestBody.message === 'string') return requestBody.message;
  if (typeof requestBody.content === 'string') return requestBody.content;

  // Handle messages array format
  if (Array.isArray(requestBody.messages)) {
    const userMsg = requestBody.messages.find(
      (m: unknown) => typeof m === 'object' && m !== null && (m as Record<string, unknown>).role === 'user',
    ) as Record<string, unknown> | undefined;
    if (userMsg && typeof userMsg.content === 'string') return userMsg.content;
  }

  return null;
}

function extractAssistantContent(responseBody: Record<string, unknown>): string | null {
  if (typeof responseBody.output === 'string') return responseBody.output;
  if (typeof responseBody.result === 'string') return responseBody.result;
  if (typeof responseBody.content === 'string') return responseBody.content;
  if (typeof responseBody.text === 'string') return responseBody.text;

  // Handle choices array format (OpenAI-like)
  if (Array.isArray(responseBody.choices)) {
    const first = responseBody.choices[0] as Record<string, unknown> | undefined;
    if (first?.message && typeof (first.message as Record<string, unknown>).content === 'string') {
      return (first.message as Record<string, unknown>).content as string;
    }
  }

  return null;
}

import { z } from 'zod';

export const InvokeRequestBody = z.object({
  input: z.record(z.unknown()).describe('Service-specific input payload'),
  idempotency_key: z
    .string()
    .max(256)
    .optional()
    .describe('Optional idempotency key to prevent duplicate invocations'),
});

export type InvokeRequestBodyType = z.infer<typeof InvokeRequestBody>;

export const InvokeResponse = z.object({
  result: z.record(z.unknown()).describe('Service execution result'),
  confidence: z.number().min(0).max(1).optional().describe('Confidence score if applicable'),
  cost_cents: z.number().int().min(0).describe('Cost of the invocation in cents'),
  latency_ms: z.number().min(0).describe('Execution latency in milliseconds'),
  tokens_used: z.number().int().min(0).describe('Total tokens consumed'),
  model: z.string().describe('Model used for the invocation'),
  call_id: z.string().uuid().describe('Unique identifier for this invocation'),
});

export type InvokeResponseType = z.infer<typeof InvokeResponse>;

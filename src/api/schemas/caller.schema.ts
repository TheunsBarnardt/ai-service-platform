import { z } from 'zod';

export const RegisterCallerBodySchema = z.object({
  caller_type: z.enum(['mcp_client', 'api_direct', 'agent_framework', 'other_platform']),
  name: z.string().min(1).max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type RegisterCallerBody = z.infer<typeof RegisterCallerBodySchema>;

export const CallerResponseSchema = z.object({
  id: z.string().uuid(),
  caller_type: z.string(),
  name: z.string().nullable(),
  balance_cents: z.coerce.number(),
  total_calls: z.coerce.number(),
  tier: z.string(),
  reputation: z.number(),
  rate_limit_rpm: z.number(),
  created_at: z.string().datetime(),
});

export type CallerResponse = z.infer<typeof CallerResponseSchema>;

export const RegisterCallerResponseSchema = z.object({
  caller: CallerResponseSchema,
  api_key: z.string().describe('Plaintext API key, shown only once'),
});

export type RegisterCallerResponse = z.infer<typeof RegisterCallerResponseSchema>;

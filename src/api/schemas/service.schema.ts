import { z } from 'zod';

export const ServiceResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  service_type: z.string(),
  description: z.string().nullable(),
  input_schema: z.record(z.unknown()).nullable(),
  output_schema: z.record(z.unknown()).nullable(),
  price_cents: z.number().nullable(),
  quality_score: z.number(),
  latency_sla_ms: z.number(),
  registry_status: z.string(),
  is_active: z.boolean(),
});

export type ServiceResponse = z.infer<typeof ServiceResponseSchema>;

export const ServiceListQuerySchema = z.object({
  type: z.enum(['rag_retrieval', 'inference', 'tool_execution', 'orchestration', 'eval_scoring']).optional(),
  min_quality: z.coerce.number().int().min(0).max(100).optional(),
});

export type ServiceListQuery = z.infer<typeof ServiceListQuerySchema>;

import { z } from 'zod';

export const PaginationQuerySchema = z.object({
  limit: z
    .coerce.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum number of items to return'),
  cursor: z
    .string()
    .uuid()
    .optional()
    .describe('Cursor for pagination (UUID of last item)'),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().describe('Machine-readable error code'),
    message: z.string().describe('Human-readable error message'),
    status: z.number().int().describe('HTTP status code'),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const UUIDParamSchema = z.object({
  id: z.string().uuid().describe('Resource UUID'),
});

export type UUIDParam = z.infer<typeof UUIDParamSchema>;

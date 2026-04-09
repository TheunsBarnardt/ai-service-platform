import { z } from 'zod';

export const FundRequestBody = z.object({
  amount_cents: z
    .number()
    .int()
    .min(100, 'Minimum funding amount is $1.00 (100 cents)'),
});

export type FundRequestBodyType = z.infer<typeof FundRequestBody>;

export const FundResponse = z.object({
  payment_url: z.string(),
  payment_intent_id: z.string(),
});

export type FundResponseType = z.infer<typeof FundResponse>;

export const BalanceResponse = z.object({
  balance_cents: z.number().int(),
  total_calls: z.number().int(),
  tier: z.string(),
  discount_pct: z.number(),
});

export type BalanceResponseType = z.infer<typeof BalanceResponse>;

export const TransactionResponse = z.object({
  id: z.string().uuid(),
  type: z.string(),
  amount_cents: z.number().int(),
  balance_after: z.number().int().nullable(),
  description: z.string().nullable(),
  created_at: z.string(),
});

export type TransactionResponseType = z.infer<typeof TransactionResponse>;

export const TransactionsListResponse = z.object({
  transactions: z.array(TransactionResponse),
  next_cursor: z.string().uuid().nullable(),
  has_more: z.boolean(),
});

export type TransactionsListResponseType = z.infer<typeof TransactionsListResponse>;

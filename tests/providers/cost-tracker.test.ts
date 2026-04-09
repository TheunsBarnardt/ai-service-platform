import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCostCents } from '../../src/providers/cost-tracker.js';

describe('calculateCostCents', () => {
  it('calculates Claude Sonnet cost: 1000 input + 500 output tokens', () => {
    // Sonnet: $3.00/M input, $15.00/M output
    // Input:  (1000/1_000_000) * 3.0 = 0.003 dollars
    // Output: (500/1_000_000) * 15.0 = 0.0075 dollars
    // Total:  0.0105 dollars = 1.05 cents => ceil => 2 cents
    const cost = calculateCostCents('claude-sonnet-4-20250514', 1000, 500);
    assert.equal(cost, 2);
  });

  it('calculates GPT-4o-mini cost: 1000 input + 500 output tokens', () => {
    // GPT-4o-mini: $0.15/M input, $0.60/M output
    // Input:  (1000/1_000_000) * 0.15 = 0.00015 dollars
    // Output: (500/1_000_000) * 0.60  = 0.0003 dollars
    // Total:  0.00045 dollars = 0.045 cents => ceil => 1 cent
    const cost = calculateCostCents('gpt-4o-mini', 1000, 500);
    assert.equal(cost, 1);
  });

  it('calculates text-embedding-3-small cost', () => {
    // Embedding: $0.02/M input, $0/M output
    // Input: (1000/1_000_000) * 0.02 = 0.00002 dollars = 0.002 cents => ceil => 1 cent
    const cost = calculateCostCents('text-embedding-3-small', 1000, 0);
    assert.equal(cost, 1);
  });

  it('zero tokens returns 0 cents', () => {
    const cost = calculateCostCents('claude-sonnet-4-20250514', 0, 0);
    assert.equal(cost, 0);
  });

  it('all results are positive integers', () => {
    const cases: Array<[string, number, number]> = [
      ['claude-sonnet-4-20250514', 5000, 2000],
      ['claude-haiku-4-5-20251001', 10000, 5000],
      ['gpt-4o-mini', 50000, 10000],
      ['gpt-4o', 1000, 500],
      ['text-embedding-3-small', 100000, 0],
    ];

    for (const [model, tokIn, tokOut] of cases) {
      const cost = calculateCostCents(model, tokIn, tokOut);
      assert.ok(cost >= 0, `cost should be non-negative for ${model}`);
      assert.equal(Number.isInteger(cost), true, `cost should be integer for ${model}`);
    }
  });
});

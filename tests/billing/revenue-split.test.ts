import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRevenueSplit } from '../../src/billing/revenue-split.js';

describe('calculateRevenueSplit', () => {
  it('splits $1.00 (100 cents) correctly: 5+50+30+15 = 100', () => {
    const split = calculateRevenueSplit(100);

    assert.equal(split.ownerCents, 5);
    assert.equal(split.improvementCents, 50);
    assert.equal(split.computeCents, 30);
    assert.equal(split.reserveCents, 15);

    const total =
      split.ownerCents +
      split.improvementCents +
      split.computeCents +
      split.reserveCents;
    assert.equal(total, 100);
  });

  it('handles $0.01 (1 cent) — rounding edge case', () => {
    const split = calculateRevenueSplit(1);

    const total =
      split.ownerCents +
      split.improvementCents +
      split.computeCents +
      split.reserveCents;
    assert.equal(total, 1, 'sum must equal input even at 1 cent');
  });

  it('handles $0.10 (10 cents) — rounding', () => {
    const split = calculateRevenueSplit(10);

    const total =
      split.ownerCents +
      split.improvementCents +
      split.computeCents +
      split.reserveCents;
    assert.equal(total, 10, 'sum must equal input at 10 cents');
  });

  it('handles $100.00 (10000 cents)', () => {
    const split = calculateRevenueSplit(10000);

    assert.equal(split.ownerCents, 500);
    assert.equal(split.computeCents, 3000);
    assert.equal(split.reserveCents, 1500);
    assert.equal(split.improvementCents, 5000);

    const total =
      split.ownerCents +
      split.improvementCents +
      split.computeCents +
      split.reserveCents;
    assert.equal(total, 10000);
  });

  it('all values are integers', () => {
    for (const amount of [1, 3, 7, 10, 33, 99, 100, 999, 10000]) {
      const split = calculateRevenueSplit(amount);
      assert.equal(Number.isInteger(split.ownerCents), true, `ownerCents not integer for ${amount}`);
      assert.equal(Number.isInteger(split.improvementCents), true, `improvementCents not integer for ${amount}`);
      assert.equal(Number.isInteger(split.computeCents), true, `computeCents not integer for ${amount}`);
      assert.equal(Number.isInteger(split.reserveCents), true, `reserveCents not integer for ${amount}`);
    }
  });

  it('sum always equals input (no rounding loss)', () => {
    for (const amount of [1, 2, 3, 7, 10, 33, 99, 100, 101, 999, 10000, 12345]) {
      const split = calculateRevenueSplit(amount);
      const total =
        split.ownerCents +
        split.improvementCents +
        split.computeCents +
        split.reserveCents;
      assert.equal(total, amount, `rounding loss at ${amount} cents`);
    }
  });
});

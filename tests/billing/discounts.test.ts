import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDiscount, applyDiscount } from '../../src/billing/discounts.js';

describe('calculateDiscount', () => {
  it('0 calls returns 0% discount', () => {
    assert.equal(calculateDiscount(0), 0);
  });

  it('99 calls returns 0% discount', () => {
    assert.equal(calculateDiscount(99), 0);
  });

  it('100 calls returns 15% discount', () => {
    assert.equal(calculateDiscount(100), 15);
  });

  it('999 calls returns 15% discount', () => {
    assert.equal(calculateDiscount(999), 15);
  });

  it('1000 calls returns 30% discount', () => {
    assert.equal(calculateDiscount(1000), 30);
  });

  it('10000 calls returns 50% discount', () => {
    assert.equal(calculateDiscount(10000), 50);
  });
});

describe('applyDiscount', () => {
  it('applies 15% discount: applyDiscount(100, 15) returns 85', () => {
    assert.equal(applyDiscount(100, 15), 85);
  });

  it('applies 50% discount: applyDiscount(100, 50) returns 50', () => {
    assert.equal(applyDiscount(100, 50), 50);
  });

  it('floors the result: applyDiscount(1, 50) returns 0', () => {
    assert.equal(applyDiscount(1, 50), 0);
  });
});

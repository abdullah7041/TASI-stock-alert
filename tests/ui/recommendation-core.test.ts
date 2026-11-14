import { expect, test } from 'vitest';
import { recommendationAction } from '@/app/lib/recommendation-core';

test('recommendations distinguish ownership, deteriorating cases, and missing evidence', () => {
  const decide = recommendationAction;
  expect(decide(true,'supported','favorable','passed')).toBe('ADD');
  expect(decide(false,'supported','favorable','passed')).toBe('BUY');
  expect(decide(true,'supported','unresolved','unavailable')).toBe('HOLD');
  expect(decide(true,'weakened','unresolved','unavailable')).toBe('REDUCE');
  expect(decide(true,'invalidated','unresolved','unavailable')).toBe('SELL');
  expect(decide(false,'supported','unfavorable','passed')).toBe('WATCH');
  expect(decide(false,'supported','unresolved','unavailable')).toBeNull();
  expect(decide(true,'unresolved','favorable','passed')).toBeNull();
});

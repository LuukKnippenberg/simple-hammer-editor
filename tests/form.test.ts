import { describe, expect, it } from 'vitest';
import { typedNumber } from '../src/ui/form.ts';

describe('typed numbers in the option sheets', () => {
  it('a seed (min 1) typed as 0 or below becomes 1', () => {
    expect(typedNumber('-5', 1, Infinity)).toBe(1);
    expect(typedNumber('0', 1, Infinity)).toBe(1);
    expect(typedNumber('', 1, Infinity)).toBe(1);
    expect(typedNumber('abc', 1, Infinity)).toBe(1);
    expect(typedNumber('42', 1, Infinity)).toBe(42);
  });

  it('is clamped to min..max', () => {
    expect(typedNumber('50', 1, 12)).toBe(12);
    expect(typedNumber('64', 96, 128)).toBe(96);
    expect(typedNumber('104', 96, 128)).toBe(104);
  });
});

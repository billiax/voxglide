import { describe, it, expect } from 'vitest';
import { simpleHash } from '../../src/utils/hash';

describe('simpleHash', () => {
  it('returns a number', () => {
    expect(typeof simpleHash('hello')).toBe('number');
  });

  it('returns deterministic output for the same input', () => {
    const a = simpleHash('test string');
    const b = simpleHash('test string');
    expect(a).toBe(b);
  });

  it('returns different hashes for different inputs', () => {
    const a = simpleHash('hello');
    const b = simpleHash('world');
    expect(a).not.toBe(b);
  });

  it('returns 0 for empty string', () => {
    expect(simpleHash('')).toBe(0);
  });

  it('handles single character', () => {
    const result = simpleHash('a');
    expect(typeof result).toBe('number');
    expect(result).not.toBe(0);
  });

  it('handles long strings', () => {
    const long = 'x'.repeat(10000);
    const result = simpleHash(long);
    expect(typeof result).toBe('number');
  });

  it('produces integer results (bitwise OR with 0)', () => {
    const result = simpleHash('test');
    expect(Number.isInteger(result)).toBe(true);
  });
});

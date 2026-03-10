import { describe, it, expect } from 'vitest';
import { TokenBudget } from '../../src/context/TokenBudget';

describe('TokenBudget', () => {
  it('estimates tokens from text length', () => {
    const budget = new TokenBudget(1000);
    expect(budget.estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75 → 3
    expect(budget.estimateTokens('')).toBe(0);
    expect(budget.estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('includes all sections when within budget', () => {
    const budget = new TokenBudget(10000);
    const sections = [
      { name: 'A', content: 'Short section A', priority: 5 },
      { name: 'B', content: 'Short section B', priority: 3 },
      { name: 'C', content: 'Short section C', priority: 8 },
    ];

    const result = budget.allocate(sections);
    expect(result).toHaveLength(3);
    // Should be sorted by priority desc: C, A, B
    expect(result[0].name).toBe('C');
    expect(result[1].name).toBe('A');
    expect(result[2].name).toBe('B');
  });

  it('drops low priority sections when over budget', () => {
    // 100 tokens max = 400 chars
    const budget = new TokenBudget(100);
    const sections = [
      { name: 'high', content: 'H'.repeat(200), priority: 10 },  // 50 tokens
      { name: 'medium', content: 'M'.repeat(200), priority: 5 }, // 50 tokens
      { name: 'low', content: 'L'.repeat(200), priority: 1 },    // 50 tokens (won't fit)
    ];

    const result = budget.allocate(sections);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.name)).toEqual(['high', 'medium']);
  });

  it('truncates last fitting section if it exceeds remaining budget', () => {
    // 200 tokens max = 800 chars
    const budget = new TokenBudget(200);
    const sections = [
      { name: 'first', content: 'F'.repeat(200), priority: 10 },  // 50 tokens
      { name: 'second', content: 'S'.repeat(1000), priority: 5 }, // 250 tokens (too many, truncated)
    ];

    const result = budget.allocate(sections);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('first');
    expect(result[1].name).toBe('second');
    // Second should be truncated: 150 remaining tokens * 4 = 600 chars
    expect(result[1].content.length).toBe(600);
  });

  it('skips tiny remaining budgets (less than 50 tokens)', () => {
    // Budget of 55 tokens, first section takes 50
    const budget = new TokenBudget(55);
    const sections = [
      { name: 'big', content: 'B'.repeat(200), priority: 10 }, // 50 tokens
      { name: 'small', content: 'S'.repeat(100), priority: 1 }, // would need 25 tokens, but only 5 left, skip since < 50
    ];

    const result = budget.allocate(sections);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('big');
  });

  it('respects priority ordering', () => {
    const budget = new TokenBudget(10000);
    const sections = [
      { name: 'low', content: 'Low', priority: 1 },
      { name: 'high', content: 'High', priority: 10 },
      { name: 'mid', content: 'Mid', priority: 5 },
    ];

    const result = budget.allocate(sections);
    expect(result[0].name).toBe('high');
    expect(result[1].name).toBe('mid');
    expect(result[2].name).toBe('low');
  });

  it('returns empty for empty input', () => {
    const budget = new TokenBudget(1000);
    expect(budget.allocate([])).toEqual([]);
  });

  it('returns max tokens from getter', () => {
    const budget = new TokenBudget(5000);
    expect(budget.getMaxTokens()).toBe(5000);
  });
});

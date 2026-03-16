import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextCache } from '../../src/context/ContextCache';
import type { PageContext } from '../../src/types';

function makeContext(title = 'Test'): PageContext {
  return {
    title,
    description: '',
    url: 'https://example.com',
    forms: [],
    headings: [],
    navigation: [],
    content: '',
    interactiveElements: [],
  };
}

describe('ContextCache', () => {
  let cache: ContextCache;

  beforeEach(() => {
    cache = new ContextCache(60000);
    try { sessionStorage.clear(); } catch { /* ignore */ }
  });

  it('returns null for cache miss', () => {
    expect(cache.get('https://example.com', 'fp1')).toBeNull();
  });

  it('returns cached context on hit', () => {
    const ctx = makeContext('Cached Page');
    cache.set('https://example.com', 'fp1', ctx);

    const result = cache.get('https://example.com', 'fp1');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Cached Page');
  });

  it('returns null when fingerprint changes', () => {
    cache.set('https://example.com', 'fp1', makeContext());
    expect(cache.get('https://example.com', 'fp2')).toBeNull();
  });

  it('returns null when entry expires', () => {
    // Create cache with 100ms TTL
    const shortCache = new ContextCache(100);
    shortCache.set('https://example.com', 'fp1', makeContext());

    // Advance time
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);

    expect(shortCache.get('https://example.com', 'fp1')).toBeNull();
    vi.useRealTimers();
  });

  it('invalidates specific URL', () => {
    cache.set('https://a.com', 'fp1', makeContext('A'));
    cache.set('https://b.com', 'fp2', makeContext('B'));

    cache.invalidate('https://a.com');

    expect(cache.get('https://a.com', 'fp1')).toBeNull();
    expect(cache.get('https://b.com', 'fp2')).not.toBeNull();
  });

  it('invalidates all entries', () => {
    cache.set('https://a.com', 'fp1', makeContext('A'));
    cache.set('https://b.com', 'fp2', makeContext('B'));

    cache.invalidate();

    expect(cache.get('https://a.com', 'fp1')).toBeNull();
    expect(cache.get('https://b.com', 'fp2')).toBeNull();
  });

  it('reports correct size', () => {
    expect(cache.size()).toBe(0);
    cache.set('https://a.com', 'fp1', makeContext());
    expect(cache.size()).toBe(1);
    cache.set('https://b.com', 'fp2', makeContext());
    expect(cache.size()).toBe(2);
  });

  it('saves and loads from sessionStorage', () => {
    cache.set('https://example.com', 'fp1', makeContext('Stored'));
    cache.saveToStorage();

    // Create a new cache and load
    const newCache = new ContextCache(60000);
    newCache.loadFromStorage();

    const result = newCache.get('https://example.com', 'fp1');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Stored');
  });

  it('ignores expired entries when loading from storage', () => {
    vi.useFakeTimers();

    const shortCache = new ContextCache(100);
    shortCache.set('https://example.com', 'fp1', makeContext());
    shortCache.saveToStorage();

    vi.advanceTimersByTime(200);

    const newCache = new ContextCache(100);
    newCache.loadFromStorage();

    expect(newCache.size()).toBe(0);
    vi.useRealTimers();
  });

  it('handles empty or invalid sessionStorage gracefully', () => {
    sessionStorage.setItem('vsdk-context-cache', 'invalid json');

    const newCache = new ContextCache();
    expect(() => newCache.loadFromStorage()).not.toThrow();
    expect(newCache.size()).toBe(0);
  });
});

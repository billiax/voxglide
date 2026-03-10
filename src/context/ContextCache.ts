import type { PageContext } from '../types';

interface CacheEntry {
  url: string;
  fingerprint: string;
  context: PageContext;
  timestamp: number;
}

const STORAGE_KEY = 'vsdk-context-cache';

/**
 * Caches page context results by URL + fingerprint.
 * Persists to sessionStorage for cross-navigation reuse.
 */
export class ContextCache {
  private cache = new Map<string, CacheEntry>();
  private maxAge: number;

  constructor(maxAgeMs = 60000) {
    this.maxAge = maxAgeMs;
  }

  get(url: string, fingerprint: string): PageContext | null {
    const entry = this.cache.get(url);
    if (!entry) return null;
    if (entry.fingerprint !== fingerprint) return null;
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(url);
      return null;
    }
    return entry.context;
  }

  set(url: string, fingerprint: string, context: PageContext): void {
    this.cache.set(url, {
      url,
      fingerprint,
      context,
      timestamp: Date.now(),
    });
  }

  invalidate(url?: string): void {
    if (url) {
      this.cache.delete(url);
    } else {
      this.cache.clear();
    }
  }

  saveToStorage(): void {
    try {
      const entries = Array.from(this.cache.entries());
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // sessionStorage may be full or disabled
    }
  }

  loadFromStorage(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const entries: Array<[string, CacheEntry]> = JSON.parse(raw);
      const now = Date.now();
      for (const [key, entry] of entries) {
        if (now - entry.timestamp < this.maxAge) {
          this.cache.set(key, entry);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  size(): number {
    return this.cache.size;
  }
}

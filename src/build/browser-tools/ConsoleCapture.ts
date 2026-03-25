export interface CapturedLogEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  args: string[];
  timestamp: number;
}

type ConsoleMethod = 'log' | 'warn' | 'error' | 'info';
const CAPTURED_METHODS: ConsoleMethod[] = ['log', 'warn', 'error', 'info'];

/**
 * Buffers console output while build mode is active.
 * Monkey-patches console methods on activate, restores originals on deactivate.
 * Provides snapshot cursors so EvaluateJSTool can isolate output from a single eval.
 */
export class ConsoleCapture {
  private buffer: CapturedLogEntry[] = [];
  private originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
  private active = false;
  private maxEntries: number;

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  activate(): void {
    if (this.active) return;
    this.active = true;

    for (const method of CAPTURED_METHODS) {
      this.originals.set(method, console[method].bind(console));

      console[method] = (...args: unknown[]) => {
        this.push(method, args);
        // Forward to real console
        this.originals.get(method)!(...args);
      };
    }
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;

    for (const method of CAPTURED_METHODS) {
      const original = this.originals.get(method);
      if (original) {
        console[method] = original as typeof console.log;
      }
    }
    this.originals.clear();
  }

  isActive(): boolean {
    return this.active;
  }

  /** Returns a cursor (buffer length) for use with getEntriesSince(). */
  snapshot(): number {
    return this.buffer.length;
  }

  /** Get entries added after the given snapshot cursor. */
  getEntriesSince(cursor: number): CapturedLogEntry[] {
    return this.buffer.slice(cursor);
  }

  /** Get all entries, optionally filtered by timestamp. */
  getEntries(sinceMs?: number): CapturedLogEntry[] {
    if (sinceMs !== undefined) {
      return this.buffer.filter(e => e.timestamp >= sinceMs);
    }
    return [...this.buffer];
  }

  clear(): void {
    this.buffer = [];
  }

  private push(level: ConsoleMethod, args: unknown[]): void {
    this.buffer.push({
      level,
      args: args.map(a => {
        try {
          return typeof a === 'string' ? a : JSON.stringify(a);
        } catch {
          return String(a);
        }
      }),
      timestamp: Date.now(),
    });

    // Ring buffer: evict oldest when full
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
    }
  }
}

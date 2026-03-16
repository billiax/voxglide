/**
 * Typed EventEmitter for the Voice SDK.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface EventMap {
  [key: string]: unknown;
}

type Handler<T> = T extends void ? () => void : (data: T) => void;

export class EventEmitter<Events extends EventMap = EventMap> {
  private listeners = new Map<keyof Events, Set<Handler<unknown>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as Handler<unknown>);
    return this;
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): this {
    this.listeners.get(event)?.delete(handler as Handler<unknown>);
    return this;
  }

  emit<K extends keyof Events>(
    event: K,
    ...args: Events[K] extends void ? [] : [Events[K]]
  ): boolean {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) return false;
    for (const handler of handlers) {
      try {
        (handler as (...a: unknown[]) => void)(...args);
      } catch (err) {
        console.error(`[VoiceSDK] Error in "${String(event)}" handler:`, err);
      }
    }
    return true;
  }

  removeAllListeners(event?: keyof Events): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
}

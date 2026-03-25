export interface CapturedNetworkEntry {
  url: string;
  initiatorType: string;
  duration: number;
  transferSize: number;
  startTime: number;
  responseStatus: number;
}

/**
 * Records network requests via PerformanceObserver (Resource Timing API).
 * Non-invasive — does not patch fetch or XMLHttpRequest.
 */
export class NetworkMonitor {
  private observer: PerformanceObserver | null = null;
  private buffer: CapturedNetworkEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  activate(): void {
    if (this.observer) return;
    if (typeof PerformanceObserver === 'undefined') return;

    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming;
        this.buffer.push({
          url: resource.name,
          initiatorType: resource.initiatorType,
          duration: Math.round(resource.duration),
          transferSize: resource.transferSize || 0,
          startTime: Math.round(resource.startTime),
          responseStatus: (resource as any).responseStatus ?? 0,
        });

        if (this.buffer.length > this.maxEntries) {
          this.buffer.shift();
        }
      }
    });

    try {
      this.observer.observe({ type: 'resource', buffered: false });
    } catch {
      // PerformanceObserver not supported or type not available
      this.observer = null;
    }
  }

  deactivate(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  isActive(): boolean {
    return this.observer !== null;
  }

  getEntries(sinceMs?: number): CapturedNetworkEntry[] {
    if (sinceMs !== undefined) {
      return this.buffer.filter(e => e.startTime >= sinceMs);
    }
    return [...this.buffer];
  }

  clear(): void {
    this.buffer = [];
  }
}

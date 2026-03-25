/**
 * FunctionLoader — auto-loads nbt_functions from the VoxGlide proxy server.
 *
 * Lifecycle:
 *   1. Constructor: derives HTTP endpoint from serverUrl
 *   2. load(): called eagerly in VoiceSDK constructor (non-blocking)
 *   3. reload(): called on SPA navigation — aborts any in-flight request,
 *      skips if the URL still resolves to the same match set
 *
 * Design decisions:
 *   - Single in-flight request: concurrent calls share the same promise or
 *     abort the previous one (for navigation where the URL changed).
 *   - Never blocks start(): VoiceSDK.start() does NOT await this — functions
 *     arrive via NbtFunctionsProvider.sync() → context update to server.
 *   - Ownership tracking: only deletes functions it loaded — functions from
 *     build mode (current session) or external scripts are untouched.
 *   - Match-pattern caching: skips re-fetch if the URL matches the same
 *     server patterns as the last load.
 */
export class FunctionLoader {
  private serverHttpUrl: string;
  private debug: boolean;
  private loaded = false;

  /** Names of functions this loader owns (set by the last successful load). */
  private ownedNames = new Set<string>();

  /** The URL pathname used for the last successful load. */
  private lastLoadedPath: string | null = null;

  /** AbortController for the current in-flight fetch. */
  private abortController: AbortController | null = null;

  /** Shared promise for deduplicating concurrent load() calls for the same path. */
  private inflightPromise: Promise<string[]> | null = null;
  private inflightPath: string | null = null;

  constructor(serverWsUrl: string, debug?: boolean) {
    this.serverHttpUrl = serverWsUrl
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:')
      .replace(/\/+$/, '');
    this.debug = debug ?? false;
  }

  /**
   * Load functions for the current page URL.
   * Deduplicates: if a load for the same path is already in-flight, returns that promise.
   * Non-blocking — safe to fire-and-forget.
   */
  load(): Promise<string[]> {
    const path = window.location.pathname;

    // Deduplicate: reuse in-flight request for the same path
    if (this.inflightPromise && this.inflightPath === path) {
      return this.inflightPromise;
    }

    // New path while another request is in-flight — abort the old one
    if (this.abortController) {
      this.abortController.abort();
    }

    this.inflightPath = path;
    this.inflightPromise = this.fetchAndApply(path).finally(() => {
      // Clear in-flight state only if this is still the current request
      if (this.inflightPath === path) {
        this.inflightPromise = null;
        this.inflightPath = null;
      }
    });

    return this.inflightPromise;
  }

  /**
   * Reload for a new URL (SPA navigation).
   * Skips the fetch if the pathname hasn't changed since last successful load.
   */
  reload(): Promise<string[]> {
    const path = window.location.pathname;
    if (this.lastLoadedPath === path) {
      if (this.debug) {
        console.log(`[VoiceSDK:loader] Skipping reload — same path: ${path}`);
      }
      return Promise.resolve([]);
    }
    return this.load();
  }

  /** Whether at least one successful load has completed. */
  isLoaded(): boolean {
    return this.loaded;
  }

  /** Wait for any in-flight load to settle (used by start() to ensure tools are ready). */
  ready(): Promise<void> {
    if (this.inflightPromise) {
      return this.inflightPromise.then(() => {});
    }
    return Promise.resolve();
  }

  /** Invalidate cache so the next load() re-fetches even for the same path. */
  invalidate(): void {
    this.lastLoadedPath = null;
  }

  // ── Internal ──

  private async fetchAndApply(path: string): Promise<string[]> {
    const controller = new AbortController();
    this.abortController = controller;

    const bundleUrl = `${this.serverHttpUrl}/api/functions?url=${encodeURIComponent(path)}&bundle=true`;

    try {
      if (this.debug) {
        console.log(`[VoiceSDK:loader] Fetching functions for ${path}`);
      }

      const res = await fetch(bundleUrl, {
        signal: controller.signal,
        headers: {
          'ngrok-skip-browser-warning': '1',
        },
      });

      // Check if this request was superseded while awaiting
      if (controller.signal.aborted) return [];

      if (!res.ok) {
        if (this.debug) {
          console.warn(`[VoiceSDK:loader] Server returned ${res.status}`);
        }
        return [];
      }

      // Reject HTML (ngrok interstitial, error pages)
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        if (this.debug) {
          console.warn('[VoiceSDK:loader] Got HTML instead of JS — proxy interstitial?');
        }
        return [];
      }

      const code = await res.text();
      if (controller.signal.aborted) return [];

      // Apply the bundle to window.nbt_functions
      const result = this.applyBundle(code);

      this.lastLoadedPath = path;
      this.loaded = true;

      return result;
    } catch (err: any) {
      if (err.name === 'AbortError') return [];
      if (this.debug) {
        console.error('[VoiceSDK:loader] Failed to load functions:', err.message);
      }
      return [];
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  /**
   * Evaluate the bundle, track ownership, and clean up stale functions.
   * Returns names of newly added functions.
   *
   * Strategy: remove all previously-owned names FIRST, then eval the new bundle.
   * Whatever the bundle registers is the new owned set. This avoids the
   * "phantom ownership" problem where an old function survives eval and gets
   * mistakenly re-claimed.
   */
  private applyBundle(code: string): string[] {
    const prevOwned = this.ownedNames;

    // Step 1: Remove everything we previously owned (clean slate for this source)
    this.removeNames(prevOwned);

    if (!code.trim()) {
      this.ownedNames = new Set();
      return [];
    }

    // Step 2: Snapshot names AFTER removal (only external/build-mode functions remain)
    const before = new Set(Object.keys(window.nbt_functions || {}));

    // Step 3: Evaluate the bundle — populates window.nbt_functions
    (0, eval)(code);

    // Step 4: Everything new is ours
    const after = new Set(Object.keys(window.nbt_functions || {}));
    const nowOwned = new Set<string>();
    const added: string[] = [];
    for (const name of after) {
      if (!before.has(name)) {
        nowOwned.add(name);
        added.push(name);
      }
    }

    this.ownedNames = nowOwned;

    if (this.debug) {
      const removed = [...prevOwned].filter((n) => !nowOwned.has(n));
      const removedStr = removed.length > 0 ? `, removed: [${removed.join(', ')}]` : '';
      console.log(`[VoiceSDK:loader] Applied ${nowOwned.size} functions (${added.length} new${removedStr})`);
    }

    return added;
  }

  /** Delete named functions from window.nbt_functions. */
  private removeNames(names: Set<string>): void {
    if (!window.nbt_functions || names.size === 0) return;
    for (const name of names) {
      delete window.nbt_functions[name];
    }
  }
}

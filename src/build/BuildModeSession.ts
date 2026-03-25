import type {
  BuildModeConfig, BuildModeState, ClaudeCodeRequest, ClaudeCodeResponse,
  ToolDefinition,
} from './types';

export interface SendMessageOptions {
  /** Tool definitions — sent on the first request so Claude knows what's available */
  tools?: ToolDefinition[];
  /** Base64-encoded images to include with the message */
  images?: Array<{ data: string; media_type: string }>;
}

export interface BuildModeCallbacks {
  onStateChange: (state: BuildModeState) => void;
  onError: (message: string) => void;
  onDebug: (message: string) => void;
}

/**
 * HTTP client for the Claude Code API.
 * Manages multi-turn conversation via sessionId.
 * Completely separate from ProxySession (no WebSocket, no shared state).
 *
 * When running inside a Chrome extension context, routes requests through
 * the extension's background service worker via a content-script bridge
 * to bypass CORS restrictions. Falls back to direct fetch otherwise.
 */
export class BuildModeSession {
  private config: BuildModeConfig;
  private callbacks: BuildModeCallbacks;
  private sessionId: string | null = null;
  private loading = false;
  private abortController: AbortController | null = null;
  private bridgeAvailable = false;
  private pendingBridgeRequests = new Map<string, {
    resolve: (value: { ok: boolean; status: number; body: string }) => void;
    reject: (reason: Error) => void;
  }>();
  private bridgeListener: ((event: MessageEvent) => void) | null = null;

  constructor(config: BuildModeConfig, callbacks: BuildModeCallbacks) {
    this.config = {
      ...config,
      apiUrl: config.apiUrl.replace(/\/+$/, ''), // strip trailing slashes
    };
    this.callbacks = callbacks;
    this.detectBridge();
  }

  getState(): Readonly<BuildModeState> {
    return {
      active: true,
      sessionId: this.sessionId,
      loading: this.loading,
    };
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Restore a session ID from persisted state (navigation survival). */
  setSessionId(id: string): void {
    this.sessionId = id;
  }

  /**
   * Send a message (or tool results) to the Claude Code API.
   * Returns the parsed response directly — the caller (BuildModeManager)
   * drives callbacks and the tool-use loop.
   */
  async sendMessage(message: string, options?: SendMessageOptions): Promise<ClaudeCodeResponse> {
    if (this.loading) {
      throw new Error('Request already in flight');
    }

    this.setLoading(true);

    const body: ClaudeCodeRequest = {
      message,
      workspace: this.config.workspace,
      model: this.config.model ?? 'sonnet',
    };

    if (this.sessionId) body.sessionId = this.sessionId;
    if (options?.tools) body.tools = options.tools;
    if (options?.images) body.images = options.images;

    try {
      const response = await this.doRequest(body);
      this.sessionId = response.sessionId;

      this.callbacks.onDebug(
        `Response received (${response.durationMs}ms, $${response.costUsd.toFixed(4)})`,
      );
      return response;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        this.callbacks.onDebug('Request cancelled');
      }
      throw err;
    } finally {
      this.setLoading(false);
      this.abortController = null;
    }
  }

  cancelRequest(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  resetSession(): void {
    this.sessionId = null;
    this.callbacks.onDebug('Session reset');
  }

  async getHistory(): Promise<unknown> {
    if (!this.sessionId) return [];
    const result = await this.proxyFetch(
      `${this.config.apiUrl}/sessions/${this.sessionId}/history`,
      { method: 'GET', headers: { 'X-API-Key': this.config.apiKey } },
    );
    if (!result.ok) throw new Error(`History fetch failed: ${result.status}`);
    return JSON.parse(result.body);
  }

  async compactSession(): Promise<void> {
    if (!this.sessionId) return;
    const result = await this.proxyFetch(
      `${this.config.apiUrl}/sessions/${this.sessionId}/compact`,
      { method: 'POST', headers: { 'X-API-Key': this.config.apiKey } },
    );
    if (!result.ok) throw new Error(`Compact failed: ${result.status}`);
    this.callbacks.onDebug('Session compacted');
  }

  /**
   * Register persistent tools for the session via PUT /sessions/{id}/tools.
   * Persistent tools survive context compaction (auto-triggered at 200K tokens).
   * Best-effort: logs failure but does not throw.
   */
  async registerPersistentTools(tools: ToolDefinition[]): Promise<void> {
    if (!this.sessionId) return;
    const result = await this.proxyFetch(
      `${this.config.apiUrl}/sessions/${this.sessionId}/tools`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
        },
        body: JSON.stringify({ tools }),
      },
    );
    if (!result.ok) {
      this.callbacks.onDebug(`Failed to register persistent tools: ${result.status}`);
    } else {
      this.callbacks.onDebug('Persistent tools registered');
    }
  }

  destroy(): void {
    this.cancelRequest();
    this.sessionId = null;
    if (this.bridgeListener) {
      window.removeEventListener('message', this.bridgeListener);
      this.bridgeListener = null;
    }
    // Reject any pending bridge requests
    for (const [, pending] of this.pendingBridgeRequests) {
      pending.reject(new Error('Session destroyed'));
    }
    this.pendingBridgeRequests.clear();
  }

  // ── Bridge detection ──

  /**
   * Detect if the VoxGlide extension content-bridge is available.
   * The bridge allows fetching cross-origin without CORS by routing
   * through the extension's background service worker.
   */
  private detectBridge(): void {
    // Listen for bridge responses
    this.bridgeListener = (event: MessageEvent) => {
      if (event.source !== window) return;

      if (event.data?.type === 'voxglide:bridge-ready') {
        this.bridgeAvailable = true;
        this.callbacks.onDebug('Extension bridge detected');
        return;
      }

      if (event.data?.type === 'voxglide:build-fetch-response') {
        const { requestId, ok, status, body } = event.data;
        const pending = this.pendingBridgeRequests.get(requestId);
        if (pending) {
          this.pendingBridgeRequests.delete(requestId);
          pending.resolve({ ok, status, body });
        }
      }
    };

    window.addEventListener('message', this.bridgeListener);

    // Probe for the bridge (it may already be loaded)
    window.postMessage({ type: 'voxglide:bridge-ping' }, '*');
  }

  // ── Fetch abstraction ──

  /**
   * Fetch via extension bridge or direct fetch.
   * Bridge is preferred because it bypasses CORS.
   */
  private async proxyFetch(
    url: string,
    options: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{ ok: boolean; status: number; body: string }> {
    if (this.bridgeAvailable) {
      const result = await this.bridgeFetch(url, options);
      // If bridge returned status 0 (extension context invalidated), fall back to direct fetch
      if (!result.ok && result.status === 0) {
        this.bridgeAvailable = false;
        this.callbacks.onDebug('Bridge unavailable, falling back to direct fetch');
        return this.directFetch(url, options);
      }
      return result;
    }
    return this.directFetch(url, options);
  }

  private bridgeFetch(
    url: string,
    options: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{ ok: boolean; status: number; body: string }> {
    const requestId = Math.random().toString(36).slice(2);

    return new Promise((resolve, reject) => {
      // Timeout after 120s
      const timer = setTimeout(() => {
        this.pendingBridgeRequests.delete(requestId);
        reject(new Error('Bridge request timed out'));
      }, 120_000);

      this.pendingBridgeRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      window.postMessage({
        type: 'voxglide:build-fetch',
        requestId,
        url,
        options,
      }, '*');
    });
  }

  private async directFetch(
    url: string,
    options: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{ ok: boolean; status: number; body: string }> {
    this.abortController = new AbortController();

    const res = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: this.abortController.signal,
    });

    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  }

  // ── Main request ──

  private async doRequest(body: ClaudeCodeRequest): Promise<ClaudeCodeResponse> {
    const result = await this.proxyFetch(`${this.config.apiUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!result.ok) {
      throw new Error(`Claude Code API error ${result.status}: ${result.body}`);
    }

    return JSON.parse(result.body);
  }

  private setLoading(loading: boolean): void {
    this.loading = loading;
    this.callbacks.onStateChange(this.getState());
  }
}

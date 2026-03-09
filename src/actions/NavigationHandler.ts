import { SESSION_STORAGE_KEY } from '../constants';
import type { SessionState, VoiceSDKConfig } from '../types';

/**
 * Handles page navigation with session persistence.
 * Before navigating, saves SDK state to sessionStorage so it can auto-reconnect on the new page.
 */
export class NavigationHandler {
  private config: VoiceSDKConfig;
  private allowCrossOrigin: boolean;

  constructor(config: VoiceSDKConfig) {
    this.config = config;
    this.allowCrossOrigin = config.actions?.allowCrossOrigin ?? false;
  }

  async navigateTo(args: Record<string, unknown>): Promise<{ result: string }> {
    const url = String(args.url || '');
    if (!url) return { result: JSON.stringify({ error: 'No URL provided' }) };

    // Resolve relative URLs
    let resolved: URL;
    try {
      resolved = new URL(url, window.location.href);
    } catch {
      return { result: JSON.stringify({ error: `Invalid URL: "${url}"` }) };
    }

    // Same-origin check
    if (!this.allowCrossOrigin && resolved.origin !== window.location.origin) {
      return { result: JSON.stringify({ error: `Cross-origin navigation not allowed: "${resolved.href}"` }) };
    }

    // Save session state for auto-reconnect on the new page
    if (this.config.autoReconnect !== false) {
      this.saveSessionState();
    }

    // Navigate
    window.location.href = resolved.href;

    return { result: JSON.stringify({ success: true, navigatedTo: resolved.href }) };
  }

  /**
   * Save enough state to sessionStorage to reconnect after a page refresh.
   */
  private saveSessionState(): void {
    const state: SessionState = {
      config: {
        ...this.config,
        // Don't persist handler functions
        actions: this.config.actions ? {
          allowCrossOrigin: this.config.actions.allowCrossOrigin,
        } : undefined,
      },
    };

    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // sessionStorage may be full or disabled
    }
  }

  /**
   * Check if there's a pending reconnect from a previous navigation.
   */
  static getPendingReconnect(): SessionState | null {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Clear any pending reconnect state.
   */
  static clearPendingReconnect(): void {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

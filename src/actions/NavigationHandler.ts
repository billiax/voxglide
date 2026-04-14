import { SESSION_STORAGE_KEY } from '../constants';
import type { SessionState } from '../types';

/**
 * Static utility for session persistence across page navigations.
 * Manages sessionStorage state for auto-reconnect after navigation.
 */
export class NavigationHandler {
  /**
   * Check if there's a pending reconnect from a previous navigation.
   * Does NOT remove the stored state — call consumePendingReconnect() after successful reconnect.
   */
  static getPendingReconnect(): SessionState | null {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Remove the pending reconnect state from sessionStorage.
   * Should be called after a successful reconnect.
   */
  static consumePendingReconnect(): void {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore
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

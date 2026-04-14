import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavigationHandler } from '../../src/actions/NavigationHandler';
import { SESSION_STORAGE_KEY } from '../../src/constants';

describe('NavigationHandler', () => {
  let mockSessionStorage: Record<string, string>;

  beforeEach(() => {
    // Mock sessionStorage
    mockSessionStorage = {};
    const sessionStorageMock = {
      getItem: vi.fn((key: string) => mockSessionStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockSessionStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockSessionStorage[key];
      }),
      clear: vi.fn(() => {
        mockSessionStorage = {};
      }),
      length: 0,
      key: vi.fn(),
    };

    Object.defineProperty(window, 'sessionStorage', {
      value: sessionStorageMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('static getPendingReconnect()', () => {
    it('returns null when nothing is stored', () => {
      const result = NavigationHandler.getPendingReconnect();

      expect(result).toBeNull();
      expect(sessionStorage.getItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY);
    });

    it('returns parsed state without clearing storage', () => {
      const state = { config: { serverUrl: 'ws://localhost:3100' } };
      mockSessionStorage[SESSION_STORAGE_KEY] = JSON.stringify(state);

      const result = NavigationHandler.getPendingReconnect();

      expect(result).toEqual(state);
      expect(sessionStorage.getItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY);
      // getPendingReconnect no longer removes — consumePendingReconnect does
      expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    });

    it('consumePendingReconnect removes from storage', () => {
      mockSessionStorage[SESSION_STORAGE_KEY] = JSON.stringify({ config: { serverUrl: 'ws://test' } });

      NavigationHandler.consumePendingReconnect();

      expect(sessionStorage.removeItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY);
    });

    it('returns null and handles JSON parse errors gracefully', () => {
      mockSessionStorage[SESSION_STORAGE_KEY] = 'not-valid-json{{{';

      // JSON.parse will throw, should be caught and return null
      const result = NavigationHandler.getPendingReconnect();
      expect(result).toBeNull();
    });
  });

  describe('static clearPendingReconnect()', () => {
    it('removes session data from storage', () => {
      mockSessionStorage[SESSION_STORAGE_KEY] = JSON.stringify({ config: { serverUrl: 'ws://test' } });

      NavigationHandler.clearPendingReconnect();

      expect(sessionStorage.removeItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY);
    });

    it('does not throw when storage is empty', () => {
      expect(() => NavigationHandler.clearPendingReconnect()).not.toThrow();
      expect(sessionStorage.removeItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY);
    });
  });
});

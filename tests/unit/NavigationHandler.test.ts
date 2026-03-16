import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavigationHandler } from '../../src/actions/NavigationHandler';
import { SESSION_STORAGE_KEY } from '../../src/constants';

describe('NavigationHandler', () => {
  let originalLocation: Location;
  let mockSessionStorage: Record<string, string>;

  beforeEach(() => {
    // Save original location
    originalLocation = window.location;

    // Stub window.location with a controllable object
    const locationMock = {
      href: 'https://example.com/page',
      origin: 'https://example.com',
      protocol: 'https:',
      host: 'example.com',
      hostname: 'example.com',
      port: '',
      pathname: '/page',
      search: '',
      hash: '',
      assign: vi.fn(),
      replace: vi.fn(),
      reload: vi.fn(),
      toString: () => 'https://example.com/page',
    };

    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
      configurable: true,
    });

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
    // Restore original location
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });

    vi.restoreAllMocks();
  });

  describe('navigateTo()', () => {
    it('returns error when no URL provided', async () => {
      const config = { serverUrl: 'ws://localhost:3100' } as any;
      const handler = new NavigationHandler(config);

      const result = await handler.navigateTo({});
      const parsed = JSON.parse(result.result);

      expect(parsed.error).toBe('No URL provided');
    });

    it('returns error when URL is empty string', async () => {
      const config = { serverUrl: 'ws://localhost:3100' } as any;
      const handler = new NavigationHandler(config);

      const result = await handler.navigateTo({ url: '' });
      const parsed = JSON.parse(result.result);

      expect(parsed.error).toBe('No URL provided');
    });

    it('returns error for invalid URL', async () => {
      const config = { serverUrl: 'ws://localhost:3100' } as any;
      const handler = new NavigationHandler(config);

      // A URL that cannot be resolved even with a base
      // "://invalid" with an invalid base should trigger a URL parse error
      // Actually, most strings resolve against the base. We need something truly invalid.
      // An empty protocol like "://" can fail in some environments.
      // Let's use a scheme-only invalid URL that the URL constructor rejects.
      const result = await handler.navigateTo({ url: 'http://:invalid-url' });
      const parsed = JSON.parse(result.result);

      expect(parsed.error).toContain('Invalid URL');
    });

    it('returns error for cross-origin URL when not allowed', async () => {
      const config = { serverUrl: 'ws://localhost:3100' } as any;
      const handler = new NavigationHandler(config);

      const result = await handler.navigateTo({ url: 'https://evil.com/phish' });
      const parsed = JSON.parse(result.result);

      expect(parsed.error).toContain('Cross-origin navigation not allowed');
      expect(parsed.error).toContain('https://evil.com/phish');
    });

    it('allows cross-origin navigation when allowCrossOrigin is true', async () => {
      const config = {
        serverUrl: 'ws://localhost:3100',
        actions: { allowCrossOrigin: true },
        autoReconnect: false,
      } as any;
      const handler = new NavigationHandler(config);

      const result = await handler.navigateTo({ url: 'https://other-site.com/path' });
      const parsed = JSON.parse(result.result);

      expect(parsed.success).toBe(true);
      expect(parsed.navigatedTo).toBe('https://other-site.com/path');
      expect(window.location.href).toBe('https://other-site.com/path');
    });

    it('resolves relative URLs against current location', async () => {
      const config = {
        serverUrl: 'ws://localhost:3100',
        autoReconnect: false,
      } as any;
      const handler = new NavigationHandler(config);

      const result = await handler.navigateTo({ url: '/other-page' });
      const parsed = JSON.parse(result.result);

      expect(parsed.success).toBe(true);
      expect(parsed.navigatedTo).toBe('https://example.com/other-page');
      expect(window.location.href).toBe('https://example.com/other-page');
    });

    it('resolves relative path URLs correctly', async () => {
      const config = {
        serverUrl: 'ws://localhost:3100',
        autoReconnect: false,
      } as any;
      const handler = new NavigationHandler(config);

      const result = await handler.navigateTo({ url: 'sibling' });
      const parsed = JSON.parse(result.result);

      expect(parsed.success).toBe(true);
      // Relative to https://example.com/page -> https://example.com/sibling
      expect(parsed.navigatedTo).toBe('https://example.com/sibling');
    });

    it('saves session state to sessionStorage when autoReconnect is not false', async () => {
      const config = {
        serverUrl: 'ws://localhost:3100',
        actions: { allowCrossOrigin: false },
      } as any;
      const handler = new NavigationHandler(config);

      await handler.navigateTo({ url: '/new-page' });

      expect(sessionStorage.setItem).toHaveBeenCalledWith(
        SESSION_STORAGE_KEY,
        expect.any(String),
      );

      const savedValue = (sessionStorage.setItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const savedState = JSON.parse(savedValue);

      expect(savedState.config.serverUrl).toBe('ws://localhost:3100');
      expect(savedState.config.actions.allowCrossOrigin).toBe(false);
    });

    it('does not save session state when autoReconnect is false', async () => {
      const config = {
        serverUrl: 'ws://localhost:3100',
        autoReconnect: false,
      } as any;
      const handler = new NavigationHandler(config);

      await handler.navigateTo({ url: '/new-page' });

      expect(sessionStorage.setItem).not.toHaveBeenCalled();
    });

    it('sets window.location.href on success', async () => {
      const config = {
        serverUrl: 'ws://localhost:3100',
        autoReconnect: false,
      } as any;
      const handler = new NavigationHandler(config);

      await handler.navigateTo({ url: 'https://example.com/destination' });

      expect(window.location.href).toBe('https://example.com/destination');
    });

    it('returns success result with navigatedTo URL', async () => {
      const config = {
        serverUrl: 'ws://localhost:3100',
        autoReconnect: false,
      } as any;
      const handler = new NavigationHandler(config);

      const result = await handler.navigateTo({ url: 'https://example.com/target' });
      const parsed = JSON.parse(result.result);

      expect(parsed.success).toBe(true);
      expect(parsed.navigatedTo).toBe('https://example.com/target');
    });

    it('does not persist handler functions in session state', async () => {
      const config = {
        serverUrl: 'ws://localhost:3100',
        actions: {
          allowCrossOrigin: true,
          custom: {
            myTool: {
              declaration: { name: 'myTool', description: 'test', parameters: {} },
              handler: () => 'result',
            },
          },
        },
      } as any;
      const handler = new NavigationHandler(config);

      await handler.navigateTo({ url: '/page2' });

      const savedValue = (sessionStorage.setItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const savedState = JSON.parse(savedValue);

      // custom handlers should not be persisted - only allowCrossOrigin
      expect(savedState.config.actions).toEqual({ allowCrossOrigin: true });
      expect(savedState.config.actions.custom).toBeUndefined();
    });
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

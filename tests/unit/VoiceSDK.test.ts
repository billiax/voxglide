import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceSDK } from '../../src/VoiceSDK';
import { ConnectionState } from '../../src/constants';

const {
  mockConnect, mockDisconnect, mockIsConnected,
  mockGetPendingReconnect, mockClearPendingReconnect,
  proxySessionInstances,
} = vi.hoisted(() => ({
  mockConnect: vi.fn().mockResolvedValue(undefined),
  mockDisconnect: vi.fn().mockResolvedValue(undefined),
  mockIsConnected: vi.fn().mockReturnValue(false),
  mockGetPendingReconnect: vi.fn().mockReturnValue(null),
  mockClearPendingReconnect: vi.fn(),
  proxySessionInstances: [] as Array<{ config: any; callbacks: any }>,
}));

vi.mock('../../src/ai/ProxySession', () => {
  class MockProxySession {
    connect = mockConnect;
    disconnect = mockDisconnect;
    isConnected = mockIsConnected;
    pauseSpeech = vi.fn();
    resumeSpeech = vi.fn();
    constructor(public config: any, public callbacks: any) {
      proxySessionInstances.push({ config, callbacks });
    }
  }
  return { ProxySession: MockProxySession };
});

vi.mock('../../src/ui/UIManager', () => {
  class MockUIManager {
    setConnectionState = vi.fn();
    addTranscript = vi.fn();
    clearTranscript = vi.fn();
    showTranscript = vi.fn();
    hideTranscript = vi.fn();
    setAutoHideEnabled = vi.fn();
    destroy = vi.fn();
    setAIThinking = vi.fn();
    restoreTranscript = vi.fn();
    setDisconnectHandler = vi.fn();
    constructor(public config: any, public onToggle: any) {}
  }
  return { UIManager: MockUIManager };
});

vi.mock('../../src/context/PageContextProvider', () => {
  class MockPageContextProvider {
    type = 'page';
    name = 'Page Context';
    getContext = vi.fn().mockResolvedValue({ content: '', tools: [] });
    destroy = vi.fn();
  }
  return { PageContextProvider: MockPageContextProvider };
});

vi.mock('../../src/actions/NavigationHandler', () => {
  class MockNavigationHandler {
    navigateTo = vi.fn().mockResolvedValue({ result: 'ok' });
    static getPendingReconnect = mockGetPendingReconnect;
    static clearPendingReconnect = mockClearPendingReconnect;
    static consumePendingReconnect = vi.fn();
  }
  return { NavigationHandler: MockNavigationHandler };
});

vi.mock('../../src/actions/DOMActions', () => ({
  fillField: vi.fn().mockResolvedValue({ result: 'ok' }),
  clickElement: vi.fn().mockResolvedValue({ result: 'ok' }),
  readContent: vi.fn().mockResolvedValue({ result: 'ok' }),
  invalidateElementCache: vi.fn(),
}));

import { ContextEngine } from '../../src/context/ContextEngine';
import { TextProvider } from '../../src/context/TextProvider';

const defaultConfig = { serverUrl: 'ws://localhost:3100' } as const;

describe('VoiceSDK', () => {
  let sdk: VoiceSDK;

  beforeEach(() => {
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
    sdk = new VoiceSDK({ ...defaultConfig });
  });

  afterEach(async () => {
    await sdk.destroy();
  });

  describe('constructor', () => {
    it('creates a ContextEngine', () => {
      expect((sdk as any).contextEngine).toBeInstanceOf(ContextEngine);
    });

    it('sets up PageContextProvider when autoContext is provided', () => {
      const s = new VoiceSDK({ ...defaultConfig, autoContext: true });
      expect((s as any).pageContextProvider).not.toBeNull();
      s.destroy();
    });

    it('sets up PageContextProvider with config object', () => {
      const s = new VoiceSDK({ ...defaultConfig, autoContext: { forms: true, headings: false } });
      expect((s as any).pageContextProvider).not.toBeNull();
      s.destroy();
    });

    it('does not set up PageContextProvider when autoContext is false', () => {
      const s = new VoiceSDK({ ...defaultConfig, autoContext: false });
      expect((s as any).pageContextProvider).toBeNull();
      s.destroy();
    });

    it('does not set up PageContextProvider when autoContext is undefined', () => {
      expect((sdk as any).pageContextProvider).toBeNull();
    });

    it('sets up TextProvider when context string is provided', () => {
      const s = new VoiceSDK({ ...defaultConfig, context: 'Hello' });
      expect((s as any).textProvider).toBeInstanceOf(TextProvider);
      s.destroy();
    });

    it('does not set up TextProvider when context is not provided', () => {
      expect((sdk as any).textProvider).toBeNull();
    });

    it('creates UIManager by default', () => {
      expect((sdk as any).ui).not.toBeNull();
    });

    it('does not create UIManager when ui: false', () => {
      const s = new VoiceSDK({ ...defaultConfig, ui: false });
      expect((s as any).ui).toBeNull();
      s.destroy();
    });

    it('passes ui config object to UIManager', () => {
      const uiConfig = { position: 'top-left' as const, zIndex: 5000 };
      const s = new VoiceSDK({ ...defaultConfig, ui: uiConfig });
      expect((s as any).ui.config).toEqual(uiConfig);
      s.destroy();
    });

    it('sets up ActionRouter with custom actions', () => {
      const s = new VoiceSDK({
        ...defaultConfig,
        actions: {
          custom: {
            myTool: {
              declaration: { name: 'myTool', description: 'test', parameters: { type: 'object', properties: {} } },
              handler: vi.fn(),
            },
          },
        },
      });
      expect((s as any).actionRouter).toBeDefined();
      s.destroy();
    });

    it('starts with DISCONNECTED state', () => {
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('start()', () => {
    it('transitions to CONNECTING state', async () => {
      const states: string[] = [];
      sdk.on('stateChange', (e) => states.push(e.to));
      await sdk.start();
      expect(states[0]).toBe(ConnectionState.CONNECTING);
    });

    it('creates a ProxySession and calls connect', async () => {
      await sdk.start();
      expect(proxySessionInstances).toHaveLength(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('passes serverUrl in session config', async () => {
      await sdk.start();
      expect(proxySessionInstances[0].config.serverUrl).toBe('ws://localhost:3100');
    });

    it('is idempotent when already connecting', async () => {
      await sdk.start();
      await sdk.start();
      expect(proxySessionInstances).toHaveLength(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('is idempotent when already connected', async () => {
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);

      await sdk.start();
      expect(proxySessionInstances).toHaveLength(1);
    });

    it('emits error and sets ERROR state on connect failure', async () => {
      mockConnect.mockRejectedValueOnce(new Error('connection failed'));

      const errors: string[] = [];
      sdk.on('error', (e) => errors.push(e.message));
      await sdk.start();

      expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);
      expect(errors).toContain('connection failed');
    });
  });

  describe('stop()', () => {
    beforeEach(async () => {
      await sdk.start();
    });

    it('disconnects the session', async () => {
      await sdk.stop();
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('resets state to DISCONNECTED', async () => {
      await sdk.stop();
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('nullifies the session reference', async () => {
      await sdk.stop();
      expect((sdk as any).session).toBeNull();
    });

    it('keeps transcript visible on stop (auto-hide handles fade)', async () => {
      await sdk.stop();
      // stop() no longer clears transcript — it stays visible and auto-hides
      expect((sdk as any).ui.clearTranscript).not.toHaveBeenCalled();
    });

    it('is safe to call when already stopped', async () => {
      await sdk.stop();
      await sdk.stop();
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('toggle()', () => {
    it('starts when disconnected', async () => {
      await sdk.toggle();
      expect(proxySessionInstances.length).toBeGreaterThanOrEqual(1);
      expect(mockConnect).toHaveBeenCalled();
    });

    it('stops when connected', async () => {
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');
      await sdk.toggle();
      expect(mockDisconnect).toHaveBeenCalled();
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('starts when in ERROR state', async () => {
      mockConnect.mockRejectedValueOnce(new Error('fail'));
      await sdk.start();
      expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);

      mockConnect.mockResolvedValue(undefined);
      await sdk.toggle();
      expect(proxySessionInstances).toHaveLength(2);
    });

    it('does nothing when connecting', async () => {
      await sdk.start();
      await sdk.toggle();
      expect(mockDisconnect).not.toHaveBeenCalled();
      expect(proxySessionInstances).toHaveLength(1);
    });
  });

  describe('getConnectionState()', () => {
    it('returns DISCONNECTED initially', () => {
      expect(sdk.getConnectionState()).toBe('DISCONNECTED');
    });

    it('returns CONNECTING after start', async () => {
      await sdk.start();
      expect(sdk.getConnectionState()).toBe('CONNECTING');
    });

    it('returns CONNECTED after session connects', async () => {
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');
      expect(sdk.getConnectionState()).toBe('CONNECTED');
    });

    it('returns ERROR when session reports error', async () => {
      await sdk.start();
      proxySessionInstances[0].callbacks.onError('some error');
      expect(sdk.getConnectionState()).toBe('ERROR');
    });
  });

  describe('setContext()', () => {
    it('creates a TextProvider if none exists', () => {
      expect((sdk as any).textProvider).toBeNull();
      sdk.setContext('new context');
      expect((sdk as any).textProvider).toBeInstanceOf(TextProvider);
    });

    it('updates existing TextProvider text', () => {
      sdk.setContext('first');
      const provider = (sdk as any).textProvider;
      const spy = vi.spyOn(provider, 'setText');
      sdk.setContext('second');
      expect(spy).toHaveBeenCalledWith('second');
    });

    it('reuses the same TextProvider', () => {
      sdk.setContext('a');
      const first = (sdk as any).textProvider;
      sdk.setContext('b');
      expect((sdk as any).textProvider).toBe(first);
    });
  });

  describe('addContext()', () => {
    it('adds a provider to the context engine', () => {
      const engine = (sdk as any).contextEngine as ContextEngine;
      const spy = vi.spyOn(engine, 'addProvider');
      const provider = { type: 'custom', name: 'Test', getContext: vi.fn().mockResolvedValue({ content: '', tools: [] }) };
      sdk.addContext(provider);
      expect(spy).toHaveBeenCalledWith(provider);
    });
  });

  describe('registerAction() / removeAction()', () => {
    it('adds handler to the action router', () => {
      const router = (sdk as any).actionRouter;
      const spy = vi.spyOn(router, 'registerHandler');
      const action = {
        declaration: { name: 'test', description: 'test', parameters: { type: 'object', properties: {} } },
        handler: vi.fn(),
      };
      sdk.registerAction('test', action);
      expect(spy).toHaveBeenCalledWith('test', expect.any(Function));
    });

    it('removes handler from the action router', () => {
      const router = (sdk as any).actionRouter;
      const spy = vi.spyOn(router, 'removeHandler');
      sdk.removeAction('someAction');
      expect(spy).toHaveBeenCalledWith('someAction');
    });
  });

  describe('destroy()', () => {
    it('calls stop', async () => {
      const spy = vi.spyOn(sdk, 'stop');
      await sdk.destroy();
      expect(spy).toHaveBeenCalled();
    });

    it('destroys the UI', async () => {
      const ui = (sdk as any).ui;
      await sdk.destroy();
      expect(ui.destroy).toHaveBeenCalled();
    });

    it('removes all event listeners', async () => {
      const handler = vi.fn();
      sdk.on('connected', handler);
      await sdk.destroy();
      sdk.emit('connected');
      expect(handler).not.toHaveBeenCalled();
    });

    it('clears pending reconnect', async () => {
      await sdk.destroy();
      expect(mockClearPendingReconnect).toHaveBeenCalled();
    });

    it('disconnects session if active', async () => {
      await sdk.start();
      await sdk.destroy();
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('destroys PageContextProvider if it exists', async () => {
      const s = new VoiceSDK({ ...defaultConfig, autoContext: true });
      const provider = (s as any).pageContextProvider;
      await s.destroy();
      expect(provider.destroy).toHaveBeenCalled();
    });
  });

  describe('events', () => {
    it('emits stateChange on state transitions', async () => {
      const changes: Array<{ from: string; to: string }> = [];
      sdk.on('stateChange', (e) => changes.push(e));
      await sdk.start();
      expect(changes[0]).toEqual({ from: ConnectionState.DISCONNECTED, to: ConnectionState.CONNECTING });
    });

    it('emits connected when session reports connected', async () => {
      const spy = vi.fn();
      sdk.on('connected', spy);
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('emits disconnected when session reports disconnected', async () => {
      const spy = vi.fn();
      sdk.on('disconnected', spy);
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('disconnected');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('transitions to CONNECTED state on connected status', async () => {
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);
    });

    it('transitions to DISCONNECTED state on disconnected status', async () => {
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');
      proxySessionInstances[0].callbacks.onStatusChange('disconnected');
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('emits error event when session calls onError', async () => {
      const spy = vi.fn();
      sdk.on('error', spy);
      await sdk.start();
      proxySessionInstances[0].callbacks.onError('test error message');
      expect(spy).toHaveBeenCalledWith({ message: 'test error message' });
    });

    it('sets ERROR state when session calls onError', async () => {
      await sdk.start();
      proxySessionInstances[0].callbacks.onError('test error');
      expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);
    });

    it('emits transcript events from session', async () => {
      const spy = vi.fn();
      sdk.on('transcript', spy);
      await sdk.start();
      proxySessionInstances[0].callbacks.onTranscript('hello world', 'user', true);
      expect(spy).toHaveBeenCalledWith({ speaker: 'user', text: 'hello world', isFinal: true });
    });

    it('emits usage events from session', async () => {
      const spy = vi.fn();
      sdk.on('usage', spy);
      await sdk.start();
      proxySessionInstances[0].callbacks.onSessionEnd({ totalTokens: 100, inputTokens: 60, outputTokens: 40 });
      expect(spy).toHaveBeenCalledWith({ totalTokens: 100, inputTokens: 60, outputTokens: 40 });
    });
  });
});

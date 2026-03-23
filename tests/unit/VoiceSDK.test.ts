import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceSDK } from '../../src/VoiceSDK';
import { ConnectionState } from '../../src/constants';

// ── Minimal mocks: only things that need real browser APIs we don't have ──

// Track ProxySession instances so tests can simulate server-side events
const proxySessionInstances: Array<{
  config: any;
  callbacks: any;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
  pauseSpeech: ReturnType<typeof vi.fn>;
  resumeSpeech: ReturnType<typeof vi.fn>;
  retrySpeech: ReturnType<typeof vi.fn>;
  cancelTurn: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
  sendContextUpdate: ReturnType<typeof vi.fn>;
  sendScanResults: ReturnType<typeof vi.fn>;
  captureAndSendScreenshot: ReturnType<typeof vi.fn>;
  sessionId: string | null;
}> = [];

// Shared connect mock — tests can override its behavior per-test
const sharedConnectMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/ai/ProxySession', () => {
  class MockProxySession {
    connect = sharedConnectMock;
    disconnect = vi.fn().mockResolvedValue(undefined);
    isConnected = vi.fn().mockReturnValue(false);
    pauseSpeech = vi.fn();
    resumeSpeech = vi.fn();
    retrySpeech = vi.fn();
    cancelTurn = vi.fn();
    sendText = vi.fn();
    sendContextUpdate = vi.fn();
    sendScanResults = vi.fn();
    captureAndSendScreenshot = vi.fn();
    sessionId: string | null = 'test-session-id';
    constructor(public config: any, public callbacks: any) {
      proxySessionInstances.push(this as any);
    }
  }
  return { ProxySession: MockProxySession };
});

// UIManager: lightly mocked because it creates Shadow DOM, MutationObserver intervals, etc.
// We verify it receives correct config but don't need the real DOM machinery.
const uiInstances: Array<{
  config: any;
  onToggle: any;
  onSendText: any;
  inputMode: string;
  setConnectionState: ReturnType<typeof vi.fn>;
  setSpeechState: ReturnType<typeof vi.fn>;
  addTranscript: ReturnType<typeof vi.fn>;
  clearTranscript: ReturnType<typeof vi.fn>;
  showTranscript: ReturnType<typeof vi.fn>;
  hideTranscript: ReturnType<typeof vi.fn>;
  toggleTranscript: ReturnType<typeof vi.fn>;
  setAutoHideEnabled: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  setAIThinking: ReturnType<typeof vi.fn>;
  restoreTranscript: ReturnType<typeof vi.fn>;
  setDisconnectHandler: ReturnType<typeof vi.fn>;
  setMinimizeHandler: ReturnType<typeof vi.fn>;
  ensureAttached: ReturnType<typeof vi.fn>;
  updateQueue: ReturnType<typeof vi.fn>;
  setCancelHandler: ReturnType<typeof vi.fn>;
  showToolStatus: ReturnType<typeof vi.fn>;
  removeToolStatus: ReturnType<typeof vi.fn>;
  focusInput: ReturnType<typeof vi.fn>;
  getHost: ReturnType<typeof vi.fn>;
  addSystemMessage: ReturnType<typeof vi.fn>;
  setPauseReason: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('../../src/ui/UIManager', () => {
  class MockUIManager {
    setConnectionState = vi.fn();
    setSpeechState = vi.fn();
    addTranscript = vi.fn();
    clearTranscript = vi.fn();
    showTranscript = vi.fn();
    hideTranscript = vi.fn();
    toggleTranscript = vi.fn();
    setAutoHideEnabled = vi.fn();
    destroy = vi.fn();
    setAIThinking = vi.fn();
    restoreTranscript = vi.fn();
    setDisconnectHandler = vi.fn();
    setMinimizeHandler = vi.fn();
    ensureAttached = vi.fn();
    updateQueue = vi.fn();
    setCancelHandler = vi.fn();
    showToolStatus = vi.fn();
    removeToolStatus = vi.fn();
    focusInput = vi.fn();
    getHost = vi.fn().mockReturnValue(document.createElement('div'));
    addSystemMessage = vi.fn();
    setPauseReason = vi.fn();
    getStateMachine = vi.fn().mockReturnValue({ getState: () => ({ panelVisible: true }) });
    constructor(public config: any, public onToggle: any, public onSendText?: any, public inputMode?: string) {
      uiInstances.push(this as any);
    }
  }
  return { UIManager: MockUIManager };
});

// PageContextProvider: mocked because it does heavy DOM scanning with MutationObserver
vi.mock('../../src/context/PageContextProvider', () => {
  class MockPageContextProvider {
    type = 'page';
    name = 'Page Context';
    getContext = vi.fn().mockResolvedValue({ content: 'mock page context', tools: [] });
    destroy = vi.fn();
    markDirty = vi.fn();
    beginWatchPeriod = vi.fn();
    getScanner = vi.fn().mockReturnValue({ getElementByIndex: vi.fn().mockReturnValue(null) });
    getLastScanData = vi.fn().mockReturnValue(null);
  }
  return { PageContextProvider: MockPageContextProvider };
});

// NavigationHandler: mocked because it does window.location.href assignment and sessionStorage
vi.mock('../../src/actions/NavigationHandler', () => {
  class MockNavigationHandler {
    navigateTo = vi.fn().mockResolvedValue({ result: 'ok' });
    setSessionId = vi.fn();
    static getPendingReconnect = vi.fn().mockReturnValue(null);
    static clearPendingReconnect = vi.fn();
    static consumePendingReconnect = vi.fn();
  }
  return { NavigationHandler: MockNavigationHandler };
});

// NavigationObserver: mocked because it patches history.pushState/replaceState globally
const mockNavObserverDestroy = vi.fn();
vi.mock('../../src/NavigationObserver', () => {
  class MockNavigationObserver {
    destroy = mockNavObserverDestroy;
    constructor(public onNavigate: any, public onBeforeUnload: any) {}
  }
  return { NavigationObserver: MockNavigationObserver };
});

// DOMActions: module-level functions that manipulate DOM elements
vi.mock('../../src/actions/DOMActions', () => ({
  fillField: vi.fn().mockResolvedValue({ result: JSON.stringify({ success: true, fieldId: 'test' }) }),
  clickElement: vi.fn().mockResolvedValue({ result: JSON.stringify({ success: true, clicked: 'test' }) }),
  readContent: vi.fn().mockResolvedValue({ result: JSON.stringify({ success: true, content: 'test' }) }),
  invalidateElementCache: vi.fn(),
  setIndexResolver: vi.fn(),
  setRescanCallback: vi.fn(),
  setPostClickCallback: vi.fn(),
}));

// NbtFunctionsProvider: mocked because it uses setInterval polling + window event listeners
vi.mock('../../src/actions/NbtFunctionsProvider', () => {
  class MockNbtFunctionsProvider {
    sync = vi.fn().mockReturnValue(false);
    destroy = vi.fn();
    getActions = vi.fn().mockReturnValue({});
    getToolDeclarations = vi.fn().mockReturnValue([]);
    getRegisteredNames = vi.fn().mockReturnValue(new Set());
    constructor(public onChange: any, public debug: any) {}
  }
  return { NbtFunctionsProvider: MockNbtFunctionsProvider };
});

// ── These run REAL (not mocked): ──
// - ActionRouter (routes tool calls, registers handlers)
// - ContextEngine (aggregates providers)
// - TextProvider (simple text wrapper)
// - EventEmitter (VoiceSDK extends it)
// - builtInTools (static declarations)

import { ContextEngine } from '../../src/context/ContextEngine';
import { TextProvider } from '../../src/context/TextProvider';
import { ActionRouter } from '../../src/actions/ActionRouter';
import type { FunctionCall } from '../../src/types';

const defaultConfig = { serverUrl: 'ws://localhost:3100' } as const;

/** Helper to get the last ProxySession instance */
function lastSession() {
  return proxySessionInstances[proxySessionInstances.length - 1];
}

/** Helper to get the last UIManager instance */
function lastUI() {
  return uiInstances[uiInstances.length - 1];
}

describe('VoiceSDK', () => {
  let sdk: VoiceSDK;

  beforeEach(() => {
    vi.clearAllMocks();
    sharedConnectMock.mockResolvedValue(undefined);
    proxySessionInstances.length = 0;
    uiInstances.length = 0;
    sdk = new VoiceSDK({ ...defaultConfig });
  });

  afterEach(async () => {
    await sdk.destroy();
  });

  // ──────────────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('creates a real ContextEngine', () => {
      expect((sdk as any).contextCoordinator.contextEngine).toBeInstanceOf(ContextEngine);
    });

    it('creates a real ActionRouter', () => {
      expect((sdk as any).actionRouter).toBeInstanceOf(ActionRouter);
    });

    it('sets up PageContextProvider when autoContext is provided', () => {
      const s = new VoiceSDK({ ...defaultConfig, autoContext: true });
      expect((s as any).contextCoordinator.getPageContextProvider()).not.toBeNull();
      s.destroy();
    });

    it('sets up PageContextProvider with config object', () => {
      const s = new VoiceSDK({ ...defaultConfig, autoContext: { forms: true, headings: false } });
      expect((s as any).contextCoordinator.getPageContextProvider()).not.toBeNull();
      s.destroy();
    });

    it('does not set up PageContextProvider when autoContext is false', () => {
      const s = new VoiceSDK({ ...defaultConfig, autoContext: false });
      expect((s as any).contextCoordinator.getPageContextProvider()).toBeNull();
      s.destroy();
    });

    it('does not set up PageContextProvider when autoContext is undefined', () => {
      expect((sdk as any).contextCoordinator.getPageContextProvider()).toBeNull();
    });

    it('sets up TextProvider when context string is provided', () => {
      const s = new VoiceSDK({ ...defaultConfig, context: 'Hello' });
      expect((s as any).contextCoordinator.getTextProvider()).toBeInstanceOf(TextProvider);
      s.destroy();
    });

    it('does not set up TextProvider when context is not provided', () => {
      expect((sdk as any).contextCoordinator.getTextProvider()).toBeNull();
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
      expect(lastUI().config).toEqual(uiConfig);
      s.destroy();
    });

    it('sets up ActionRouter with custom actions registered', () => {
      const handler = vi.fn().mockReturnValue({ done: true });
      const s = new VoiceSDK({
        ...defaultConfig,
        actions: {
          custom: {
            myTool: {
              declaration: { name: 'myTool', description: 'test', parameters: { type: 'object', properties: {} } },
              handler,
            },
          },
        },
      });
      const router = (s as any).actionRouter as ActionRouter;
      // Real ActionRouter should have the custom handler registered
      expect((router as any).handlers.has('myTool')).toBe(true);
      s.destroy();
    });

    it('starts with DISCONNECTED state', () => {
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('creates a NavigationObserver', () => {
      expect((sdk as any).navigationObserver).not.toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // start() / stop() lifecycle
  // ──────────────────────────────────────────────────────────────────
  describe('start()', () => {
    it('transitions DISCONNECTED -> CONNECTING -> CONNECTED', async () => {
      const states: string[] = [];
      sdk.on('stateChange', (e) => states.push(e.to));

      await sdk.start();
      expect(states).toContain(ConnectionState.CONNECTING);
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTING);

      // Simulate server acknowledging connection
      lastSession().callbacks.onStatusChange('connected');
      expect(states).toContain(ConnectionState.CONNECTED);
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);
    });

    it('creates a ProxySession and calls connect', async () => {
      await sdk.start();
      expect(proxySessionInstances).toHaveLength(1);
      expect(lastSession().connect).toHaveBeenCalledTimes(1);
    });

    it('passes serverUrl in session config', async () => {
      await sdk.start();
      expect(lastSession().config.serverUrl).toBe('ws://localhost:3100');
    });

    it('includes built-in tools in session config tool declarations', async () => {
      await sdk.start();
      const declarations = lastSession().config.tools[0].functionDeclarations;
      const names = declarations.map((t: any) => t.name);
      expect(names).toContain('fillField');
      expect(names).toContain('clickElement');
      expect(names).toContain('readContent');
      expect(names).toContain('scanPage');
    });

    it('includes built-in tool declarations in session config', async () => {
      await sdk.start();
      const tools = lastSession().config.tools;
      expect(tools).toHaveLength(1);
      const declarations = tools[0].functionDeclarations;
      const names = declarations.map((t: any) => t.name);
      expect(names).toContain('fillField');
      expect(names).toContain('clickElement');
      expect(names).toContain('readContent');
      expect(names).toContain('scanPage');
    });

    it('is idempotent when already connecting', async () => {
      await sdk.start();
      await sdk.start();
      expect(proxySessionInstances).toHaveLength(1);
      expect(lastSession().connect).toHaveBeenCalledTimes(1);
    });

    it('is idempotent when already connected', async () => {
      await sdk.start();
      lastSession().callbacks.onStatusChange('connected');
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);

      await sdk.start();
      expect(proxySessionInstances).toHaveLength(1);
    });

    it('emits error and sets ERROR state on connect failure', async () => {
      sharedConnectMock.mockRejectedValueOnce(new Error('connection failed'));

      const errors: string[] = [];
      sdk.on('error', (e) => errors.push(e.message));
      await sdk.start();

      expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);
      expect(errors).toContain('connection failed');
    });

    it('passes onSpeechStateChange callback to ProxySession', async () => {
      await sdk.start();
      expect(lastSession().callbacks.onSpeechStateChange).toBeDefined();
    });
  });

  describe('stop()', () => {
    beforeEach(async () => {
      await sdk.start();
    });

    it('disconnects the session', async () => {
      await sdk.stop();
      expect(lastSession().disconnect).toHaveBeenCalled();
    });

    it('resets state to DISCONNECTED', async () => {
      await sdk.stop();
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('nullifies the session reference', async () => {
      await sdk.stop();
      expect((sdk as any).session).toBeNull();
    });

    it('does not clear transcript on stop (user can re-read)', async () => {
      lastUI().clearTranscript.mockClear();
      await sdk.stop();
      expect(lastUI().clearTranscript).not.toHaveBeenCalled();
    });

    it('clears transcript on fresh start (not navigation reconnect)', async () => {
      await sdk.stop();
      lastUI().clearTranscript.mockClear();
      await sdk.start();
      expect(lastUI().clearTranscript).toHaveBeenCalled();
    });

    it('is safe to call when already stopped', async () => {
      await sdk.stop();
      await sdk.stop();
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // toggle()
  // ──────────────────────────────────────────────────────────────────
  describe('toggle()', () => {
    it('starts when disconnected', async () => {
      await sdk.toggle();
      expect(proxySessionInstances.length).toBeGreaterThanOrEqual(1);
      expect(lastSession().connect).toHaveBeenCalled();
    });

    it('stops when connected with speech active and panel visible', async () => {
      await sdk.start();
      lastSession().callbacks.onStatusChange('connected');
      lastSession().callbacks.onSpeechStateChange(true, false, true);
      await sdk.toggle();
      expect(lastSession().disconnect).toHaveBeenCalled();
    });

    it('retries speech when connected but speech is not active', async () => {
      await sdk.start();
      const session = lastSession();
      session.callbacks.onStatusChange('connected');
      session.callbacks.onSpeechStateChange(false, false, true);
      await sdk.toggle();
      expect(session.disconnect).not.toHaveBeenCalled();
      expect(session.retrySpeech).toHaveBeenCalled();
    });

    it('starts when in ERROR state', async () => {
      await sdk.start();
      lastSession().callbacks.onError('fail');
      expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);

      await sdk.toggle();
      expect(proxySessionInstances.length).toBeGreaterThanOrEqual(2);
    });

    it('does nothing when connecting', async () => {
      await sdk.start();
      await sdk.toggle();
      expect(lastSession().disconnect).not.toHaveBeenCalled();
      expect(proxySessionInstances).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // getConnectionState()
  // ──────────────────────────────────────────────────────────────────
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
      lastSession().callbacks.onStatusChange('connected');
      expect(sdk.getConnectionState()).toBe('CONNECTED');
    });

    it('returns ERROR when session reports error', async () => {
      await sdk.start();
      lastSession().callbacks.onError('some error');
      expect(sdk.getConnectionState()).toBe('ERROR');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // setContext() — uses real TextProvider and ContextEngine
  // ──────────────────────────────────────────────────────────────────
  describe('setContext()', () => {
    it('creates a TextProvider if none exists', () => {
      expect((sdk as any).contextCoordinator.getTextProvider()).toBeNull();
      sdk.setContext('new context');
      expect((sdk as any).contextCoordinator.getTextProvider()).toBeInstanceOf(TextProvider);
    });

    it('updates existing TextProvider text', () => {
      sdk.setContext('first');
      const provider = (sdk as any).contextCoordinator.getTextProvider();
      const spy = vi.spyOn(provider, 'setText');
      sdk.setContext('second');
      expect(spy).toHaveBeenCalledWith('second');
    });

    it('reuses the same TextProvider', () => {
      sdk.setContext('a');
      const first = (sdk as any).contextCoordinator.getTextProvider();
      sdk.setContext('b');
      expect((sdk as any).contextCoordinator.getTextProvider()).toBe(first);
    });

    it('adds provider to real ContextEngine so it appears in system prompt', async () => {
      sdk.setContext('My custom instructions for the AI');
      const engine = (sdk as any).contextCoordinator.contextEngine as ContextEngine;
      const prompt = await engine.buildSystemPrompt();
      expect(prompt).toContain('My custom instructions for the AI');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // addContext() — uses real ContextEngine
  // ──────────────────────────────────────────────────────────────────
  describe('addContext()', () => {
    it('adds a provider to the real context engine', () => {
      const engine = (sdk as any).contextCoordinator.contextEngine as ContextEngine;
      const spy = vi.spyOn(engine, 'addProvider');
      const provider = { type: 'custom', name: 'Test', getContext: vi.fn().mockResolvedValue({ content: '', tools: [] }) };
      sdk.addContext(provider);
      expect(spy).toHaveBeenCalledWith(provider);
    });

    it('provider content appears in built system prompt', async () => {
      const provider = {
        type: 'custom',
        name: 'Test Provider',
        getContext: vi.fn().mockResolvedValue({ content: 'custom provider data', tools: [] }),
      };
      sdk.addContext(provider);
      const engine = (sdk as any).contextCoordinator.contextEngine as ContextEngine;
      const prompt = await engine.buildSystemPrompt();
      expect(prompt).toContain('custom provider data');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // registerAction() / removeAction() — uses real ActionRouter
  // ──────────────────────────────────────────────────────────────────
  describe('registerAction() / removeAction()', () => {
    it('adds handler to the real action router', () => {
      const router = (sdk as any).actionRouter as ActionRouter;
      const action = {
        declaration: { name: 'test', description: 'test', parameters: { type: 'object', properties: {} } },
        handler: vi.fn().mockReturnValue('done'),
      };
      sdk.registerAction('test', action);
      expect((router as any).handlers.has('test')).toBe(true);
    });

    it('removes handler from the real action router', () => {
      const router = (sdk as any).actionRouter as ActionRouter;
      const action = {
        declaration: { name: 'test', description: 'test', parameters: { type: 'object', properties: {} } },
        handler: vi.fn(),
      };
      sdk.registerAction('test', action);
      expect((router as any).handlers.has('test')).toBe(true);

      sdk.removeAction('test');
      expect((router as any).handlers.has('test')).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // destroy()
  // ──────────────────────────────────────────────────────────────────
  describe('destroy()', () => {
    it('calls stop', async () => {
      const spy = vi.spyOn(sdk, 'stop');
      await sdk.destroy();
      expect(spy).toHaveBeenCalled();
    });

    it('destroys the UI', async () => {
      const ui = lastUI();
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
      const { NavigationHandler } = await import('../../src/actions/NavigationHandler');
      await sdk.destroy();
      expect(NavigationHandler.clearPendingReconnect).toHaveBeenCalled();
    });

    it('disconnects session if active', async () => {
      await sdk.start();
      const session = lastSession();
      await sdk.destroy();
      expect(session.disconnect).toHaveBeenCalled();
    });

    it('destroys PageContextProvider if it exists', async () => {
      const s = new VoiceSDK({ ...defaultConfig, autoContext: true });
      const provider = (s as any).contextCoordinator.getPageContextProvider();
      await s.destroy();
      expect(provider.destroy).toHaveBeenCalled();
    });

    it('destroys NavigationObserver', async () => {
      await sdk.destroy();
      expect(mockNavObserverDestroy).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Events — real EventEmitter
  // ──────────────────────────────────────────────────────────────────
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
      lastSession().callbacks.onStatusChange('connected');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('emits disconnected when session reports disconnected', async () => {
      const spy = vi.fn();
      sdk.on('disconnected', spy);
      await sdk.start();
      lastSession().callbacks.onStatusChange('connected');
      lastSession().callbacks.onStatusChange('disconnected');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('transitions to CONNECTED state on connected status', async () => {
      await sdk.start();
      lastSession().callbacks.onStatusChange('connected');
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);
    });

    it('transitions to DISCONNECTED state on disconnected status', async () => {
      await sdk.start();
      lastSession().callbacks.onStatusChange('connected');
      lastSession().callbacks.onStatusChange('disconnected');
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('emits error event when session calls onError', async () => {
      const spy = vi.fn();
      sdk.on('error', spy);
      await sdk.start();
      lastSession().callbacks.onError('test error message');
      expect(spy).toHaveBeenCalledWith({ message: 'test error message' });
    });

    it('sets ERROR state when session calls onError', async () => {
      await sdk.start();
      lastSession().callbacks.onError('test error');
      expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);
    });

    it('emits transcript events from session', async () => {
      const spy = vi.fn();
      sdk.on('transcript', spy);
      await sdk.start();
      lastSession().callbacks.onTranscript('hello world', 'user', true);
      expect(spy).toHaveBeenCalledWith({ speaker: 'user', text: 'hello world', isFinal: true });
    });

    it('emits usage events from session', async () => {
      const spy = vi.fn();
      sdk.on('usage', spy);
      await sdk.start();
      lastSession().callbacks.onSessionEnd({ totalTokens: 100, inputTokens: 60, outputTokens: 40 });
      expect(spy).toHaveBeenCalledWith({ totalTokens: 100, inputTokens: 60, outputTokens: 40 });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Queue
  // ──────────────────────────────────────────────────────────────────
  describe('queue', () => {
    it('passes onQueueUpdate callback to ProxySession', async () => {
      await sdk.start();
      expect(lastSession().callbacks.onQueueUpdate).toBeDefined();
    });

    it('forwards queue updates to UI', async () => {
      await sdk.start();
      const queue = {
        active: { turnId: 't1', text: 'hello', status: 'processing' as const },
        queued: [],
      };
      lastSession().callbacks.onQueueUpdate(queue);
      expect(lastUI().updateQueue).toHaveBeenCalledWith(queue);
    });

    it('wires cancel handler to session.cancelTurn', async () => {
      await sdk.start();
      expect(lastUI().setCancelHandler).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // nbt_functions integration
  // ──────────────────────────────────────────────────────────────────
  describe('nbt_functions integration', () => {
    it('creates NbtFunctionsProvider by default', () => {
      expect((sdk as any).nbtFunctionsProvider).not.toBeNull();
    });

    it('does NOT create NbtFunctionsProvider when nbtFunctions: false', () => {
      const s = new VoiceSDK({ ...defaultConfig, nbtFunctions: false });
      expect((s as any).nbtFunctionsProvider).toBeNull();
      s.destroy();
    });

    it('destroys provider on destroy()', async () => {
      const provider = (sdk as any).nbtFunctionsProvider;
      await sdk.destroy();
      expect(provider.destroy).toHaveBeenCalled();
    });

    it('syncs nbt_functions on SPA navigation', () => {
      const navObserver = (sdk as any).navigationObserver;
      const provider = (sdk as any).nbtFunctionsProvider;
      navObserver.onNavigate({ from: '/a', to: '/b', type: 'pushState' });
      expect(provider.sync).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // SPA navigation handling
  // ──────────────────────────────────────────────────────────────────
  describe('SPA navigation handling', () => {
    it('handles SPA navigation by invalidating caches and re-attaching UI', async () => {
      const navObserver = (sdk as any).navigationObserver;
      const { invalidateElementCache } = await import('../../src/actions/DOMActions');

      navObserver.onNavigate({ from: '/page1', to: '/page2', type: 'pushState' });

      expect(invalidateElementCache).toHaveBeenCalled();
      expect(lastUI().ensureAttached).toHaveBeenCalled();
    });

    it('saves session state on beforeunload when connected', async () => {
      await sdk.start();
      lastSession().callbacks.onStatusChange('connected');

      const navObserver = (sdk as any).navigationObserver;
      navObserver.onBeforeUnload();

      const stored = sessionStorage.getItem('voice-sdk-session');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.config.serverUrl).toBe('ws://localhost:3100');
    });

    it('does not save session state on beforeunload when disconnected', async () => {
      sessionStorage.removeItem('voice-sdk-session');
      const navObserver = (sdk as any).navigationObserver;
      navObserver.onBeforeUnload();

      const stored = sessionStorage.getItem('voice-sdk-session');
      expect(stored).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Tool call routing (NEW) — real ActionRouter processes tool calls
  // ──────────────────────────────────────────────────────────────────
  describe('tool call routing', () => {
    it('routes built-in fillField tool call through real ActionRouter', async () => {
      const { fillField } = await import('../../src/actions/DOMActions');
      await sdk.start();

      const fc: FunctionCall = { id: 'fc-1', name: 'fillField', args: { fieldId: 'email', value: 'test@test.com' } };
      const result = await lastSession().callbacks.onToolCall(fc);

      // Real ActionRouter should have routed to the (mocked) fillField handler
      expect(fillField).toHaveBeenCalledWith({ fieldId: 'email', value: 'test@test.com' });
      expect(result).toEqual({ result: JSON.stringify({ success: true, fieldId: 'test' }) });
    });

    it('routes built-in clickElement tool call through real ActionRouter', async () => {
      const { clickElement } = await import('../../src/actions/DOMActions');
      await sdk.start();

      const fc: FunctionCall = { id: 'fc-2', name: 'clickElement', args: { description: 'Submit' } };
      const result = await lastSession().callbacks.onToolCall(fc);

      expect(clickElement).toHaveBeenCalledWith({ description: 'Submit' });
      expect(result).toEqual({ result: JSON.stringify({ success: true, clicked: 'test' }) });
    });

    it('routes built-in readContent tool call through real ActionRouter', async () => {
      const { readContent } = await import('../../src/actions/DOMActions');
      await sdk.start();

      const fc: FunctionCall = { id: 'fc-3', name: 'readContent', args: { selector: 'main' } };
      const result = await lastSession().callbacks.onToolCall(fc);

      expect(readContent).toHaveBeenCalledWith({ selector: 'main' });
      expect(result).toEqual({ result: JSON.stringify({ success: true, content: 'test' }) });
    });

    it('routes custom registered action and returns result', async () => {
      const customHandler = vi.fn().mockResolvedValue({ customResult: 'hello' });
      sdk.registerAction('myCustomAction', {
        declaration: { name: 'myCustomAction', description: 'Custom', parameters: { type: 'object', properties: {} } },
        handler: customHandler,
      });

      await sdk.start();

      const fc: FunctionCall = { id: 'fc-4', name: 'myCustomAction', args: { param1: 'value1' } };
      const result = await lastSession().callbacks.onToolCall(fc);

      expect(customHandler).toHaveBeenCalledWith({ param1: 'value1' });
      expect(JSON.parse(result.result)).toEqual({ customResult: 'hello' });
    });

    it('returns error for unknown tool calls via real ActionRouter', async () => {
      await sdk.start();

      const fc: FunctionCall = { id: 'fc-5', name: 'nonExistentTool', args: {} };
      const result = await lastSession().callbacks.onToolCall(fc);

      const parsed = JSON.parse(result.result);
      expect(parsed.error).toContain('Unknown action');
      expect(parsed.error).toContain('nonExistentTool');
    });

    it('emits action:before and action events during tool call routing', async () => {
      const beforeSpy = vi.fn();
      const actionSpy = vi.fn();
      sdk.on('action:before', beforeSpy);
      sdk.on('action', actionSpy);

      await sdk.start();

      const fc: FunctionCall = { id: 'fc-6', name: 'fillField', args: { fieldId: 'name', value: 'John' } };
      await lastSession().callbacks.onToolCall(fc);

      // action:before fires before routing; action fires after with result attached
      expect(beforeSpy).toHaveBeenCalledTimes(1);
      const beforeArgs = beforeSpy.mock.calls[0][0];
      expect(beforeArgs.name).toBe('fillField');
      expect(beforeArgs.args).toEqual({ fieldId: 'name', value: 'John' });

      expect(actionSpy).toHaveBeenCalledTimes(1);
      const actionArgs = actionSpy.mock.calls[0][0];
      expect(actionArgs.name).toBe('fillField');
      expect(actionArgs.args).toEqual({ fieldId: 'name', value: 'John' });
      expect(actionArgs.result).toBeDefined();
    });

    it('shows and removes tool status in UI during tool call', async () => {
      await sdk.start();

      const fc: FunctionCall = { id: 'fc-7', name: 'clickElement', args: { description: 'btn' } };
      await lastSession().callbacks.onToolCall(fc);

      expect(lastUI().showToolStatus).toHaveBeenCalledWith('clickElement');
      expect(lastUI().removeToolStatus).toHaveBeenCalled();
    });

    it('handles handler errors gracefully via real ActionRouter', async () => {
      const { fillField } = await import('../../src/actions/DOMActions');
      vi.mocked(fillField).mockRejectedValueOnce(new Error('Element not found'));

      await sdk.start();

      const fc: FunctionCall = { id: 'fc-8', name: 'fillField', args: { fieldId: 'missing', value: 'x' } };
      const result = await lastSession().callbacks.onToolCall(fc);

      const parsed = JSON.parse(result.result);
      expect(parsed.error).toBe('Element not found');
    });

    it('routes scanPage through the VoiceSDK handler (not DOMActions)', async () => {
      await sdk.start();

      const fc: FunctionCall = { id: 'fc-9', name: 'scanPage', args: {} };
      const result = await lastSession().callbacks.onToolCall(fc);

      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Context aggregation (NEW) — real ContextEngine + TextProvider
  // ──────────────────────────────────────────────────────────────────
  describe('context aggregation', () => {
    it('builds pageContext from autoContext page provider', async () => {
      const s = new VoiceSDK({ ...defaultConfig, autoContext: true });
      await s.start();

      // Page context from providers goes to pageContext, not systemInstruction
      expect(lastSession().config.pageContext).toContain('mock page context');
      await s.destroy();
    });

    it('builds system instruction from developer context string', async () => {
      const s = new VoiceSDK({ ...defaultConfig, context: 'This is a banking app' });
      await s.start();

      expect(lastSession().config.systemInstruction).toContain('This is a banking app');
      await s.destroy();
    });

    it('aggregates multiple context providers in pageContext', async () => {
      const s = new VoiceSDK({ ...defaultConfig, autoContext: true, context: 'Custom developer hint' });

      // Add a runtime provider
      s.addContext({
        type: 'extra',
        name: 'Extra Info',
        getContext: async () => ({ content: 'extra runtime context', tools: [] }),
      });

      await s.start();

      // Page context + runtime providers go to pageContext
      expect(lastSession().config.pageContext).toContain('mock page context');
      expect(lastSession().config.pageContext).toContain('extra runtime context');
      // Developer context goes to systemInstruction via template
      expect(lastSession().config.systemInstruction).toContain('Custom developer hint');
      await s.destroy();
    });

    it('includes context tools in session tool declarations', async () => {
      const customTool = {
        name: 'contextTool',
        description: 'from context',
        parameters: { type: 'OBJECT', properties: {} },
      };
      const s = new VoiceSDK({ ...defaultConfig });
      s.addContext({
        type: 'toolProvider',
        name: 'Tool Provider',
        getContext: async () => ({ content: 'with tools', tools: [customTool] }),
      });

      await s.start();
      const declarations = lastSession().config.tools[0].functionDeclarations;
      const names = declarations.map((t: any) => t.name);
      expect(names).toContain('contextTool');
      await s.destroy();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // State transitions (NEW) — IDLE -> CONNECTING -> CONNECTED -> LISTENING flow
  // ──────────────────────────────────────────────────────────────────
  describe('state transitions', () => {
    it('full lifecycle: DISCONNECTED -> CONNECTING -> CONNECTED -> DISCONNECTED', async () => {
      const states: string[] = [];
      sdk.on('stateChange', (e) => states.push(e.to));

      // start() -> CONNECTING
      await sdk.start();
      expect(states).toEqual([ConnectionState.CONNECTING]);

      // server connected -> CONNECTED
      lastSession().callbacks.onStatusChange('connected');
      expect(states).toEqual([ConnectionState.CONNECTING, ConnectionState.CONNECTED]);

      // stop() -> DISCONNECTED
      await sdk.stop();
      expect(states).toEqual([
        ConnectionState.CONNECTING,
        ConnectionState.CONNECTED,
        ConnectionState.DISCONNECTED,
      ]);
    });

    it('connection failure: DISCONNECTED -> CONNECTING -> ERROR', async () => {
      const states: string[] = [];
      sdk.on('stateChange', (e) => states.push(e.to));

      await sdk.start();
      lastSession().callbacks.onError('WebSocket connection error');

      expect(states).toEqual([ConnectionState.CONNECTING, ConnectionState.ERROR]);
      expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);
    });

    it('recovery from ERROR: ERROR -> CONNECTING -> CONNECTED', async () => {
      const states: string[] = [];
      sdk.on('stateChange', (e) => states.push(e.to));

      // Go to error state
      await sdk.start();
      lastSession().callbacks.onError('fail');
      expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);

      states.length = 0; // reset tracked states

      // Toggle to recover
      await sdk.toggle();
      expect(states[0]).toBe(ConnectionState.CONNECTING);

      // Simulate successful connection
      lastSession().callbacks.onStatusChange('connected');
      expect(states).toContain(ConnectionState.CONNECTED);
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);
    });

    it('UI receives connection state changes', async () => {
      await sdk.start();
      expect(lastUI().setConnectionState).toHaveBeenCalledWith(ConnectionState.CONNECTING);

      lastSession().callbacks.onStatusChange('connected');
      expect(lastUI().setConnectionState).toHaveBeenCalledWith(ConnectionState.CONNECTED);
    });

    it('UI receives speech state changes', async () => {
      await sdk.start();
      lastSession().callbacks.onSpeechStateChange(true, false, true);
      expect(lastUI().setSpeechState).toHaveBeenCalledWith(true, false);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Error handling (NEW)
  // ──────────────────────────────────────────────────────────────────
  describe('error handling', () => {
    it('connection failure sets ERROR state and UI reflects it', async () => {
      const errorSpy = vi.fn();
      sdk.on('error', errorSpy);

      await sdk.start();
      lastSession().callbacks.onError('connection refused');

      expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);
      expect(lastUI().setConnectionState).toHaveBeenCalledWith(ConnectionState.ERROR);
      expect(errorSpy).toHaveBeenCalledWith({ message: 'connection refused' });
    });

    it('sendText when not connected emits error', () => {
      const errorSpy = vi.fn();
      sdk.on('error', errorSpy);
      sdk.sendText('hello');
      expect(errorSpy).toHaveBeenCalledWith({ message: 'Not connected. Call start() first.' });
    });

    it('multiple errors dont stack — state stays ERROR', async () => {
      await sdk.start();
      lastSession().callbacks.onError('error 1');
      lastSession().callbacks.onError('error 2');
      expect(sdk.getConnectionState()).toBe(ConnectionState.ERROR);
    });

    it('start after destroy is a no-op', async () => {
      await sdk.destroy();
      await sdk.start();
      // Should still be in a non-connected state (destroyed SDK ignores start)
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // start()/stop() lifecycle (NEW) — repeated cycles
  // ──────────────────────────────────────────────────────────────────
  describe('start/stop lifecycle', () => {
    it('can start, stop, and start again', async () => {
      // First cycle
      await sdk.start();
      lastSession().callbacks.onStatusChange('connected');
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);

      await sdk.stop();
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);

      // Second cycle — should create a new ProxySession
      await sdk.start();
      expect(proxySessionInstances).toHaveLength(2);
      lastSession().callbacks.onStatusChange('connected');
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);
    });

    it('start rebuilds page context each time', async () => {
      sdk.setContext('context version 1');
      await sdk.start();
      const ctx1 = lastSession().config.pageContext;
      lastSession().callbacks.onStatusChange('connected');
      await sdk.stop();

      sdk.setContext('context version 2');
      await sdk.start();
      const ctx2 = lastSession().config.pageContext;

      expect(ctx1).toContain('context version 1');
      expect(ctx2).toContain('context version 2');
      expect(ctx1).not.toEqual(ctx2);
    });

    it('AI thinking indicator is cleared on tool call response', async () => {
      await sdk.start();

      // Simulate a tool call (VoiceSDK clears thinking on tool call)
      const fc: FunctionCall = { id: 'fc-t', name: 'readContent', args: { selector: 'main' } };
      await lastSession().callbacks.onToolCall(fc);

      expect(lastUI().setAIThinking).toHaveBeenCalledWith(false);
    });

    it('AI thinking indicator cleared on final AI transcript', async () => {
      await sdk.start();

      lastSession().callbacks.onTranscript('response text', 'ai', true);
      expect(lastUI().setAIThinking).toHaveBeenCalledWith(false);
    });
  });
});

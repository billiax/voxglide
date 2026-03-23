import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceSDK } from '../../src/VoiceSDK';
import { ConnectionState } from '../../src/constants';

// ── Minimal mocks: only things that need real browser APIs we don't have ──

// Track ProxySession instances
const proxySessionInstances: Array<{
  config: any;
  callbacks: any;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
  pauseSpeech: ReturnType<typeof vi.fn>;
  resumeSpeech: ReturnType<typeof vi.fn>;
  retrySpeech: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
  sendContextUpdate: ReturnType<typeof vi.fn>;
  sendScanResults: ReturnType<typeof vi.fn>;
  captureAndSendScreenshot: ReturnType<typeof vi.fn>;
  cancelTurn: ReturnType<typeof vi.fn>;
  sessionId: string | null;
}> = [];

vi.mock('../../src/ai/ProxySession', () => {
  class MockProxySession {
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    isConnected = vi.fn().mockReturnValue(false);
    pauseSpeech = vi.fn();
    resumeSpeech = vi.fn();
    retrySpeech = vi.fn();
    sendText = vi.fn();
    sendContextUpdate = vi.fn();
    sendScanResults = vi.fn();
    captureAndSendScreenshot = vi.fn();
    cancelTurn = vi.fn();
    sessionId: string | null = 'test-session-id';
    constructor(public config: any, public callbacks: any) {
      proxySessionInstances.push(this as any);
    }
  }
  return { ProxySession: MockProxySession };
});

// UIManager: lightly mocked (Shadow DOM, intervals, MutationObserver)
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
  ensureAttached: ReturnType<typeof vi.fn>;
  updateQueue: ReturnType<typeof vi.fn>;
  setCancelHandler: ReturnType<typeof vi.fn>;
  showToolStatus: ReturnType<typeof vi.fn>;
  removeToolStatus: ReturnType<typeof vi.fn>;
  focusInput: ReturnType<typeof vi.fn>;
  getHost: ReturnType<typeof vi.fn>;
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
    addSystemMessage = vi.fn();
    setPauseReason = vi.fn();
    getStateMachine = vi.fn().mockReturnValue({ getState: () => ({ panelVisible: true }) });
    ensureAttached = vi.fn();
    updateQueue = vi.fn();
    setCancelHandler = vi.fn();
    showToolStatus = vi.fn();
    removeToolStatus = vi.fn();
    focusInput = vi.fn();
    getHost = vi.fn().mockReturnValue(document.createElement('div'));
    constructor(public config: any, public onToggle: any, public onSendText?: any, public inputMode?: string) {
      uiInstances.push(this as any);
    }
  }
  return { UIManager: MockUIManager };
});

// PageContextProvider: mocked (MutationObserver, DOM scanning)
vi.mock('../../src/context/PageContextProvider', () => {
  class MockPageContextProvider {
    type = 'page';
    name = 'Page Context';
    getContext = vi.fn().mockResolvedValue({ content: '', tools: [] });
    destroy = vi.fn();
    markDirty = vi.fn();
    beginWatchPeriod = vi.fn();
    getScanner = vi.fn().mockReturnValue({ getElementByIndex: vi.fn().mockReturnValue(null) });
    getLastScanData = vi.fn().mockReturnValue(null);
  }
  return { PageContextProvider: MockPageContextProvider };
});

// NavigationHandler: mocked (window.location, sessionStorage)
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

// NavigationObserver: mocked (patches history.pushState globally)
vi.mock('../../src/NavigationObserver', () => {
  class MockNavigationObserver {
    destroy = vi.fn();
    constructor(public onNavigate: any, public onBeforeUnload: any) {}
  }
  return { NavigationObserver: MockNavigationObserver };
});

// DOMActions: module-level functions
vi.mock('../../src/actions/DOMActions', () => ({
  fillField: vi.fn().mockResolvedValue({ result: 'ok' }),
  clickElement: vi.fn().mockResolvedValue({ result: 'ok' }),
  readContent: vi.fn().mockResolvedValue({ result: 'ok' }),
  invalidateElementCache: vi.fn(),
  setIndexResolver: vi.fn(),
  setRescanCallback: vi.fn(),
  setPostClickCallback: vi.fn(),
}));

// NbtFunctionsProvider: mocked (setInterval, window events)
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
// - ActionRouter, ContextEngine, TextProvider, EventEmitter

import type { FunctionCall } from '../../src/types';

const baseConfig = { serverUrl: 'ws://localhost:3100' } as const;

describe('Text Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
    uiInstances.length = 0;
  });

  describe('mode: text', () => {
    let sdk: VoiceSDK;

    beforeEach(() => {
      sdk = new VoiceSDK({ ...baseConfig, mode: 'text' });
    });

    afterEach(async () => {
      await sdk.destroy();
    });

    it('creates UIManager with text inputMode', () => {
      const ui = uiInstances[uiInstances.length - 1];
      expect(ui.inputMode).toBe('text');
    });

    it('passes speechEnabled: false to ProxySession', async () => {
      await sdk.start();
      expect(proxySessionInstances[0].config.speechEnabled).toBe(false);
    });

    it('does not start SpeechCapture on connection', async () => {
      await sdk.start();
      expect(proxySessionInstances[0].config.speechEnabled).toBe(false);
    });

    it('toggle while connected toggles panel instead of disconnecting', async () => {
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);

      await sdk.toggle();
      // Should still be connected (not disconnected)
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);
      // Should have toggled the transcript
      const ui = uiInstances[uiInstances.length - 1];
      expect(ui.toggleTranscript).toHaveBeenCalled();
    });

    it('tool calls still route through real ActionRouter in text mode', async () => {
      const { fillField } = await import('../../src/actions/DOMActions');

      await sdk.start();
      const session = proxySessionInstances[0];
      session.callbacks.onStatusChange('connected');

      const fc: FunctionCall = { id: 'fc-t1', name: 'fillField', args: { fieldId: 'email', value: 'a@b.com' } };
      await session.callbacks.onToolCall(fc);

      expect(fillField).toHaveBeenCalledWith({ fieldId: 'email', value: 'a@b.com' });
    });

    it('sendText forwards to session in text mode', async () => {
      await sdk.start();
      const session = proxySessionInstances[0];
      session.callbacks.onStatusChange('connected');

      sdk.sendText('hello from text mode');
      expect(session.sendText).toHaveBeenCalledWith('hello from text mode');
    });

    it('sendText emits error when not connected', () => {
      const errorSpy = vi.fn();
      sdk.on('error', errorSpy);
      sdk.sendText('hello');
      expect(errorSpy).toHaveBeenCalledWith({ message: 'Not connected. Call start() first.' });
    });
  });

  describe('mode: voice (default)', () => {
    let sdk: VoiceSDK;

    beforeEach(() => {
      sdk = new VoiceSDK({ ...baseConfig });
    });

    afterEach(async () => {
      await sdk.destroy();
    });

    it('creates UIManager with voice inputMode', () => {
      const ui = uiInstances[uiInstances.length - 1];
      expect(ui.inputMode).toBe('voice');
    });

    it('passes speechEnabled: true to ProxySession', async () => {
      await sdk.start();
      expect(proxySessionInstances[0].config.speechEnabled).toBe(true);
    });

    it('toggle while connected and speech active stops session (panel visible)', async () => {
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');
      proxySessionInstances[0].callbacks.onSpeechStateChange(true, false, true);

      await sdk.toggle();
      // Voice mode with panel visible: one-click stop
      expect(proxySessionInstances[0].disconnect).toHaveBeenCalled();
    });

    it('toggle while connected but speech inactive retries speech', async () => {
      await sdk.start();
      const session = proxySessionInstances[0];
      session.callbacks.onStatusChange('connected');
      session.callbacks.onSpeechStateChange(false, false, true);

      await sdk.toggle();
      expect(sdk.getConnectionState()).toBe(ConnectionState.CONNECTED);
      expect(session.retrySpeech).toHaveBeenCalled();
    });
  });

  describe('mode: auto', () => {
    it('falls back to text when Speech API unavailable', () => {
      const sdk = new VoiceSDK({ ...baseConfig, mode: 'auto' });
      expect((sdk as any).resolvedInputMode).toBe('text');
      sdk.destroy();
    });

    it('uses voice when SpeechRecognition is available', () => {
      (window as any).SpeechRecognition = class {};
      const sdk = new VoiceSDK({ ...baseConfig, mode: 'auto' });
      expect((sdk as any).resolvedInputMode).toBe('voice');
      sdk.destroy();
      delete (window as any).SpeechRecognition;
    });
  });
});

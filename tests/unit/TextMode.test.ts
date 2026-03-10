import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceSDK } from '../../src/VoiceSDK';
import { ConnectionState } from '../../src/constants';

const {
  mockConnect, mockDisconnect,
  proxySessionInstances,
} = vi.hoisted(() => ({
  mockConnect: vi.fn().mockResolvedValue(undefined),
  mockDisconnect: vi.fn().mockResolvedValue(undefined),
  proxySessionInstances: [] as Array<{ config: any; callbacks: any; sessionId: string | null }>,
}));

vi.mock('../../src/ai/ProxySession', () => {
  class MockProxySession {
    connect = mockConnect;
    disconnect = mockDisconnect;
    isConnected = vi.fn().mockReturnValue(false);
    pauseSpeech = vi.fn();
    resumeSpeech = vi.fn();
    sessionId: string | null = 'test-session-id';
    sendText = vi.fn();
    sendContextUpdate = vi.fn();
    constructor(public config: any, public callbacks: any) {
      proxySessionInstances.push(this as any);
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
    toggleTranscript = vi.fn();
    showToolStatus = vi.fn();
    removeToolStatus = vi.fn();
    focusInput = vi.fn();
    constructor(public config: any, public onToggle: any, public onSendText?: any, public inputMode?: string) {}
  }
  return { UIManager: MockUIManager };
});

vi.mock('../../src/context/PageContextProvider', () => {
  class MockPageContextProvider {
    type = 'page';
    name = 'Page Context';
    getContext = vi.fn().mockResolvedValue({ content: '', tools: [] });
    destroy = vi.fn();
    markDirty = vi.fn();
  }
  return { PageContextProvider: MockPageContextProvider };
});

vi.mock('../../src/actions/NavigationHandler', () => {
  class MockNavigationHandler {
    navigateTo = vi.fn().mockResolvedValue({ result: 'ok' });
    setSessionId = vi.fn();
    static getPendingReconnect = vi.fn().mockReturnValue(null);
    static clearPendingReconnect = vi.fn();
  }
  return { NavigationHandler: MockNavigationHandler };
});

vi.mock('../../src/actions/DOMActions', () => ({
  fillField: vi.fn().mockResolvedValue({ result: 'ok' }),
  clickElement: vi.fn().mockResolvedValue({ result: 'ok' }),
  readContent: vi.fn().mockResolvedValue({ result: 'ok' }),
  invalidateElementCache: vi.fn(),
}));

const baseConfig = { serverUrl: 'ws://localhost:3100' } as const;

describe('Text Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
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
      const ui = (sdk as any).ui;
      expect(ui.inputMode).toBe('text');
    });

    it('passes speechEnabled: false to ProxySession', async () => {
      await sdk.start();
      expect(proxySessionInstances[0].config.speechEnabled).toBe(false);
    });

    it('does not start SpeechCapture on connection', async () => {
      await sdk.start();
      // Verify speechEnabled is false in config
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
      expect((sdk as any).ui.toggleTranscript).toHaveBeenCalled();
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
      const ui = (sdk as any).ui;
      expect(ui.inputMode).toBe('voice');
    });

    it('passes speechEnabled: true to ProxySession', async () => {
      await sdk.start();
      expect(proxySessionInstances[0].config.speechEnabled).toBe(true);
    });

    it('toggle while connected disconnects', async () => {
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');

      await sdk.toggle();
      expect(sdk.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('mode: auto', () => {
    it('falls back to text when Speech API unavailable', () => {
      // Default jsdom doesn't have SpeechRecognition
      const sdk = new VoiceSDK({ ...baseConfig, mode: 'auto' });
      expect((sdk as any).resolvedInputMode).toBe('text');
      sdk.destroy();
    });

    it('uses voice when SpeechRecognition is available', () => {
      // Mock SpeechRecognition
      (window as any).SpeechRecognition = class {};
      const sdk = new VoiceSDK({ ...baseConfig, mode: 'auto' });
      expect((sdk as any).resolvedInputMode).toBe('voice');
      sdk.destroy();
      delete (window as any).SpeechRecognition;
    });
  });
});

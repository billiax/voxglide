import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceSDK } from '../../src/VoiceSDK';

// ── Hoisted mocks shared across module mocks ──

const {
  mockConnect, mockDisconnect, mockIsConnected,
  mockGetPendingReconnect, mockClearPendingReconnect,
  proxySessionInstances,
  mockNavObserverDestroy,
  mockPauseSpeech, mockResumeSpeech,
} = vi.hoisted(() => ({
  mockConnect: vi.fn().mockResolvedValue(undefined),
  mockDisconnect: vi.fn().mockResolvedValue(undefined),
  mockIsConnected: vi.fn().mockReturnValue(false),
  mockGetPendingReconnect: vi.fn().mockReturnValue(null),
  mockClearPendingReconnect: vi.fn(),
  proxySessionInstances: [] as Array<{ config: any; callbacks: any; pauseSpeech: any; resumeSpeech: any }>,
  mockNavObserverDestroy: vi.fn(),
  mockPauseSpeech: vi.fn(),
  mockResumeSpeech: vi.fn(),
}));

vi.mock('../../src/ai/ProxySession', () => {
  class MockProxySession {
    connect = mockConnect;
    disconnect = mockDisconnect;
    isConnected = mockIsConnected;
    pauseSpeech = mockPauseSpeech;
    resumeSpeech = mockResumeSpeech;
    retrySpeech = vi.fn();
    cancelTurn = vi.fn();
    constructor(public config: any, public callbacks: any) {
      proxySessionInstances.push({ config, callbacks, pauseSpeech: this.pauseSpeech, resumeSpeech: this.resumeSpeech });
    }
  }
  return { ProxySession: MockProxySession };
});

vi.mock('../../src/ui/UIManager', () => {
  class MockUIManager {
    setConnectionState = vi.fn();
    setSpeechState = vi.fn();
    addTranscript = vi.fn();
    clearTranscript = vi.fn();
    showTranscript = vi.fn();
    hideTranscript = vi.fn();
    setAutoHideEnabled = vi.fn();
    destroy = vi.fn();
    setAIThinking = vi.fn();
    restoreTranscript = vi.fn();
    setDisconnectHandler = vi.fn();
    setMinimizeHandler = vi.fn();
    addSystemMessage = vi.fn();
    setPauseReason = vi.fn();
    ensureAttached = vi.fn();
    updateQueue = vi.fn();
    setCancelHandler = vi.fn();
    showToolStatus = vi.fn();
    removeToolStatus = vi.fn();
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
    markDirty = vi.fn();
    getScanner = vi.fn().mockReturnValue({ getElementByIndex: vi.fn().mockReturnValue(null) });
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

vi.mock('../../src/NavigationObserver', () => {
  class MockNavigationObserver {
    destroy = mockNavObserverDestroy;
    constructor(public onNavigate: any, public onBeforeUnload: any) {}
  }
  return { NavigationObserver: MockNavigationObserver };
});

vi.mock('../../src/actions/DOMActions', () => ({
  fillField: vi.fn().mockResolvedValue({ result: 'ok' }),
  clickElement: vi.fn().mockResolvedValue({ result: 'ok' }),
  readContent: vi.fn().mockResolvedValue({ result: 'ok' }),
  invalidateElementCache: vi.fn(),
  setIndexResolver: vi.fn(),
  setRescanCallback: vi.fn(),
  setPostClickCallback: vi.fn(),
}));

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

// ── Mock speechSynthesis ──

let mockSpeak: ReturnType<typeof vi.fn>;
let mockCancel: ReturnType<typeof vi.fn>;
let capturedUtterances: SpeechSynthesisUtterance[];

function installSpeechSynthesis(): void {
  mockSpeak = vi.fn();
  mockCancel = vi.fn();
  capturedUtterances = [];

  mockSpeak.mockImplementation((utterance: SpeechSynthesisUtterance) => {
    capturedUtterances.push(utterance);
  });

  Object.defineProperty(globalThis, 'speechSynthesis', {
    value: {
      speak: mockSpeak,
      cancel: mockCancel,
      speaking: false,
      pending: false,
      paused: false,
      getVoices: vi.fn().mockReturnValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onvoiceschanged: null,
    },
    writable: true,
    configurable: true,
  });
}

function removeSpeechSynthesis(): void {
  // Use delete + defineProperty to make speechSynthesis undefined
  Object.defineProperty(globalThis, 'speechSynthesis', {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

// Mock SpeechSynthesisUtterance (not in jsdom)
class MockUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onstart: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onresume: (() => void) | null = null;
  onmark: (() => void) | null = null;
  onboundary: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
  value: MockUtterance,
  writable: true,
  configurable: true,
});

const defaultConfig = { serverUrl: 'ws://localhost:3100' } as const;

describe('TTS (Text-to-Speech)', () => {
  let sdk: VoiceSDK;

  beforeEach(() => {
    vi.clearAllMocks();
    proxySessionInstances.length = 0;
    installSpeechSynthesis();
  });

  afterEach(async () => {
    if (sdk) {
      await sdk.destroy();
    }
  });

  async function startSDK(config: Record<string, unknown> = {}): Promise<void> {
    sdk = new VoiceSDK({ ...defaultConfig, tts: true, ...config });
    await sdk.start();
    proxySessionInstances[0].callbacks.onStatusChange('connected');
  }

  function triggerAITranscript(text: string): void {
    proxySessionInstances[0].callbacks.onTranscript(text, 'ai', true);
  }

  function triggerUserTranscript(text: string): void {
    proxySessionInstances[0].callbacks.onTranscript(text, 'user', true);
  }

  describe('speak()', () => {
    it('creates SpeechSynthesisUtterance with correct text', async () => {
      await startSDK();
      triggerAITranscript('Hello, how can I help?');

      expect(mockSpeak).toHaveBeenCalledTimes(1);
      expect(capturedUtterances).toHaveLength(1);
      expect(capturedUtterances[0].text).toBe('Hello, how can I help?');
    });

    it('calls speechSynthesis.speak()', async () => {
      await startSDK();
      triggerAITranscript('Hello');

      expect(mockSpeak).toHaveBeenCalledTimes(1);
      const arg = mockSpeak.mock.calls[0][0];
      expect(arg).toBeInstanceOf(MockUtterance);
    });

    it('applies default language (en-US)', async () => {
      await startSDK();
      triggerAITranscript('Hello');

      expect(capturedUtterances[0].lang).toBe('en-US');
    });

    it('applies configured language', async () => {
      await startSDK({ language: 'de-DE' });
      triggerAITranscript('Hallo');

      expect(capturedUtterances[0].lang).toBe('de-DE');
    });

    it('pauses speech recognition before speaking', async () => {
      await startSDK();
      triggerAITranscript('Hello');

      expect(mockPauseSpeech).toHaveBeenCalledTimes(1);
    });

    it('resumes speech recognition after utterance ends', async () => {
      await startSDK();
      triggerAITranscript('Hello');

      expect(mockResumeSpeech).not.toHaveBeenCalled();

      // Simulate utterance finishing
      capturedUtterances[0].onend!();
      expect(mockResumeSpeech).toHaveBeenCalledTimes(1);
    });

    it('resumes speech recognition on utterance error', async () => {
      await startSDK();
      triggerAITranscript('Hello');

      expect(mockResumeSpeech).not.toHaveBeenCalled();

      // Simulate utterance error
      capturedUtterances[0].onerror!();
      expect(mockResumeSpeech).toHaveBeenCalledTimes(1);
    });
  });

  describe('TTS disabled', () => {
    it('does not speak when tts is false', async () => {
      sdk = new VoiceSDK({ ...defaultConfig, tts: false });
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');

      triggerAITranscript('Hello');
      expect(mockSpeak).not.toHaveBeenCalled();
    });

    it('does not speak when tts is not configured (default)', async () => {
      sdk = new VoiceSDK({ ...defaultConfig });
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');

      triggerAITranscript('Hello');
      expect(mockSpeak).not.toHaveBeenCalled();
    });
  });

  describe('cancelTTS()', () => {
    it('calls speechSynthesis.cancel() on stop', async () => {
      await startSDK();
      await sdk.stop();

      expect(mockCancel).toHaveBeenCalled();
    });

    it('calls speechSynthesis.cancel() on destroy', async () => {
      await startSDK();
      await sdk.destroy();

      expect(mockCancel).toHaveBeenCalled();
    });
  });

  describe('speaker filtering', () => {
    it('does not speak user transcripts', async () => {
      await startSDK();
      triggerUserTranscript('Hello from user');

      expect(mockSpeak).not.toHaveBeenCalled();
    });

    it('does not speak non-final AI transcripts', async () => {
      await startSDK();
      // Trigger a non-final transcript
      proxySessionInstances[0].callbacks.onTranscript('partial', 'ai', false);

      expect(mockSpeak).not.toHaveBeenCalled();
    });

    it('only speaks final AI transcripts', async () => {
      await startSDK();

      // Non-final: should not speak
      proxySessionInstances[0].callbacks.onTranscript('partial text', 'ai', false);
      expect(mockSpeak).not.toHaveBeenCalled();

      // Final: should speak
      proxySessionInstances[0].callbacks.onTranscript('complete text', 'ai', true);
      expect(mockSpeak).toHaveBeenCalledTimes(1);
      expect(capturedUtterances[0].text).toBe('complete text');
    });
  });

  describe('multiple speeches', () => {
    it('handles multiple AI responses sequentially', async () => {
      await startSDK();

      triggerAITranscript('First response');
      triggerAITranscript('Second response');

      expect(mockSpeak).toHaveBeenCalledTimes(2);
      expect(capturedUtterances[0].text).toBe('First response');
      expect(capturedUtterances[1].text).toBe('Second response');
    });

    it('pauses speech for each new utterance', async () => {
      await startSDK();

      triggerAITranscript('First');
      triggerAITranscript('Second');

      expect(mockPauseSpeech).toHaveBeenCalledTimes(2);
    });
  });

  describe('missing speechSynthesis', () => {
    it('handles missing speechSynthesis gracefully on speak', async () => {
      removeSpeechSynthesis();

      sdk = new VoiceSDK({ ...defaultConfig, tts: true });
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');

      // Should not throw
      expect(() => triggerAITranscript('Hello')).not.toThrow();
      // No utterances created since speechSynthesis is undefined
      expect(capturedUtterances).toHaveLength(0);
    });

    it('handles missing speechSynthesis gracefully on cancel', async () => {
      removeSpeechSynthesis();

      sdk = new VoiceSDK({ ...defaultConfig, tts: true });
      await sdk.start();
      proxySessionInstances[0].callbacks.onStatusChange('connected');

      // stop() calls cancelTTS — should not throw
      await expect(sdk.stop()).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('handles empty text', async () => {
      await startSDK();
      triggerAITranscript('');

      // speak() is called but with empty text — it does not guard against this
      expect(mockSpeak).toHaveBeenCalledTimes(1);
      expect(capturedUtterances[0].text).toBe('');
    });

    it('handles very long text', async () => {
      await startSDK();
      const longText = 'word '.repeat(5000).trim();
      triggerAITranscript(longText);

      expect(mockSpeak).toHaveBeenCalledTimes(1);
      expect(capturedUtterances[0].text).toBe(longText);
    });

    it('sets onend and onerror handlers on each utterance', async () => {
      await startSDK();
      triggerAITranscript('Hello');

      expect(capturedUtterances[0].onend).toBeTypeOf('function');
      expect(capturedUtterances[0].onerror).toBeTypeOf('function');
    });
  });
});

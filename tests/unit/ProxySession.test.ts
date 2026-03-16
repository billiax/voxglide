import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock SpeechCapture before importing ProxySession
vi.mock('../../src/ai/SpeechCapture', () => {
  class MockSpeechCapture {
    start = vi.fn();
    stop = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
  }
  return { SpeechCapture: MockSpeechCapture };
});

import { ProxySession } from '../../src/ai/ProxySession';
import type { ProxySessionConfig, ProxySessionCallbacks } from '../../src/ai/types';

// ── Mock WebSocket ──

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: any) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: any): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  sentParsed(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }

  sentOfType(type: string): any[] {
    return this.sentParsed().filter((m) => m.type === type);
  }
}

// Replace global WebSocket with mock
let mockWsInstance: MockWebSocket;
const OriginalWebSocket = globalThis.WebSocket;

function makeConfig(overrides?: Partial<ProxySessionConfig>): ProxySessionConfig {
  return {
    serverUrl: 'ws://localhost:3100',
    systemInstruction: 'test',
    tools: [],
    languageCode: 'en-US',
    debug: false,
    speechEnabled: false,
    ...overrides,
  };
}

function makeCallbacks(overrides?: Partial<ProxySessionCallbacks>): ProxySessionCallbacks {
  return {
    onStatusChange: vi.fn(),
    onTranscript: vi.fn(),
    onToolCall: vi.fn().mockResolvedValue({ result: 'ok' }),
    onError: vi.fn(),
    onSessionEnd: vi.fn(),
    onTokenUpdate: vi.fn(),
    onDebug: vi.fn(),
    ...overrides,
  };
}

describe('ProxySession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mock WebSocket constructor
    (globalThis as any).WebSocket = class extends MockWebSocket {
      constructor() {
        super();
        mockWsInstance = this;
      }
      // Expose constants on instance (browser WebSocket has these)
      static readonly OPEN = MockWebSocket.OPEN;
      static readonly CONNECTING = MockWebSocket.CONNECTING;
      static readonly CLOSING = MockWebSocket.CLOSING;
      static readonly CLOSED = MockWebSocket.CLOSED;
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).WebSocket = OriginalWebSocket;
  });

  // Helper: connect a session and simulate server handshake
  async function connectSession(
    config?: Partial<ProxySessionConfig>,
    callbacks?: Partial<ProxySessionCallbacks>,
  ): Promise<{ session: ProxySession; ws: MockWebSocket; cbs: ProxySessionCallbacks }> {
    const cbs = makeCallbacks(callbacks);
    const session = new ProxySession(makeConfig(config), cbs);

    const connectPromise = session.connect();
    mockWsInstance.simulateOpen();
    mockWsInstance.simulateMessage({ type: 'session.started', sessionId: 'test-sid' });
    await connectPromise;

    return { session, ws: mockWsInstance, cbs };
  }

  // ── Speech Debounce Tests ──

  describe('speech debounce', () => {
    it('batches rapid isFinal results into a single send', async () => {
      const session = new ProxySession(makeConfig({ speechEnabled: false }), makeCallbacks());
      const sessionConnect = session.connect();
      const ws = mockWsInstance;
      ws.simulateOpen();
      ws.simulateMessage({ type: 'session.started', sessionId: 'sid2' });
      await sessionConnect;

      // Test debounce behavior via the private debounceSpeechSend method
      const debounceFn = (session as any).debounceSpeechSend.bind(session);

      // Rapid calls
      debounceFn('change surname to Smith');
      debounceFn('and set email to test@email.com');

      // Before timeout: nothing sent
      const textMsgsBefore = ws.sentOfType('text');
      expect(textMsgsBefore).toHaveLength(0);

      // After timeout: single combined message
      vi.advanceTimersByTime(800);
      const textMsgs = ws.sentOfType('text');
      expect(textMsgs).toHaveLength(1);
      expect(textMsgs[0].text).toBe('change surname to Smith and set email to test@email.com');

      await session.disconnect();
    });

    it('resets timer on each new isFinal', async () => {
      const session = new ProxySession(makeConfig(), makeCallbacks());
      const sessionConnect = session.connect();
      const ws = mockWsInstance;
      ws.simulateOpen();
      ws.simulateMessage({ type: 'session.started', sessionId: 'sid' });
      await sessionConnect;

      const debounceFn = (session as any).debounceSpeechSend.bind(session);

      debounceFn('hello');
      vi.advanceTimersByTime(100); // 100ms in, not yet fired (150ms debounce)
      debounceFn('world');
      vi.advanceTimersByTime(100); // 100ms after second call, still not 150
      expect(ws.sentOfType('text')).toHaveLength(0);

      vi.advanceTimersByTime(50); // Now 150ms after second call
      const msgs = ws.sentOfType('text');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].text).toBe('hello world');

      await session.disconnect();
    });

    it('sendText bypasses debounce', async () => {
      const { session, ws } = await connectSession();

      session.sendText('direct message');
      // Should send immediately, no debounce
      const msgs = ws.sentOfType('text');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].text).toBe('direct message');

      await session.disconnect();
    });

    it('flushes debounce on disconnect', async () => {
      const { session, ws } = await connectSession();

      const debounceFn = (session as any).debounceSpeechSend.bind(session);
      debounceFn('pending speech');

      // Not yet sent
      expect(ws.sentOfType('text')).toHaveLength(0);

      await session.disconnect();

      // Should have been flushed before disconnect
      const msgs = ws.sentOfType('text');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].text).toBe('pending speech');
    });
  });

  // ── Send Queue Tests ──

  describe('send queue', () => {
    it('queues text messages when WS is not OPEN', async () => {
      const cbs = makeCallbacks();
      const session = new ProxySession(makeConfig(), cbs);

      // sendText before connection — ws is null
      session.sendText('queued message');
      // Can't verify queue directly, but it should not throw

      // Now connect
      const connectPromise = session.connect();
      const ws = mockWsInstance;
      ws.simulateOpen();
      ws.simulateMessage({ type: 'session.started', sessionId: 'sid' });
      await connectPromise;

      // The queued message should have been flushed
      const msgs = ws.sentOfType('text');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].text).toBe('queued message');

      await session.disconnect();
    });

    it('does not queue non-text messages', async () => {
      const cbs = makeCallbacks();
      const session = new ProxySession(makeConfig(), cbs);

      // Try to send a tool.progress before connection
      (session as any).send({ type: 'tool.progress', toolName: 'test', status: 'executing' });

      // Connect
      const connectPromise = session.connect();
      const ws = mockWsInstance;
      ws.simulateOpen();
      ws.simulateMessage({ type: 'session.started', sessionId: 'sid' });
      await connectPromise;

      // Should not see tool.progress flushed (only session.start from handshake)
      const progressMsgs = ws.sentOfType('tool.progress');
      expect(progressMsgs).toHaveLength(0);

      await session.disconnect();
    });

    it('respects MAX_QUEUE_SIZE', async () => {
      const cbs = makeCallbacks();
      const session = new ProxySession(makeConfig(), cbs);

      // Queue more than MAX_QUEUE_SIZE (20) text messages
      for (let i = 0; i < 25; i++) {
        session.sendText(`msg ${i}`);
      }

      const connectPromise = session.connect();
      const ws = mockWsInstance;
      ws.simulateOpen();
      ws.simulateMessage({ type: 'session.started', sessionId: 'sid' });
      await connectPromise;

      // Should have at most 20 text messages flushed
      const msgs = ws.sentOfType('text');
      expect(msgs.length).toBeLessThanOrEqual(20);

      await session.disconnect();
    });

    it('clears queue on disconnect', async () => {
      const { session } = await connectSession();

      // Disconnect (which clears queue)
      await session.disconnect();

      // Now queue something while disconnected
      session.sendText('should be queued');

      // The internal queue should have the message
      const queue = (session as any).sendQueue;
      expect(queue).toHaveLength(1);

      // Disconnect again — clears queue
      await session.disconnect();
      expect((session as any).sendQueue).toHaveLength(0);
    });
  });

  // ── turnId Echo Tests ──

  describe('turnId echo', () => {
    it('echoes turnId from toolCall in toolResult', async () => {
      const onToolCall = vi.fn().mockResolvedValue({ result: 'done' });
      const { session, ws } = await connectSession({}, { onToolCall });

      // Simulate server sending a toolCall with turnId
      ws.simulateMessage({
        type: 'toolCall',
        functionCalls: [{ id: 'fc1', name: 'fillField', args: { selector: '#name', value: 'John' } }],
        turnId: 'turn-abc-123',
      });

      // Wait for tool call handler to complete
      await vi.advanceTimersByTimeAsync(0);

      // Find the toolResult message
      const toolResults = ws.sentOfType('toolResult');
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0].turnId).toBe('turn-abc-123');
      expect(toolResults[0].functionResponses).toHaveLength(1);

      await session.disconnect();
    });

    it('omits turnId when server does not send one (backward compat)', async () => {
      const onToolCall = vi.fn().mockResolvedValue({ result: 'done' });
      const { session, ws } = await connectSession({}, { onToolCall });

      // Simulate server sending a toolCall without turnId
      ws.simulateMessage({
        type: 'toolCall',
        functionCalls: [{ id: 'fc2', name: 'clickElement', args: { selector: '#btn' } }],
      });

      await vi.advanceTimersByTimeAsync(0);

      const toolResults = ws.sentOfType('toolResult');
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0].turnId).toBeUndefined();

      await session.disconnect();
    });
  });

  // ── Basic Connection Tests ──

  describe('connection', () => {
    it('sends session.start on open', async () => {
      const { ws } = await connectSession();
      const startMsgs = ws.sentOfType('session.start');
      expect(startMsgs).toHaveLength(1);
    });

    it('stores sessionId from session.started', async () => {
      const { session } = await connectSession();
      expect(session.sessionId).toBe('test-sid');
      await session.disconnect();
    });

    it('calls onStatusChange(connected) on session.started', async () => {
      const { cbs } = await connectSession();
      expect(cbs.onStatusChange).toHaveBeenCalledWith('connected');
    });

    it('isConnected returns true when WS is OPEN', async () => {
      const { session } = await connectSession();
      expect(session.isConnected()).toBe(true);
      await session.disconnect();
    });

    it('isConnected returns false after disconnect', async () => {
      const { session } = await connectSession();
      await session.disconnect();
      expect(session.isConnected()).toBe(false);
    });
  });

  // ── Queue Update Tests ──

  describe('queue.update', () => {
    it('calls onQueueUpdate when queue.update message received', async () => {
      const onQueueUpdate = vi.fn();
      const { session, ws } = await connectSession({}, { onQueueUpdate });

      ws.simulateMessage({
        type: 'queue.update',
        active: { turnId: 't1', text: 'hello', status: 'processing' },
        queued: [{ turnId: 't2', text: 'world', status: 'queued' }],
      });

      expect(onQueueUpdate).toHaveBeenCalledWith({
        active: { turnId: 't1', text: 'hello', status: 'processing' },
        queued: [{ turnId: 't2', text: 'world', status: 'queued' }],
      });

      await session.disconnect();
    });

    it('handles empty queue.update', async () => {
      const onQueueUpdate = vi.fn();
      const { session, ws } = await connectSession({}, { onQueueUpdate });

      ws.simulateMessage({ type: 'queue.update', active: null, queued: [] });

      expect(onQueueUpdate).toHaveBeenCalledWith({ active: null, queued: [] });

      await session.disconnect();
    });

    it('does not throw when onQueueUpdate is not set', async () => {
      const { session, ws } = await connectSession();

      // Should not throw
      ws.simulateMessage({
        type: 'queue.update',
        active: null,
        queued: [],
      });

      await session.disconnect();
    });
  });

  // ── Cancel Turn Tests ──

  describe('cancelTurn', () => {
    it('sends turn.cancel message', async () => {
      const { session, ws } = await connectSession();

      session.cancelTurn('turn-123');

      const cancelMsgs = ws.sentOfType('turn.cancel');
      expect(cancelMsgs).toHaveLength(1);
      expect(cancelMsgs[0].turnId).toBe('turn-123');

      await session.disconnect();
    });
  });
});

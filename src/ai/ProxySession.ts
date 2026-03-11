import { SpeechCapture } from './SpeechCapture';
import type { ProxySessionConfig, ProxySessionCallbacks, DebugEvent } from './types';

/**
 * Connects to the VoxGlide proxy server via WebSocket.
 * Sends text (from browser speech recognition) and receives
 * text responses + tool calls from the server.
 */
export class ProxySession {
  private ws: WebSocket | null = null;
  private speechCapture: SpeechCapture | null = null;
  private config: ProxySessionConfig;
  private callbacks: ProxySessionCallbacks;
  private pendingToolResults: Map<string, (results: any[]) => void> = new Map();
  private streamingText = '';

  // Speech debounce: batches rapid isFinal results into a single send
  private speechDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private speechDebounceText = '';
  private static readonly SPEECH_DEBOUNCE_MS = 800;

  // Speech debounce max delay cap
  private speechDebounceStart: number | null = null;
  private static readonly SPEECH_MAX_DEBOUNCE_MS = 2000;

  // Send queue: buffers text messages when WS is not OPEN
  private sendQueue: Array<{ type: string;[key: string]: any }> = [];
  private static readonly MAX_QUEUE_SIZE = 20;

  // Dual pause tracking for voice ↔ text input mutual exclusion
  private textInputActive = false;
  private ttsPaused = false;

  // Pending context update during speech debounce
  private pendingContextUpdate: string | null = null;

  /** The server-assigned session ID, available after connection. */
  public sessionId: string | null = null;

  constructor(config: ProxySessionConfig, callbacks: ProxySessionCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  private debug(event: Omit<DebugEvent, 'timestamp'>): void {
    this.callbacks.onDebug({ ...event, timestamp: Date.now() });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.debug({ direction: 'info', kind: 'connection', payload: { url: this.config.serverUrl } });

        this.ws = new WebSocket(this.config.serverUrl);

        this.ws.onopen = () => {
          this.debug({ direction: 'send', kind: 'session', payload: { event: 'session.start' } });

          // Send session config to server (include sessionId for reconnection)
          this.send({
            type: 'session.start',
            sessionId: this.config.sessionId || undefined,
            config: {
              systemInstruction: this.config.systemInstruction,
              tools: this.config.tools,
            },
          });
        };

        this.ws.onmessage = (event) => {
          let msg: any;
          try {
            msg = JSON.parse(event.data as string);
          } catch {
            return;
          }

          this.debug({ direction: 'recv', kind: msg.type, payload: msg });
          this.handleMessage(msg, resolve);
        };

        this.ws.onclose = () => {
          this.debug({ direction: 'recv', kind: 'session', payload: { event: 'close' } });
          this.callbacks.onStatusChange('disconnected');
        };

        this.ws.onerror = (err) => {
          this.debug({ direction: 'error', kind: 'session', payload: { error: err } });
          this.callbacks.onError('WebSocket connection error');
          reject(new Error('WebSocket connection error'));
        };
      } catch (err: any) {
        reject(err);
      }
    });
  }

  private handleMessage(msg: any, onReady?: (value: void) => void): void {
    switch (msg.type) {
      case 'session.started':
        // Store server-assigned session ID
        if (msg.sessionId) {
          this.sessionId = msg.sessionId;
        }
        this.callbacks.onStatusChange('connected');
        this.flushSendQueue();
        if (this.config.speechEnabled) {
          this.startSpeechCapture();
        }
        onReady?.();
        break;

      case 'response.delta':
        // Streaming chunk — accumulate and show partial
        this.streamingText += msg.text;
        // Cap streaming accumulator to prevent unbounded growth
        if (this.streamingText.length > 10_000) {
          this.streamingText = this.streamingText.slice(-8_000);
        }
        this.callbacks.onTranscript(this.streamingText, 'ai', false);
        break;

      case 'response':
        // Final response — reset streaming accumulator
        this.streamingText = '';
        this.callbacks.onTranscript(msg.text, 'ai', true);
        break;

      case 'toolCall':
        this.handleToolCalls(msg.functionCalls, msg.turnId);
        break;

      case 'usage':
        this.callbacks.onTokenUpdate({
          totalTokens: msg.totalTokens || 0,
          inputTokens: msg.inputTokens || 0,
          outputTokens: msg.outputTokens || 0,
        });
        break;

      case 'session.ended':
        this.callbacks.onSessionEnd({ totalTokens: 0, inputTokens: 0, outputTokens: 0 });
        break;

      case 'session.stopped':
        this.callbacks.onStatusChange('disconnected');
        break;

      case 'screenshot.request':
        this.captureAndSendScreenshot(msg.requestId);
        break;

      case 'error':
        this.callbacks.onError(msg.message || 'Server error');
        break;
    }
  }

  // ── Screenshot capture (non-blocking, for admin monitoring) ──

  private screenshotInProgress = false;

  /**
   * Capture a screenshot and send it to the server. Non-blocking (fire-and-forget).
   * Skips if a capture is already in progress. Used both for automatic captures
   * (page changes) and on-demand requests from the admin dashboard.
   */
  captureAndSendScreenshot(requestId?: string): void {
    if (this.screenshotInProgress) return;
    this.screenshotInProgress = true;

    this.doScreenshotCapture(requestId).finally(() => {
      this.screenshotInProgress = false;
    });
  }

  private async doScreenshotCapture(requestId?: string): Promise<void> {
    try {
      const html2canvas = await this.loadHtml2Canvas();
      if (!html2canvas) {
        if (requestId) {
          this.send({ type: 'screenshot.error', error: 'Failed to load screenshot library', requestId });
        }
        return;
      }
      const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        allowTaint: true,
        scale: window.devicePixelRatio > 1 ? 0.5 : 0.75,
        windowWidth: Math.min(document.documentElement.clientWidth, 1440),
        windowHeight: Math.min(document.documentElement.clientHeight, 900),
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      const base64 = dataUrl.split(',')[1];
      this.send({ type: 'screenshot', image: base64, url: window.location.href, requestId });
    } catch (err: any) {
      if (requestId) {
        this.send({ type: 'screenshot.error', error: err.message || 'Screenshot capture failed', requestId });
      }
    }
  }

  private async loadHtml2Canvas(): Promise<any> {
    if ((window as any).html2canvas) return (window as any).html2canvas;

    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.onload = () => resolve((window as any).html2canvas);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }

  private startSpeechCapture(): void {
    this.speechCapture = new SpeechCapture(this.config.languageCode);
    this.speechCapture.start(
      (text, isFinal) => {
        // Emit user transcript locally
        this.callbacks.onTranscript(text, 'user', isFinal);

        // Only send final transcripts to server, debounced to batch rapid finals
        if (isFinal && text.trim()) {
          this.debounceSpeechSend(text.trim());
        }
      },
      (listening) => {
        this.debug({ direction: 'info', kind: 'speech', payload: { listening } });
      },
    );
  }

  /**
   * Batches rapid isFinal speech results into a single server send.
   * Resets/extends an 800ms timer on each call, but caps total delay at 2000ms.
   * On timeout, sends the combined text and flushes any pending context update.
   */
  private debounceSpeechSend(text: string): void {
    if (this.speechDebounceText) {
      this.speechDebounceText += ' ' + text;
    } else {
      this.speechDebounceText = text;
    }

    // Track when batching started
    if (this.speechDebounceStart === null) {
      this.speechDebounceStart = Date.now();
    }

    if (this.speechDebounceTimer) {
      clearTimeout(this.speechDebounceTimer);
    }

    const elapsed = Date.now() - this.speechDebounceStart;

    // If max debounce time exceeded, flush immediately
    if (elapsed >= ProxySession.SPEECH_MAX_DEBOUNCE_MS) {
      this.flushSpeechDebounce();
      return;
    }

    // Cap the timer delay to remaining time within max debounce window
    const remaining = ProxySession.SPEECH_MAX_DEBOUNCE_MS - elapsed;
    const delay = Math.min(ProxySession.SPEECH_DEBOUNCE_MS, remaining);

    this.speechDebounceTimer = setTimeout(() => {
      this.speechDebounceTimer = null;
      this.speechDebounceStart = null;
      const combined = this.speechDebounceText;
      this.speechDebounceText = '';
      if (combined) {
        this.send({ type: 'text', text: combined });
      }
      // Flush any pending context update that was deferred during speech debounce
      this.flushPendingContextUpdate();
    }, delay);
  }

  /**
   * Immediately sends any pending debounced speech text.
   * Called on disconnect to avoid losing speech in progress.
   * Also flushes any pending context update.
   */
  private flushSpeechDebounce(): void {
    if (this.speechDebounceTimer) {
      clearTimeout(this.speechDebounceTimer);
      this.speechDebounceTimer = null;
    }
    this.speechDebounceStart = null;
    const combined = this.speechDebounceText;
    this.speechDebounceText = '';
    if (combined) {
      this.send({ type: 'text', text: combined });
    }
    // Flush any pending context update that was deferred during speech debounce
    this.flushPendingContextUpdate();
  }

  /**
   * Send any pending context update that was deferred during speech debounce.
   */
  private flushPendingContextUpdate(): void {
    if (this.pendingContextUpdate !== null) {
      const context = this.pendingContextUpdate;
      this.pendingContextUpdate = null;
      this.debug({ direction: 'send', kind: 'context.update', payload: { length: context.length, deferred: true } });
      this.send({ type: 'context.update', context });
    }
  }

  private async handleToolCalls(
    functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
    turnId?: string,
  ): Promise<void> {
    const functionResponses = await Promise.all(
      functionCalls.map(async (fc) => {
        try {
          this.sendToolProgress(fc.name, 'executing', fc.id);
          const result = await this.callbacks.onToolCall(fc);
          this.sendToolProgress(fc.name, 'completed', fc.id);
          return { id: fc.id, name: fc.name, response: result || { result: 'Action completed.' } };
        } catch (err: any) {
          this.sendToolProgress(fc.name, 'failed', fc.id);
          return { id: fc.id, name: fc.name, response: { result: JSON.stringify({ error: err.message }) } };
        }
      }),
    );

    this.debug({ direction: 'send', kind: 'toolResult', payload: functionResponses });
    // Echo turnId back to server for turn-scoped tool result routing
    const msg: any = { type: 'toolResult', functionResponses };
    if (turnId) msg.turnId = turnId;
    this.send(msg);
  }

  /**
   * Send tool execution progress to the server for admin monitoring.
   */
  sendToolProgress(toolName: string, status: 'executing' | 'completed' | 'failed', callId?: string): void {
    this.send({ type: 'tool.progress', toolName, status, callId });
  }

  private send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else if (data.type === 'text' && this.sendQueue.length < ProxySession.MAX_QUEUE_SIZE) {
      // Queue text messages when WS is not OPEN (other types are timing-sensitive)
      this.sendQueue.push(data);
    }
  }

  /**
   * Flush queued text messages after (re)connection.
   */
  private flushSendQueue(): void {
    const queued = this.sendQueue.splice(0);
    for (const msg of queued) {
      this.send(msg);
    }
  }

  async disconnect(): Promise<void> {
    // Flush any pending debounced speech before disconnecting
    this.flushSpeechDebounce();

    if (this.speechCapture) {
      this.speechCapture.stop();
      this.speechCapture = null;
    }

    // Clear send queue — stale messages should not be sent on next connection
    this.sendQueue.length = 0;

    if (this.ws) {
      // Clear handlers BEFORE closing to prevent stale callbacks
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      try {
        this.send({ type: 'session.stop' });
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }

    // Single authoritative disconnect notification (after cleanup)
    this.callbacks.onStatusChange('disconnected');
  }

  /**
   * Send text directly to the server (text mode / debugging).
   * Flushes any pending speech debounce first to avoid race conditions.
   */
  sendText(text: string): void {
    if (!text.trim()) return;
    this.flushSpeechDebounce();
    this.callbacks.onTranscript(text, 'user', true);
    this.send({ type: 'text', text: text.trim() });
  }

  /**
   * Send page scan results to the server for admin monitoring.
   */
  sendScanResults(scanData: any): void {
    this.send({ type: 'scan', data: scanData });
  }

  /**
   * Send a context update to the server mid-session.
   * If speech debounce is pending, defers the update to avoid interleaving.
   */
  sendContextUpdate(context: string): void {
    // If speech debounce is in progress, defer context update
    if (this.speechDebounceTimer !== null) {
      this.pendingContextUpdate = context;
      this.debug({ direction: 'send', kind: 'context.update', payload: { length: context.length, deferred: true } });
      return;
    }
    this.debug({ direction: 'send', kind: 'context.update', payload: { length: context.length } });
    this.send({ type: 'context.update', context });
  }

  /**
   * Pause speech recognition for TTS playback.
   */
  pauseSpeech(): void {
    this.ttsPaused = true;
    this.speechCapture?.pause();
  }

  /**
   * Resume speech recognition after TTS playback.
   * Only resumes if text input is not also active.
   */
  resumeSpeech(): void {
    this.ttsPaused = false;
    if (!this.textInputActive) {
      this.speechCapture?.resume();
    }
  }

  /**
   * Pause speech recognition when text input becomes active.
   */
  pauseSpeechForTextInput(): void {
    this.textInputActive = true;
    this.speechCapture?.pause();
  }

  /**
   * Resume speech recognition when text input is dismissed.
   * Only resumes if TTS is not also paused.
   */
  resumeSpeechFromTextInput(): void {
    this.textInputActive = false;
    if (!this.ttsPaused) {
      this.speechCapture?.resume();
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

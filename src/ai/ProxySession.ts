import { SpeechCapture } from './SpeechCapture';
import type { ProxySessionConfig, ProxySessionCallbacks, TokenUsage, DebugEvent } from './types';

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

          // Send session config to server
          this.send({
            type: 'session.start',
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
        this.callbacks.onStatusChange('connected');
        this.startSpeechCapture();
        onReady?.();
        break;

      case 'response':
        this.callbacks.onTranscript(msg.text, 'ai', true);
        break;

      case 'toolCall':
        this.handleToolCalls(msg.functionCalls);
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

      case 'error':
        this.callbacks.onError(msg.message || 'Server error');
        break;
    }
  }

  private startSpeechCapture(): void {
    this.speechCapture = new SpeechCapture(this.config.languageCode);
    this.speechCapture.start(
      (text, isFinal) => {
        // Emit user transcript locally
        this.callbacks.onTranscript(text, 'user', isFinal);

        // Only send final transcripts to server
        if (isFinal && text.trim()) {
          this.send({ type: 'text', text: text.trim() });
        }
      },
      (listening) => {
        this.debug({ direction: 'info', kind: 'speech', payload: { listening } });
      },
    );
  }

  private async handleToolCalls(
    functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
  ): Promise<void> {
    const functionResponses = await Promise.all(
      functionCalls.map(async (fc) => {
        try {
          const result = await this.callbacks.onToolCall(fc);
          return { id: fc.id, name: fc.name, response: result || { result: 'Action completed.' } };
        } catch (err: any) {
          return { id: fc.id, name: fc.name, response: { result: JSON.stringify({ error: err.message }) } };
        }
      }),
    );

    this.debug({ direction: 'send', kind: 'toolResult', payload: functionResponses });
    this.send({ type: 'toolResult', functionResponses });
  }

  private send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  async disconnect(): Promise<void> {
    this.callbacks.onStatusChange('disconnected');

    if (this.speechCapture) {
      this.speechCapture.stop();
      this.speechCapture = null;
    }

    if (this.ws) {
      try {
        this.send({ type: 'session.stop' });
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
  }

  /**
   * Send text directly to the server (text mode / debugging).
   */
  sendText(text: string): void {
    if (!text.trim()) return;
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
   */
  sendContextUpdate(context: string): void {
    this.debug({ direction: 'send', kind: 'context.update', payload: { length: context.length } });
    this.send({ type: 'context.update', context });
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

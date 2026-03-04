import { GoogleGenAI, Modality } from '@google/genai';
import { AudioCapture } from './AudioCapture';
import type { LiveSessionConfig, LiveSessionCallbacks, TokenUsage, DebugEvent } from './types';

export class LiveSession {
  private ai: InstanceType<typeof GoogleGenAI> | null = null;
  private session: any = null;
  private audioCapture: AudioCapture | null = null;
  private config: LiveSessionConfig;
  private callbacks: LiveSessionCallbacks;
  private cumulativeTokenUsage: TokenUsage = { totalTokens: 0, inputTokens: 0, outputTokens: 0 };
  private estimatedOutputTokens = 0;
  private sessionId = '';

  constructor(config: LiveSessionConfig, callbacks: LiveSessionCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  private debug(event: Omit<DebugEvent, 'timestamp'>): void {
    this.callbacks.onDebug({ ...event, timestamp: Date.now() });
  }

  async connect(): Promise<void> {
    try {
      this.sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.cumulativeTokenUsage = { totalTokens: 0, inputTokens: 0, outputTokens: 0 };
      this.estimatedOutputTokens = 0;

      this.debug({ direction: 'info', kind: 'connection', payload: { status: 'initializing' } });

      this.ai = new GoogleGenAI({ apiKey: this.config.apiKey });

      this.session = await this.ai.live.connect({
        model: this.config.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: this.config.systemInstruction,
          tools: this.config.tools as any,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voiceName } },
            languageCode: this.config.languageCode,
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: {
              silenceDurationMs: this.config.silenceDurationMs,
              startOfSpeechSensitivity: this.config.startSensitivity as any,
              endOfSpeechSensitivity: this.config.endSensitivity as any,
            },
          },
        },
        callbacks: {
          onopen: () => {
            this.debug({ direction: 'recv', kind: 'session', payload: { event: 'onopen' } });
          },
          onmessage: (msg: any) => {
            this.debug({
              direction: 'recv',
              kind: 'message',
              payload: { hasToolCall: !!msg.toolCall, serverContent: msg.serverContent ? 'present' : 'none' },
            });
            this.handleMessage(msg);
          },
          onclose: (closeEvent: any) => {
            this.debug({ direction: 'recv', kind: 'session', payload: { event: 'onclose', closeEvent } });

            const finalUsage: TokenUsage = {
              inputTokens: this.cumulativeTokenUsage.inputTokens,
              outputTokens: this.estimatedOutputTokens,
              totalTokens: this.cumulativeTokenUsage.inputTokens + this.estimatedOutputTokens,
            };
            this.callbacks.onSessionEnd(finalUsage);
            this.disconnect();
          },
          onerror: (err: any) => {
            this.debug({ direction: 'error', kind: 'session', payload: { error: err } });
            this.callbacks.onError(err.message || 'Unknown error');
            this.disconnect();
          },
        },
      });

      // Start audio capture and streaming
      this.audioCapture = new AudioCapture();
      await this.audioCapture.start((pcmBlob) => {
        if (this.session) {
          try {
            this.session.sendRealtimeInput({ media: pcmBlob });
          } catch {
            // Session might be closing
          }
        }
      });

      this.callbacks.onStatusChange('connected');
    } catch (error: any) {
      this.callbacks.onError(error.message);
      this.disconnect();
    }
  }

  private handleMessage(message: any): void {
    // Handle transcriptions
    if (message.serverContent) {
      const sc = message.serverContent;

      if (sc.inputTranscription?.text) {
        this.callbacks.onTranscript(sc.inputTranscription.text, 'user', sc.inputTranscription.finished !== false);
      }

      if (sc.outputTranscription?.text) {
        this.callbacks.onTranscript(sc.outputTranscription.text, 'ai', sc.outputTranscription.finished !== false);
      }

      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.text) {
            this.callbacks.onTranscript(part.text, 'ai', true);
          }
        }
      }
    }

    // Handle usage metadata
    if (message.usageMetadata) {
      const m = message.usageMetadata;
      this.cumulativeTokenUsage = {
        totalTokens: m.totalTokenCount || 0,
        inputTokens: m.promptTokenCount || 0,
        outputTokens: m.responseTokenCount || 0,
      };
      this.callbacks.onTokenUpdate(this.cumulativeTokenUsage);
    }

    // Handle tool calls
    if (message.toolCall) {
      const toolCallContent = JSON.stringify(message.toolCall);
      this.estimatedOutputTokens += Math.ceil(toolCallContent.length / 4);

      this.debug({ direction: 'recv', kind: 'toolCall', payload: message.toolCall });
      this.handleToolCall(message.toolCall);
    }
  }

  private async handleToolCall(toolCall: { functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> }): Promise<void> {
    if (!this.session) return;

    const functionResponses = await Promise.all(
      toolCall.functionCalls.map(async (fc) => {
        try {
          const result = await this.callbacks.onToolCall(fc);
          return { id: fc.id, name: fc.name, response: result || { result: 'Action processed successfully.' } };
        } catch (err: any) {
          return { id: fc.id, name: fc.name, response: { result: JSON.stringify({ error: err.message }) } };
        }
      })
    );

    this.debug({ direction: 'send', kind: 'toolResponse', payload: functionResponses });

    try {
      this.session.sendToolResponse({ functionResponses });
    } catch (e) {
      this.debug({ direction: 'error', kind: 'toolResponse', payload: { error: e } });
    }
  }

  async disconnect(): Promise<void> {
    this.callbacks.onStatusChange('disconnected');

    if (this.audioCapture) {
      await this.audioCapture.stop();
      this.audioCapture = null;
    }

    if (this.session) {
      try {
        this.session.close?.();
      } catch {
        // Ignore
      }
      this.session = null;
    }

    this.ai = null;
  }

  isConnected(): boolean {
    return this.session !== null;
  }
}

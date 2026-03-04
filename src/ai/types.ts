export interface LiveSessionConfig {
  apiKey: string;
  model: string;
  systemInstruction: string;
  tools: unknown[];
  voiceName: string;
  languageCode: string;
  silenceDurationMs: number;
  startSensitivity: string;
  endSensitivity: string;
  debug: boolean;
}

export interface LiveSessionCallbacks {
  onStatusChange: (status: string) => void;
  onTranscript: (text: string, speaker: 'user' | 'ai', isFinal: boolean) => void;
  onToolCall: (functionCall: { id: string; name: string; args: Record<string, unknown> }) => Promise<{ result: string }>;
  onError: (message: string) => void;
  onSessionEnd: (usage: TokenUsage) => void;
  onTokenUpdate: (usage: TokenUsage) => void;
  onDebug: (event: DebugEvent) => void;
}

export interface TokenUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}

export interface DebugEvent {
  direction: string;
  kind: string;
  timestamp: number;
  payload: unknown;
}

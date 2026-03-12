export interface ProxySessionConfig {
  serverUrl: string;
  systemInstruction: string;
  tools: unknown[];
  languageCode: string;
  debug: boolean;
  sessionId?: string;
  speechEnabled: boolean;
}

export interface QueueItem {
  turnId: string;
  text: string;
  status: 'queued' | 'processing' | 'executing-tools';
}

export interface QueueState {
  active: QueueItem | null;
  queued: QueueItem[];
}

export interface ProxySessionCallbacks {
  onStatusChange: (status: string) => void;
  onTranscript: (text: string, speaker: 'user' | 'ai', isFinal: boolean) => void;
  onToolCall: (functionCall: { id: string; name: string; args: Record<string, unknown> }) => Promise<{ result: string }>;
  onError: (message: string) => void;
  onSessionEnd: (usage: TokenUsage) => void;
  onTokenUpdate: (usage: TokenUsage) => void;
  onDebug: (event: DebugEvent) => void;
  onSpeechStateChange?: (active: boolean, paused: boolean) => void;
  onQueueUpdate?: (queue: QueueState) => void;
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

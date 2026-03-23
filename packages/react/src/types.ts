// ── SDK Instance Interface ──
// Minimal interface for what the wrapper needs from window.VoiceSDK.
// The actual SDK has more methods — consumers access them via sdk instance directly.

export interface VoiceSDKInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
  toggle(): Promise<void>;
  sendText(text: string): void;
  getConnectionState(): string;
  destroy(): Promise<void>;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  [key: string]: any;
}

export type VoiceSDKConstructor = new (config: Record<string, any>) => VoiceSDKInstance;

// ── React-Specific Types ──

export interface VoiceState {
  isConnected: boolean;
  isListening: boolean;
  isConnecting: boolean;
  error: string | null;
}

export interface TranscriptEntry {
  speaker: 'user' | 'ai';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface VoxGlideContextValue {
  sdk: VoiceSDKInstance | null;
  state: VoiceState;
  transcript: TranscriptEntry[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => Promise<void>;
  sendText: (text: string) => void;
  isReady: boolean;
  error: string | null;
}

export interface VoxGlideProviderProps {
  /** Proxy server WebSocket URL (e.g. wss://your-proxy.com) */
  serverUrl: string;
  /** Override URL to load the SDK script from */
  sdkUrl?: string;
  /** Auto-start session when SDK loads (default: false) */
  autoStart?: boolean;
  children: React.ReactNode;
  /** All other props pass through to the VoiceSDK constructor */
  [key: string]: any;
}

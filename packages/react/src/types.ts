import type { VoiceSDKConfig, TranscriptEvent, VoiceSDK } from 'voxglide';

/** State exposed by the useVoiceSDK hook. */
export interface VoiceState {
  isConnected: boolean;
  isListening: boolean;
  isConnecting: boolean;
  error: string | null;
}

/** A transcript entry with a timestamp. */
export interface TranscriptEntry extends TranscriptEvent {
  timestamp: number;
}

/** Value provided by VoiceProvider context. */
export interface VoiceContextValue {
  sdk: VoiceSDK | null;
  state: VoiceState;
  transcript: TranscriptEntry[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => Promise<void>;
  sendText: (text: string) => void;
}

/** Props for VoiceProvider component. */
export interface VoiceProviderProps {
  config: VoiceSDKConfig;
  children: React.ReactNode;
}

/** Props for VoiceAssistant component. */
export interface VoiceAssistantProps {
  config: VoiceSDKConfig;
}

/** Options for useVoiceSDK hook (overrides VoiceSDKConfig). */
export type UseVoiceSDKOptions = VoiceSDKConfig;

import type { AutoContextConfig, UIConfig, VoiceConfig } from './types';

export const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  ERROR: 'ERROR',
} as const;

export type ConnectionStateValue = (typeof ConnectionState)[keyof typeof ConnectionState];

export const DEFAULT_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
export const DEFAULT_TEXT_MODEL = 'gemini-2.0-flash-live-001';

export const DEFAULT_AUTO_CONTEXT: Required<AutoContextConfig> = {
  forms: true,
  headings: true,
  navigation: true,
  content: true,
  meta: true,
  exclude: [],
  maxContentLength: 3000,
};

export const DEFAULT_UI: Required<UIConfig> = {
  position: 'bottom-right',
  zIndex: 9999,
  primaryColor: '#2563eb',
  showTranscript: true,
  transcriptAutoHideMs: 5000,
};

export const DEFAULT_VOICE: Required<VoiceConfig> = {
  voiceName: 'Kore',
  languageCode: 'en-US',
  silenceDurationMs: 500,
  startSensitivity: 'START_SENSITIVITY_LOW',
  endSensitivity: 'END_SENSITIVITY_LOW',
};

export const INPUT_SAMPLE_RATE = 16000;
export const BUFFER_SIZE = 4096;

export const SESSION_STORAGE_KEY = 'voice-sdk-session';

export const SYSTEM_PROMPT_TEMPLATE = `You are a voice assistant embedded on a web page. Help the user interact with the page.

CAPABILITIES:
- Fill form fields, click buttons/links, navigate pages, answer questions about page content

RULES:
- Keep responses brief and conversational
- Confirm actions after performing them
- Ask for clarification if unsure which element to target
- Never fill password fields
- When filling fields, use the fillField tool with the exact field ID from the page context

PAGE CONTEXT:
{pageContext}

ADDITIONAL CONTEXT:
{developerContext}

AVAILABLE ACTIONS:
{toolDescriptions}`;

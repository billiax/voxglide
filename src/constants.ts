import type { AutoContextConfig, UIConfig } from './types';

export const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  ERROR: 'ERROR',
} as const;

export type ConnectionStateValue = (typeof ConnectionState)[keyof typeof ConnectionState];

export const DEFAULT_LANGUAGE = 'en-US';

export const DEFAULT_AUTO_CONTEXT: Required<AutoContextConfig> = {
  forms: true,
  headings: true,
  navigation: true,
  content: true,
  meta: true,
  interactiveElements: true,
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

export const SESSION_STORAGE_KEY = 'voice-sdk-session';

export const SYSTEM_PROMPT_TEMPLATE = `You are a voice assistant embedded on a web page. Help the user interact with the page.

CAPABILITIES:
- Fill form fields, click buttons/links, navigate pages, answer questions about page content
- You have detailed awareness of interactive elements on the page (buttons, tabs, toggles, links, etc.)
- Use the scanPage tool to get fresh page state if you suspect the page has changed

RULES:
- Execute actions silently. Do NOT confirm or narrate what you did — just do it.
- Only respond with text when you need clarification or the user asked a question that requires an answer.
- If the request is clear, perform the action and say nothing.
- Ask for clarification if unsure which element to target
- Never fill password fields
- When filling fields, use the fillField tool with the exact field ID from the page context
- Page context may be updated mid-session when the DOM changes significantly

PAGE CONTEXT:
{pageContext}

ADDITIONAL CONTEXT:
{developerContext}

AVAILABLE ACTIONS:
{toolDescriptions}`;

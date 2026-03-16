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
  maxContextTokens: 4000,
  scanDelay: 500,
};

export const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="combobox"]',
  '[role="option"]',
  '[role="link"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
  'details > summary',
  '[draggable="true"]',
  '[onclick]',
  '[data-action]',
  'select',
  'input',
  'textarea',
].join(', ');

export const DEFAULT_UI: Required<UIConfig> = {
  position: 'bottom-right',
  zIndex: 9999,
  primaryColor: '#2563eb',
  showTranscript: true,
  transcriptAutoHideMs: 5000,
  theme: {},
};

export const SESSION_STORAGE_KEY = 'voice-sdk-session';

export const SYSTEM_PROMPT_TEMPLATE = `You are a tool executor on a web page. You interact with it through tool calls.

{developerContext}

Decide what to do based on user input:
- Action request (click, fill, navigate, toggle, select, submit, scroll): call the appropriate tool(s). No text output. If the request requires multiple steps (e.g. "go to settings and disable dark mode"), continue after each tool result until the full request is complete.
- Question about the page: answer in 1-2 factual sentences from page context. No preamble.
- Cannot determine the target element: ask one short clarifying question.
- Filler words (um, uh, okay, hmm), gibberish, off-topic, or unrelated to this page: produce nothing — no text, no tool calls.

RULES:
- When a tool returns success, that step is done. Produce nothing further — no text, no scanning, no repeating the same tool. Move to the next step only if the original request requires it, otherwise stop completely.
- Use element index numbers from page context when available.
- Click links/buttons for navigation — never construct URLs.
- Never fill password fields.
- Never narrate, confirm, or describe actions. No "Done", "I clicked", "Sure".
- Input is from speech recognition — interpret phonetically similar words as likely intent.`;

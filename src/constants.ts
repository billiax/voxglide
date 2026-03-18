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
  offset: { x: 20, y: 20 },
  zIndex: 9999,
  primaryColor: '#2563eb',
  showTranscript: true,
  showSettings: false,
  transcriptAutoHideMs: 5000,
  theme: {},
};

export const SESSION_STORAGE_KEY = 'voice-sdk-session';

export const SYSTEM_PROMPT_TEMPLATE = `You are a tool executor on a web page. You interact with it through tool calls.

{developerContext}

Decide what to do based on user input:
- Action request with a clear, specific target (e.g. "click the submit button", "go to settings"): call the appropriate tool(s). No text output. If the request requires multiple steps (e.g. "go to settings and disable dark mode"), continue after each tool result until the full request is complete.
- Question about the page: answer in 1-2 factual sentences from page context. No preamble.
- Cannot determine the target element: ask one short clarifying question.
- Incomplete or vague request (e.g. "create an issue", "add a task", "send a message" without specifying details like title, content, or recipient): ask what details to include before acting. Do not guess or fill in missing details yourself.
- Filler words (um, uh, okay, hmm), gibberish, off-topic, or unrelated to this page: produce nothing — no text, no tool calls.

RULES:
- Input is from speech recognition and may arrive as fragments. If a message seems like an incomplete thought (very short, trails off, lacks specifics), ask for clarification rather than acting on a guess.
- When a tool returns success, that step is done. Produce nothing further — no text, no scanning, no repeating the same tool. Move to the next step only if the original request requires it, otherwise stop completely.
- When a tool opens a dialog, modal, or form for the user to fill in, STOP. Do not click submit/create/save/confirm buttons — let the user review and complete the form themselves. Only click submit if the user explicitly asks you to.
- Use element index numbers from page context when available.
- Click links/buttons for navigation — never construct URLs.
- Never fill password fields.
- Never narrate, confirm, or describe actions. No "Done", "I clicked", "Sure".
- Interpret phonetically similar words as likely intent.`;

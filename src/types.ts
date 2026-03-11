// ── SDK Configuration ──

export interface VoiceSDKConfig {
  /** VoxGlide proxy server WebSocket URL (e.g., ws://localhost:3100) */
  serverUrl: string;
  /** Auto-scan the DOM for context (forms, headings, nav, content) */
  autoContext?: boolean | AutoContextConfig;
  /** Developer-supplied context string injected into the system prompt */
  context?: string;
  /** Custom action registrations */
  actions?: ActionConfig;
  /** UI configuration */
  ui?: UIConfig | false;
  /** Speech recognition language code (default: en-US) */
  language?: string;
  /** Enable browser TTS for AI responses */
  tts?: boolean;
  /** Enable debug logging */
  debug?: boolean;
  /** Auto-reconnect after page navigation */
  autoReconnect?: boolean;
  /** Input mode: 'voice' (default), 'text' (no mic), or 'auto' (fallback to text) */
  mode?: 'voice' | 'text' | 'auto';
}

export interface AutoContextConfig {
  /** Scan forms for fields, labels, values */
  forms?: boolean;
  /** Scan h1-h6 for page outline */
  headings?: boolean;
  /** Scan nav elements and link clusters */
  navigation?: boolean;
  /** Read main content area text */
  content?: boolean;
  /** Read page meta (title, description, OG tags) */
  meta?: boolean;
  /** Scan for interactive elements (buttons, links, tabs, etc.) */
  interactiveElements?: boolean;
  /** CSS selectors to exclude from scanning */
  exclude?: string[];
  /** Max characters for content scanning */
  maxContentLength?: number;
  /** Max tokens for context output (default: 4000) */
  maxContextTokens?: number;
}

export interface ActionConfig {
  /** Custom tool registrations keyed by tool name */
  custom?: Record<string, CustomAction>;
  /** Allow cross-origin navigation (default: false) */
  allowCrossOrigin?: boolean;
}

export interface CustomAction {
  declaration: ToolDeclaration;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface UIConfig {
  /** Position of the floating button */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** z-index for the SDK UI container */
  zIndex?: number;
  /** Primary color (CSS value) */
  primaryColor?: string;
  /** Show transcript overlay */
  showTranscript?: boolean;
  /** Auto-hide transcript after this many ms of inactivity */
  transcriptAutoHideMs?: number;
}

// ── Gemini Tool Declarations ──

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
}

// ── Context Provider ──

export interface ContextProvider {
  type: string;
  name: string;
  getContext(): Promise<ContextResult>;
}

export interface ContextResult {
  content: string;
  tools: ToolDeclaration[];
}

// ── Action Handler ──

export interface FunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallMessage {
  functionCalls: FunctionCall[];
}

export interface FunctionResponse {
  id: string;
  name: string;
  response: { result: string };
}

// ── Events ──

export interface VoiceSDKEvents {
  [key: string]: unknown;
  connected: void;
  disconnected: void;
  transcript: TranscriptEvent;
  action: ActionEvent;
  'action:before': ActionEvent;
  error: ErrorEvent;
  usage: UsageEvent;
  stateChange: StateChangeEvent;
}

export interface TranscriptEvent {
  speaker: 'user' | 'ai';
  text: string;
  isFinal: boolean;
}

export interface ActionEvent {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface ErrorEvent {
  message: string;
  code?: string;
}

export interface UsageEvent {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}

export interface StateChangeEvent {
  from: string;
  to: string;
}

// ── Interactive Elements ──

export interface InteractiveElement {
  index: number;
  description: string;
  selector: string;
  tagName: string;
  role?: string;
  capabilities: ElementCapability[];
  state?: Record<string, string>;
  inViewport?: boolean;
}

export type ElementCapability = 'clickable' | 'toggleable' | 'expandable' | 'editable' | 'draggable' | 'selectable' | 'navigable';

// ── Internal ──

export interface SessionState {
  config: VoiceSDKConfig;
  conversationSummary?: string;
  sessionId?: string;
}

export interface FormFieldInfo {
  id: string;
  name: string;
  type: string;
  label: string;
  value: string;
  placeholder: string;
  required: boolean;
  disabled: boolean;
  options?: string[];
  tagName: string;
}

export interface PageContext {
  title: string;
  description: string;
  url: string;
  forms: FormFieldInfo[];
  headings: { level: number; text: string }[];
  navigation: { text: string; href: string }[];
  content: string;
  interactiveElements: InteractiveElement[];
}

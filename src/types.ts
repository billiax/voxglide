// ── SDK Configuration ──

export interface VoiceSDKConfig {
  /** Gemini API key */
  apiKey: string;
  /** Gemini model ID */
  model?: string;
  /** Auto-scan the DOM for context (forms, headings, nav, content) */
  autoContext?: boolean | AutoContextConfig;
  /** Developer-supplied context string injected into the system prompt */
  context?: string;
  /** Custom action registrations */
  actions?: ActionConfig;
  /** UI configuration */
  ui?: UIConfig | false;
  /** Voice configuration */
  voice?: VoiceConfig;
  /** Enable debug logging */
  debug?: boolean;
  /** Auto-reconnect after page navigation */
  autoReconnect?: boolean;
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
  /** CSS selectors to exclude from scanning */
  exclude?: string[];
  /** Max characters for content scanning */
  maxContentLength?: number;
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

export interface VoiceConfig {
  /** Gemini voice name */
  voiceName?: string;
  /** Language code */
  languageCode?: string;
  /** Silence detection duration in ms */
  silenceDurationMs?: number;
  /** Start of speech sensitivity */
  startSensitivity?: 'START_SENSITIVITY_LOW' | 'START_SENSITIVITY_HIGH';
  /** End of speech sensitivity */
  endSensitivity?: 'END_SENSITIVITY_LOW' | 'END_SENSITIVITY_HIGH';
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

// ── Internal ──

export interface SessionState {
  apiKey: string;
  config: VoiceSDKConfig;
  conversationSummary?: string;
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
}

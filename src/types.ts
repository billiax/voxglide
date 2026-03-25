// ── SDK Configuration ──

/**
 * Configuration for the VoiceSDK instance.
 * Only `serverUrl` is required — all other options have sensible defaults.
 */
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
  /** Auto-discover window.nbt_functions and register as AI tools (default: true) */
  nbtFunctions?: boolean;
  /** Conversation workflow definitions */
  workflows?: WorkflowDefinition[];
  /** Enable voice accessibility mode (ARIA live regions, keyboard shortcuts, high contrast) */
  accessibility?: boolean | AccessibilityConfig;
  /** Build mode configuration for AI-powered tool generation via Claude Code API */
  buildMode?: import('./build/types').BuildModeConfig;
}

export interface AccessibilityConfig {
  /** Inject aria-live announcements (default: true) */
  announcements?: boolean;
  /** Auto-apply high contrast theme (default: true) */
  highContrast?: boolean;
  /** Speech rate multiplier for TTS (default: 0.85) */
  ttsRate?: number;
  /** Enable extra keyboard shortcuts (default: true) */
  keyboardShortcuts?: boolean;
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
  /** Delay before scanning after navigation (ms, default 500) */
  scanDelay?: number;
}

export interface ActionConfig {
  /** Custom tool registrations keyed by tool name */
  custom?: Record<string, CustomAction>;
  /** Allow cross-origin navigation (default: false) */
  allowCrossOrigin?: boolean;
}

/**
 * A custom action registration combining a tool declaration with its handler.
 * Pass custom actions via `VoiceSDKConfig.actions.custom` or `registerAction()`.
 */
export interface CustomAction {
  declaration: ToolDeclaration;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export type UIPosition =
  | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  | 'bottom-center' | 'top-center'
  | 'center-right' | 'center-left'
  | 'center';

export interface UIConfig {
  /** Position of the floating button and transcript panel */
  position?: UIPosition;
  /** Pixel offset from the anchored edge (default: { x: 20, y: 20 }) */
  offset?: { x?: number; y?: number };
  /** z-index for the SDK UI container */
  zIndex?: number;
  /** Primary color (CSS value) — shorthand for theme.colors.primary */
  primaryColor?: string;
  /** Show transcript overlay */
  showTranscript?: boolean;
  /** Show settings gear icon in the panel header (opens a live config panel) */
  showSettings?: boolean;
  /** Auto-hide transcript after this many ms of inactivity */
  transcriptAutoHideMs?: number;
  /** Theme configuration */
  theme?: ThemeConfig;
}

// ── Theming ──

export interface ThemeColors {
  primary?: string;
  primaryHover?: string;
  danger?: string;
  dangerHover?: string;
  background?: string;
  backgroundOverlay?: string;
  text?: string;
  textMuted?: string;
  border?: string;
  shadow?: string;
}

export type ThemePreset = 'default' | 'minimal' | 'dark' | 'light';
export type ThemeSize = 'sm' | 'md' | 'lg';
export type ThemeColorScheme = 'auto' | 'light' | 'dark';

export interface ThemeConfig {
  /** Base preset to build on */
  preset?: ThemePreset;
  /** Color overrides */
  colors?: ThemeColors;
  /** Button/UI size variant (sm | md | lg) — sets buttonSize, iconSize, panelWidth together */
  size?: ThemeSize;
  /** Border radius override (CSS value) */
  borderRadius?: string;
  /** Color scheme behavior */
  colorScheme?: ThemeColorScheme;
  /** Arbitrary CSS custom properties to inject */
  customProperties?: Record<string, string>;
  /** Override button diameter in pixels (overrides size preset) */
  buttonSize?: number;
  /** Override icon size in pixels (overrides size preset) */
  iconSize?: number;
  /** Override transcript panel width in pixels (overrides size preset) */
  panelWidth?: number;
}

export interface ResolvedTheme {
  colors: Required<ThemeColors>;
  size: ThemeSize;
  borderRadius: string;
  colorScheme: ThemeColorScheme;
  buttonSize: number;
  iconSize: number;
  panelMaxWidth: number;
  customProperties: Record<string, string>;
}

// ── Gemini Tool Declarations ──

/**
 * Declares a tool (function) that the AI can call.
 * Used for both built-in SDK tools and custom developer tools.
 */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

/** Describes a single parameter within a tool declaration. */
export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
}

// ── Context Provider ──

/**
 * Interface for pluggable context providers.
 * Implement this to inject custom context into the AI system prompt.
 */
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

/** Represents an AI-initiated function call received from the server. */
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

// ── Workflows ──

export interface WorkflowStep {
  /** Instruction for the AI on this step */
  instruction: string;
  /** Field name to collect data into */
  field?: string;
  /** Validate collected value; return true or error message */
  validate?: (value: string) => boolean | string;
}

export interface WorkflowDefinition {
  /** Unique workflow name */
  name: string;
  /** Trigger phrase to auto-start (optional) */
  trigger?: string;
  /** Ordered steps */
  steps: WorkflowStep[];
  /** Called when all steps complete */
  onComplete?: (data: Record<string, string>) => void;
}

export interface WorkflowState {
  name: string;
  currentStep: number;
  totalSteps: number;
  collectedData: Record<string, string>;
}

// ── Events ──

/**
 * Event map for VoiceSDK. Use `sdk.on(eventName, handler)` to subscribe.
 * All events are strongly typed via this interface.
 */
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
  'workflow:start': WorkflowState;
  'workflow:step': WorkflowState;
  'workflow:complete': WorkflowState;
  'workflow:cancel': { name: string; reason: string };
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

export interface ScanMetadata {
  scanDuration: number;
  elementCount: number;
  truncated: boolean;
  totalFound: number;
  phaseCounts: { selector: number; cursorPointer: number };
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
  scanMetadata?: ScanMetadata;
}

// ── nbt_functions (window.nbt_functions auto-discovery) ──

/** Developer-friendly function definition for window.nbt_functions */
export interface NbtFunctionDef {
  description: string;
  parameters?: Record<string, NbtParameterDef>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface NbtParameterDef {
  type: string;          // "string", "number", "boolean", "integer"
  description: string;
  required?: boolean;
  enum?: string[];
}

declare global {
  interface Window {
    nbt_functions?: Record<string, NbtFunctionDef>;
  }
}

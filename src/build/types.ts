// ── Build Mode Configuration ──

export interface BuildModeConfig {
  /** Claude Code API base URL */
  apiUrl: string;
  /** API key for X-API-Key header */
  apiKey: string;
  /** Workspace name for Claude Code */
  workspace: string;
  /** Model to use: "opus" | "sonnet" | "haiku" (default: "sonnet") */
  model?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** VoxGlide proxy server HTTP URL for persisting generated tools (e.g., http://localhost:3100) */
  serverUrl?: string;
}

export interface BuildModeState {
  active: boolean;
  sessionId: string | null;
  loading: boolean;
}

// ── Claude Code API Types ──

export interface ClaudeCodeRequest {
  message: string;
  workspace: string;
  model: string;
  sessionId?: string;
  engine?: string;
  /** Browser tool definitions — sent on the first request */
  tools?: ToolDefinition[];
  /** Base64-encoded images to include with the message */
  images?: Array<{ data: string; media_type: string }>;
}

export interface ClaudeCodeResponse {
  sessionId: string;
  /** Text response — may be absent when Claude only returns requests */
  response?: string;
  /** Parsed requests from Claude's response. null when Claude sends a plain message. */
  requests?: BrowserRequest[] | null;
  /** Whether the response is an error */
  isError?: boolean;
  durationMs: number;
  costUsd: number;
  workspace: string;
  model: string;
  engine?: string;
  /** URLs of uploaded images (present when images were sent) */
  imageUrls?: string[];
}

// ── Browser Tool Protocol ──

export interface ToolParameterDef {
  type: string;
  description: string;
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, ToolParameterDef>;
}

export interface BrowserRequest {
  name: string;
  params?: Record<string, unknown>;
}

export interface BrowserToolResult {
  output: string;
  isError: boolean;
  /** Base64-encoded image data (e.g. from take_screenshot). Sent as a native image on the next turn. */
  image?: string;
}

// ── Pending Tool (accept/reject) ──

export interface PendingTool {
  name: string;
  code: string;
  sessionId: string;
  status: 'pending' | 'accepted' | 'rejected';
}

// ── Session Persistence (navigation survival) ──

export interface BuildSessionSnapshot {
  sessionId: string;
  inToolLoop: boolean;
  previousUrl: string;
}

// ── Code Extraction ──

export interface ExtractedCodeBlock {
  language: string;
  code: string;
  registered: boolean;
  error?: string;
}
/**
 * Provider-neutral types for the LLM abstraction layer.
 * These mirror the client's format (Gemini-like) to minimize conversion at the WebSocket boundary.
 */

export interface InternalContent {
  role: 'user' | 'model';
  parts: InternalPart[];
}

export interface InternalPart {
  text?: string;
  functionCall?: { id?: string; name: string; args: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

export interface InternalTool {
  functionDeclarations: InternalFunctionDeclaration[];
}

export interface InternalFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface TokenUsage {
  totalTokens: number;
  promptTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  thinkingTokens?: number;
}

export interface StreamChunk {
  textDelta?: string;
  functionCalls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
  usage?: TokenUsage;
  /** Raw parts from the provider response, for faithful history replay */
  rawParts?: any[];
}

export interface GenerateResult {
  text: string;
  usage?: TokenUsage;
}

export interface CacheHandle {
  name: string;
}

export interface GenerateStreamOptions {
  contents: InternalContent[];
  systemInstruction?: string;
  tools?: InternalTool[];
  cachedContent?: string;
}

export interface GenerateOptions {
  contents: InternalContent[];
  systemInstruction?: string;
}

export interface CacheCreateOptions {
  systemInstruction: string;
  tools: InternalTool[];
  ttl: string;
}

/**
 * The LLM provider interface. Each provider (Gemini, OpenAI, Anthropic, Ollama)
 * implements this to provide a uniform API.
 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsCaching: boolean;
  readonly cacheMinTokens: number;

  generateContentStream(opts: GenerateStreamOptions): Promise<AsyncIterable<StreamChunk>>;
  generateContent(opts: GenerateOptions): Promise<GenerateResult>;
  createCache?(opts: CacheCreateOptions): Promise<CacheHandle>;
  deleteCache?(name: string): Promise<void>;
}

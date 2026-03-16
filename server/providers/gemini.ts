import { GoogleGenAI } from '@google/genai';
import type { Content, Part, Tool } from '@google/genai';
import type {
  LLMProvider, StreamChunk, GenerateResult, CacheHandle,
  GenerateStreamOptions, GenerateOptions, CacheCreateOptions,
} from './types.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const CACHE_MIN_TOKENS = 2_048;

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly supportsCaching = true;
  readonly cacheMinTokens = CACHE_MIN_TOKENS;
  private ai: GoogleGenAI;

  constructor(apiKey: string, model?: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model || DEFAULT_MODEL;
  }

  async *streamChunks(opts: GenerateStreamOptions): AsyncIterable<StreamChunk> {
    const config: any = {};
    if (opts.cachedContent) {
      config.cachedContent = opts.cachedContent;
    } else {
      if (opts.systemInstruction) config.systemInstruction = opts.systemInstruction;
      if (opts.tools) config.tools = opts.tools as Tool[];
    }

    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents: opts.contents as Content[],
      config,
    });

    for await (const chunk of stream) {
      const result: StreamChunk = {};

      if (chunk.usageMetadata) {
        const thinking = (chunk.usageMetadata as any).thoughtsTokenCount || 0;
        result.usage = {
          totalTokens: chunk.usageMetadata.totalTokenCount || 0,
          promptTokens: chunk.usageMetadata.promptTokenCount || 0,
          outputTokens: chunk.usageMetadata.candidatesTokenCount || 0,
          cachedTokens: chunk.usageMetadata.cachedContentTokenCount || 0,
          thinkingTokens: thinking || undefined,
        };
      }

      const parts = chunk.candidates?.[0]?.content?.parts || [];
      const functionCalls: StreamChunk['functionCalls'] = [];

      for (const part of parts) {
        // Skip thought parts — internal model reasoning, not for client
        if (part.thought) continue;

        if (part.text) {
          result.textDelta = (result.textDelta || '') + part.text;
        }
        if (part.functionCall) {
          functionCalls.push({
            name: part.functionCall.name!,
            args: (part.functionCall.args || {}) as Record<string, unknown>,
          });
        }
      }

      if (functionCalls.length > 0) {
        result.functionCalls = functionCalls;
      }

      // Preserve raw parts for faithful history replay (thoughtSignature, thought, etc.)
      if (parts.length > 0) {
        result.rawParts = parts;
      }

      yield result;
    }
  }

  async generateContentStream(opts: GenerateStreamOptions): Promise<AsyncIterable<StreamChunk>> {
    return this.streamChunks(opts);
  }

  async generateContent(opts: GenerateOptions): Promise<GenerateResult> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: opts.contents as Content[],
      config: {
        systemInstruction: opts.systemInstruction,
      },
    });

    const text = response.candidates?.[0]?.content?.parts
      ?.filter((p: Part) => p.text && !p.thought)
      .map((p: Part) => p.text)
      .join('') || '';

    return {
      text,
      usage: response.usageMetadata ? {
        totalTokens: response.usageMetadata.totalTokenCount || 0,
        promptTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: response.usageMetadata.candidatesTokenCount || 0,
      } : undefined,
    };
  }

  async createCache(opts: CacheCreateOptions): Promise<CacheHandle> {
    const cache = await this.ai.caches.create({
      model: this.model,
      config: {
        systemInstruction: opts.systemInstruction,
        tools: opts.tools as Tool[],
        ttl: opts.ttl,
      },
    });
    return { name: cache.name || '' };
  }

  async deleteCache(name: string): Promise<void> {
    try {
      await this.ai.caches.delete({ name });
    } catch {
      // Fire-and-forget: cache may already be expired
    }
  }
}

import OpenAI from 'openai';
import type {
  LLMProvider, StreamChunk, GenerateResult,
  GenerateStreamOptions, GenerateOptions, InternalContent, InternalTool,
} from './types.js';

const DEFAULT_MODEL = 'gpt-4o';

/**
 * Converts internal content format to OpenAI message format.
 */
function toOpenAIMessages(
  contents: InternalContent[],
  systemInstruction?: string,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }

  for (const entry of contents) {
    if (entry.role === 'user') {
      // Check if this is a function response
      const functionResponses = entry.parts.filter(p => p.functionResponse);
      if (functionResponses.length > 0) {
        for (const part of functionResponses) {
          const fr = part.functionResponse!;
          messages.push({
            role: 'tool',
            tool_call_id: fr.id || fr.name,
            content: JSON.stringify(fr.response) ?? '{}',
          });
        }
        continue;
      }

      // Regular user text
      const textParts = entry.parts.filter(p => p.text);
      if (textParts.length > 0) {
        messages.push({
          role: 'user',
          content: textParts.map(p => p.text).join(''),
        });
      }
    } else if (entry.role === 'model') {
      const textParts = entry.parts.filter(p => p.text);
      const funcCalls = entry.parts.filter(p => p.functionCall);

      // Skip empty model entries (no text, no tool calls)
      if (textParts.length === 0 && funcCalls.length === 0) continue;

      const msg: any = { role: 'assistant' };

      // OpenAI requires content to be a string or null — always set it explicitly
      msg.content = textParts.length > 0
        ? textParts.map(p => p.text).join('')
        : null;

      if (funcCalls.length > 0) {
        msg.tool_calls = funcCalls.map(p => ({
          id: p.functionCall!.id || p.functionCall!.name,
          type: 'function' as const,
          function: {
            name: p.functionCall!.name,
            arguments: JSON.stringify(p.functionCall!.args),
          },
        }));
      }

      messages.push(msg);
    }
  }

  return messages;
}

/**
 * Converts internal tool declarations to OpenAI function tool format.
 */
function toOpenAITools(tools?: InternalTool[]): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const result: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  for (const toolSet of tools) {
    for (const decl of toolSet.functionDeclarations) {
      const params = decl.parameters ? convertParameters(decl.parameters) : { type: 'object' as const, properties: {} };
      result.push({
        type: 'function',
        function: {
          name: decl.name,
          description: decl.description,
          parameters: params,
        },
      });
    }
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Converts Gemini-style parameter schema (uppercase types) to JSON Schema (lowercase).
 */
function convertParameters(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === 'type' && typeof value === 'string') {
      result.type = value.toLowerCase();
    } else if (Array.isArray(value)) {
      result[key] = value;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = convertParameters(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class OpenAIProvider implements LLMProvider {
  readonly name: string = 'openai';
  readonly model: string;
  readonly supportsCaching = false;
  readonly cacheMinTokens = Infinity;
  protected client: OpenAI;

  constructor(apiKey: string, model?: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model || DEFAULT_MODEL;
  }

  async *streamChunks(opts: GenerateStreamOptions): AsyncIterable<StreamChunk> {
    const messages = toOpenAIMessages(opts.contents, opts.systemInstruction);
    const tools = toOpenAITools(opts.tools);

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools,
      stream: true,
      stream_options: { include_usage: true },
    });

    // Accumulate incremental tool call chunks
    const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      const result: StreamChunk = {};

      if (chunk.usage) {
        result.usage = {
          totalTokens: chunk.usage.total_tokens || 0,
          promptTokens: chunk.usage.prompt_tokens || 0,
          outputTokens: chunk.usage.completion_tokens || 0,
        };
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) {
        if (result.usage) yield result;
        continue;
      }

      if (delta.content) {
        result.textDelta = delta.content;
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAccumulator.has(idx)) {
            toolCallAccumulator.set(idx, {
              id: tc.id || '',
              name: tc.function?.name || '',
              args: '',
            });
          }
          const acc = toolCallAccumulator.get(idx)!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
        }
      }

      // Emit complete tool calls at stream end
      const finishReason = chunk.choices?.[0]?.finish_reason;
      if (finishReason === 'tool_calls' || finishReason === 'stop') {
        if (toolCallAccumulator.size > 0) {
          result.functionCalls = [];
          for (const [, acc] of toolCallAccumulator) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(acc.args || '{}'); } catch { /* empty */ }
            result.functionCalls.push({ id: acc.id, name: acc.name, args });
          }
          toolCallAccumulator.clear();
        }
      }

      yield result;
    }
  }

  async generateContentStream(opts: GenerateStreamOptions): Promise<AsyncIterable<StreamChunk>> {
    return this.streamChunks(opts);
  }

  async generateContent(opts: GenerateOptions): Promise<GenerateResult> {
    const messages = toOpenAIMessages(opts.contents, opts.systemInstruction);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
    });

    return {
      text: response.choices?.[0]?.message?.content || '',
      usage: response.usage ? {
        totalTokens: response.usage.total_tokens || 0,
        promptTokens: response.usage.prompt_tokens || 0,
        outputTokens: response.usage.completion_tokens || 0,
      } : undefined,
    };
  }
}

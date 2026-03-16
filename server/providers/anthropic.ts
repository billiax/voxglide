import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider, StreamChunk, GenerateResult,
  GenerateStreamOptions, GenerateOptions, InternalContent, InternalTool,
} from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8192;

/**
 * Converts internal content format to Anthropic message format.
 * System instruction is extracted separately (Anthropic uses a top-level system param).
 */
function toAnthropicMessages(
  contents: InternalContent[],
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const entry of contents) {
    if (entry.role === 'user') {
      const blocks: (Anthropic.TextBlockParam | Anthropic.ToolResultBlockParam)[] = [];

      for (const part of entry.parts) {
        if (part.text) {
          blocks.push({ type: 'text', text: part.text });
        }
        if (part.functionResponse) {
          blocks.push({
            type: 'tool_result',
            tool_use_id: part.functionResponse.id || part.functionResponse.name,
            content: JSON.stringify(part.functionResponse.response) ?? '{}',
          });
        }
      }

      if (blocks.length > 0) {
        messages.push({ role: 'user', content: blocks });
      }
    } else if (entry.role === 'model') {
      const blocks: (Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam)[] = [];

      for (const part of entry.parts) {
        if (part.text) {
          blocks.push({ type: 'text', text: part.text });
        }
        if (part.functionCall) {
          blocks.push({
            type: 'tool_use',
            id: part.functionCall.id || part.functionCall.name,
            name: part.functionCall.name,
            input: part.functionCall.args,
          });
        }
      }

      if (blocks.length > 0) {
        messages.push({ role: 'assistant', content: blocks });
      }
    }
  }

  return messages;
}

/**
 * Converts internal tool declarations to Anthropic tool format.
 */
function toAnthropicTools(tools?: InternalTool[]): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const result: Anthropic.Tool[] = [];
  for (const toolSet of tools) {
    for (const decl of toolSet.functionDeclarations) {
      result.push({
        name: decl.name,
        description: decl.description,
        input_schema: decl.parameters
          ? convertParameters(decl.parameters) as Anthropic.Tool.InputSchema
          : { type: 'object' as const, properties: {} },
      });
    }
  }
  return result.length > 0 ? result : undefined;
}

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

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;
  readonly supportsCaching = false;
  readonly cacheMinTokens = Infinity;
  private client: Anthropic;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model || DEFAULT_MODEL;
  }

  async *streamChunks(opts: GenerateStreamOptions): AsyncIterable<StreamChunk> {
    const messages = toAnthropicMessages(opts.contents);
    const tools = toAnthropicTools(opts.tools);

    const params: Anthropic.MessageCreateParams = {
      model: this.model,
      messages,
      max_tokens: MAX_TOKENS,
      stream: true,
    };

    if (opts.systemInstruction) {
      params.system = opts.systemInstruction;
    }
    if (tools) {
      params.tools = tools;
    }

    const stream = this.client.messages.stream(params);

    // Track tool use blocks being built incrementally
    let currentToolUse: { id: string; name: string; argsJson: string } | null = null;

    for await (const event of stream) {
      const result: StreamChunk = {};

      if (event.type === 'content_block_start') {
        const block = (event as any).content_block;
        if (block?.type === 'tool_use') {
          currentToolUse = { id: block.id, name: block.name, argsJson: '' };
        }
      } else if (event.type === 'content_block_delta') {
        const delta = (event as any).delta;
        if (delta?.type === 'text_delta' && delta.text) {
          result.textDelta = delta.text;
        } else if (delta?.type === 'input_json_delta' && currentToolUse) {
          currentToolUse.argsJson += delta.partial_json || '';
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolUse) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(currentToolUse.argsJson || '{}'); } catch { /* empty */ }
          result.functionCalls = [{
            id: currentToolUse.id,
            name: currentToolUse.name,
            args,
          }];
          currentToolUse = null;
        }
      } else if (event.type === 'message_delta') {
        const usage = (event as any).usage;
        if (usage) {
          result.usage = {
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
            promptTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
          };
        }
      } else if (event.type === 'message_start') {
        const usage = (event as any).message?.usage;
        if (usage) {
          result.usage = {
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
            promptTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
          };
        }
      }

      if (result.textDelta || result.functionCalls || result.usage) {
        yield result;
      }
    }
  }

  async generateContentStream(opts: GenerateStreamOptions): Promise<AsyncIterable<StreamChunk>> {
    return this.streamChunks(opts);
  }

  async generateContent(opts: GenerateOptions): Promise<GenerateResult> {
    const messages = toAnthropicMessages(opts.contents);

    const params: Anthropic.MessageCreateParams = {
      model: this.model,
      messages,
      max_tokens: MAX_TOKENS,
    };

    if (opts.systemInstruction) {
      params.system = opts.systemInstruction;
    }

    const response = await this.client.messages.create(params);

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    return {
      text,
      usage: response.usage ? {
        totalTokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0),
        promptTokens: response.usage.input_tokens || 0,
        outputTokens: response.usage.output_tokens || 0,
      } : undefined,
    };
  }
}

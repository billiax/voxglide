import type { LLMProvider } from './types.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';

export type ProviderName = 'gemini' | 'openai' | 'anthropic' | 'ollama';

/**
 * Create an LLM provider based on environment variables.
 *
 * Configuration:
 * - LLM_PROVIDER: 'gemini' | 'openai' | 'anthropic' | 'ollama' (auto-detected if not set)
 * - LLM_MODEL: Model override (provider-specific defaults used if not set)
 * - GEMINI_API_KEY: Gemini API key
 * - GEMINI_MODEL: Gemini model override (legacy, respected when provider is gemini)
 * - OPENAI_API_KEY: OpenAI API key
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - OLLAMA_BASE_URL: Ollama base URL (default: http://localhost:11434/v1)
 */
export function createProvider(): LLMProvider {
  const explicitProvider = process.env.LLM_PROVIDER?.toLowerCase() as ProviderName | undefined;
  const model = process.env.LLM_MODEL;

  // Auto-detect provider from available API keys
  const provider = explicitProvider || autoDetectProvider();

  switch (provider) {
    case 'gemini': {
      const key = process.env.GEMINI_API_KEY;
      if (!key) {
        console.error('[voxglide] GEMINI_API_KEY is required for Gemini provider');
        process.exit(1);
      }
      // Respect GEMINI_MODEL as legacy alias
      const geminiModel = model || process.env.GEMINI_MODEL;
      return new GeminiProvider(key, geminiModel);
    }

    case 'openai': {
      const key = process.env.OPENAI_API_KEY;
      if (!key) {
        console.error('[voxglide] OPENAI_API_KEY is required for OpenAI provider');
        process.exit(1);
      }
      return new OpenAIProvider(key, model);
    }

    case 'anthropic': {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) {
        console.error('[voxglide] ANTHROPIC_API_KEY is required for Anthropic provider');
        process.exit(1);
      }
      return new AnthropicProvider(key, model);
    }

    case 'ollama': {
      const baseUrl = process.env.OLLAMA_BASE_URL;
      return new OllamaProvider(model, baseUrl);
    }

    default:
      console.error(`[voxglide] Unknown LLM_PROVIDER: "${provider}". Use: gemini, openai, anthropic, ollama`);
      process.exit(1);
  }
}

function autoDetectProvider(): ProviderName {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';

  console.error('[voxglide] No LLM_PROVIDER set and no API key found. Set one of: GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or set LLM_PROVIDER=ollama');
  process.exit(1);
}

import { OpenAIProvider } from './openai.js';

const DEFAULT_MODEL = 'llama3.1';
const DEFAULT_BASE_URL = 'http://localhost:11434/v1';

/**
 * Ollama provider — uses OpenAI-compatible API with custom base URL.
 */
export class OllamaProvider extends OpenAIProvider {
  override readonly name = 'ollama';

  constructor(model?: string, baseUrl?: string) {
    super(
      'ollama',  // Ollama doesn't need a real API key
      model || DEFAULT_MODEL,
      baseUrl || DEFAULT_BASE_URL,
    );
  }
}

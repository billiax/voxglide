import type { ContextProvider, ContextResult } from '../types';

/**
 * Wraps free-text context as a context provider.
 */
export class TextProvider implements ContextProvider {
  type = 'text';
  name: string;
  private text: string;

  constructor(text = '', name = 'Developer Context') {
    this.text = text;
    this.name = name;
  }

  setText(text: string): void {
    this.text = text;
  }

  async getContext(): Promise<ContextResult> {
    if (!this.text?.trim()) {
      return { content: '', tools: [] };
    }
    return { content: this.text.trim(), tools: [] };
  }
}

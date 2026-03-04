import type { ContextProvider, ContextResult, ToolDeclaration } from '../types';

/**
 * Aggregates multiple context providers into a unified context.
 * Produces system prompt sections and tool declarations.
 */
export class ContextEngine {
  private providers = new Map<string, ContextProvider>();

  addProvider(provider: ContextProvider): void {
    if (!provider.type || !provider.name || !provider.getContext) {
      throw new Error('Provider must have type, name, and getContext()');
    }
    this.providers.set(provider.name, provider);
  }

  removeProvider(name: string): void {
    this.providers.delete(name);
  }

  getProvider(name: string): ContextProvider | undefined {
    return this.providers.get(name);
  }

  async buildContext(): Promise<{ sections: { type: string; name: string; content: string }[]; tools: ToolDeclaration[] }> {
    const sections: { type: string; name: string; content: string }[] = [];
    const tools: ToolDeclaration[] = [];

    for (const [name, provider] of this.providers) {
      try {
        const result: ContextResult = await provider.getContext();
        if (result.content) {
          sections.push({ type: provider.type, name, content: result.content });
        }
        if (result.tools) {
          tools.push(...result.tools);
        }
      } catch (err) {
        console.error(`[VoiceSDK:ContextEngine] Provider "${name}" failed:`, err);
      }
    }

    return { sections, tools };
  }

  async buildSystemPrompt(): Promise<string> {
    const { sections } = await this.buildContext();
    if (sections.length === 0) return '';

    const parts = ['=== PAGE CONTEXT ===', ''];
    for (const section of sections) {
      parts.push(`[${section.name}]`);
      parts.push(section.content);
      parts.push('');
    }
    parts.push('=== END CONTEXT ===');
    return parts.join('\n');
  }

  async getTools(): Promise<ToolDeclaration[]> {
    const { tools } = await this.buildContext();
    return tools;
  }
}

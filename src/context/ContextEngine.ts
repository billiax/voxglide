import type { ContextProvider, ContextResult, ToolDeclaration } from '../types';
import { simpleHash } from '../utils/hash';

/**
 * Aggregates multiple context providers into a unified context.
 * Produces system prompt sections and tool declarations.
 */
export class ContextEngine {
  private providers = new Map<string, ContextProvider>();
  private lastSectionFingerprints = new Map<string, string>();
  private lastCachedPrompt = '';
  private lastCachedTools: ToolDeclaration[] = [];

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

  private formatSections(sections: { type: string; name: string; content: string }[]): string {
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

  async buildSystemPrompt(): Promise<string> {
    const { sections } = await this.buildContext();
    return this.formatSections(sections);
  }

  async getTools(): Promise<ToolDeclaration[]> {
    const { tools } = await this.buildContext();
    return tools;
  }

  /**
   * Combined method: builds system prompt and tools from a single buildContext() call.
   * Avoids the double-iteration of calling buildSystemPrompt() + getTools() separately.
   */
  async buildSystemPromptAndTools(): Promise<{ systemPrompt: string; tools: ToolDeclaration[] }> {
    const { sections, tools } = await this.buildContext();
    return { systemPrompt: this.formatSections(sections), tools };
  }

  /**
   * Builds system prompt and tools, but returns a `changed` flag indicating
   * whether any section content differs from the last call.
   * Uses per-section hashing for efficient change detection.
   */
  async buildSystemPromptAndToolsIfChanged(): Promise<{
    systemPrompt: string;
    tools: ToolDeclaration[];
    changed: boolean;
  }> {
    const { sections, tools } = await this.buildContext();

    // Compute per-section fingerprints
    const newFingerprints = new Map<string, string>();
    for (const section of sections) {
      newFingerprints.set(section.name, String(simpleHash(section.content)));
    }

    // Compare against last known fingerprints
    let changed = false;
    if (newFingerprints.size !== this.lastSectionFingerprints.size) {
      changed = true;
    } else {
      for (const [name, hash] of newFingerprints) {
        if (this.lastSectionFingerprints.get(name) !== hash) {
          changed = true;
          break;
        }
      }
    }

    if (changed) {
      this.lastSectionFingerprints = newFingerprints;
      this.lastCachedPrompt = this.formatSections(sections);
      this.lastCachedTools = tools;
    }

    return {
      systemPrompt: this.lastCachedPrompt,
      tools: this.lastCachedTools,
      changed,
    };
  }
}

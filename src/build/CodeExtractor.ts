import type { ExtractedCodeBlock } from './types';

/**
 * Extracts JavaScript/TypeScript code blocks from markdown-formatted
 * Claude Code responses and identifies blocks that define nbt_functions tools.
 */
export class CodeExtractor {
  /**
   * Extract all JS/TS code blocks from a markdown response.
   */
  static extractCodeBlocks(markdown: string): ExtractedCodeBlock[] {
    const blocks: ExtractedCodeBlock[] = [];
    const regex = /```(javascript|js|typescript|ts)?\s*\n([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(markdown)) !== null) {
      const language = (match[1] || 'javascript').toLowerCase();
      const code = match[2].trim();
      if (code) {
        blocks.push({ language, code, registered: false });
      }
    }

    return blocks;
  }

  /**
   * Check if a code block contains nbt_functions tool definitions.
   */
  static containsToolDefinitions(code: string): boolean {
    return /window\.nbt_functions\s*[.[=]/.test(code)
      || /(?:^|[^.])nbt_functions\s*[.[=]/.test(code);
  }

  /**
   * Extract tool names that a code block would register.
   */
  static extractToolNames(code: string): string[] {
    const names: string[] = [];

    // window.nbt_functions.toolName = ...
    const dotPattern = /window\.nbt_functions\.(\w+)\s*=/g;
    let match: RegExpExecArray | null;
    while ((match = dotPattern.exec(code)) !== null) {
      names.push(match[1]);
    }

    // window.nbt_functions['toolName'] = ... or ["toolName"]
    const bracketPattern = /window\.nbt_functions\[['"](\w+)['"]\]\s*=/g;
    while ((match = bracketPattern.exec(code)) !== null) {
      names.push(match[1]);
    }

    return [...new Set(names)];
  }
}

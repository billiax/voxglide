import { describe, it, expect } from 'vitest';
import { CodeExtractor } from '../../src/build/CodeExtractor';

describe('CodeExtractor', () => {
  describe('extractCodeBlocks', () => {
    it('extracts javascript code blocks', () => {
      const md = 'Some text\n```javascript\nconsole.log("hello");\n```\nMore text';
      const blocks = CodeExtractor.extractCodeBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].code).toBe('console.log("hello");');
      expect(blocks[0].registered).toBe(false);
    });

    it('extracts js code blocks', () => {
      const md = '```js\nconst x = 1;\n```';
      const blocks = CodeExtractor.extractCodeBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].code).toBe('const x = 1;');
    });

    it('extracts typescript code blocks', () => {
      const md = '```typescript\nconst x: number = 1;\n```';
      const blocks = CodeExtractor.extractCodeBlocks(md);
      expect(blocks).toHaveLength(1);
    });

    it('extracts ts code blocks', () => {
      const md = '```ts\nconst x: number = 1;\n```';
      const blocks = CodeExtractor.extractCodeBlocks(md);
      expect(blocks).toHaveLength(1);
    });

    it('extracts untagged code blocks', () => {
      const md = '```\nconst x = 1;\n```';
      const blocks = CodeExtractor.extractCodeBlocks(md);
      expect(blocks).toHaveLength(1);
    });

    it('extracts multiple code blocks', () => {
      const md = '```js\nconst a = 1;\n```\nSome text\n```javascript\nconst b = 2;\n```';
      const blocks = CodeExtractor.extractCodeBlocks(md);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].code).toBe('const a = 1;');
      expect(blocks[1].code).toBe('const b = 2;');
    });

    it('skips empty code blocks', () => {
      const md = '```js\n\n```';
      const blocks = CodeExtractor.extractCodeBlocks(md);
      expect(blocks).toHaveLength(0);
    });

    it('returns empty array for no code blocks', () => {
      const md = 'Just plain text with no code';
      const blocks = CodeExtractor.extractCodeBlocks(md);
      expect(blocks).toHaveLength(0);
    });

    it('ignores non-js/ts code blocks like python', () => {
      const md = '```python\nprint("hello")\n```';
      const blocks = CodeExtractor.extractCodeBlocks(md);
      expect(blocks).toHaveLength(0);
    });

    it('trims whitespace from code', () => {
      const md = '```js\n  const x = 1;  \n```';
      const blocks = CodeExtractor.extractCodeBlocks(md);
      expect(blocks[0].code).toBe('const x = 1;');
    });
  });

  describe('containsToolDefinitions', () => {
    it('detects window.nbt_functions.name = ...', () => {
      expect(CodeExtractor.containsToolDefinitions('window.nbt_functions.myTool = {')).toBe(true);
    });

    it('detects window.nbt_functions["name"] = ...', () => {
      expect(CodeExtractor.containsToolDefinitions('window.nbt_functions["myTool"] = {')).toBe(true);
    });

    it('detects window.nbt_functions = {', () => {
      expect(CodeExtractor.containsToolDefinitions('window.nbt_functions = {')).toBe(true);
    });

    it('detects nbt_functions.name = ... (without window)', () => {
      expect(CodeExtractor.containsToolDefinitions('nbt_functions.myTool = {')).toBe(true);
    });

    it('returns false for unrelated code', () => {
      expect(CodeExtractor.containsToolDefinitions('console.log("hello");')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(CodeExtractor.containsToolDefinitions('')).toBe(false);
    });
  });

  describe('extractToolNames', () => {
    it('extracts names from dot notation', () => {
      const code = 'window.nbt_functions.searchFiles = { handler: () => {} };';
      expect(CodeExtractor.extractToolNames(code)).toEqual(['searchFiles']);
    });

    it('extracts names from bracket notation with single quotes', () => {
      const code = "window.nbt_functions['searchFiles'] = { handler: () => {} };";
      expect(CodeExtractor.extractToolNames(code)).toEqual(['searchFiles']);
    });

    it('extracts names from bracket notation with double quotes', () => {
      const code = 'window.nbt_functions["searchFiles"] = { handler: () => {} };';
      expect(CodeExtractor.extractToolNames(code)).toEqual(['searchFiles']);
    });

    it('extracts multiple names', () => {
      const code = [
        'window.nbt_functions.searchFiles = {};',
        'window.nbt_functions.filterResults = {};',
      ].join('\n');
      const names = CodeExtractor.extractToolNames(code);
      expect(names).toContain('searchFiles');
      expect(names).toContain('filterResults');
    });

    it('deduplicates names', () => {
      const code = [
        'window.nbt_functions.myTool = {};',
        'window.nbt_functions.myTool = {};',
      ].join('\n');
      expect(CodeExtractor.extractToolNames(code)).toEqual(['myTool']);
    });

    it('returns empty array for code without tool definitions', () => {
      expect(CodeExtractor.extractToolNames('console.log("hello");')).toEqual([]);
    });
  });
});

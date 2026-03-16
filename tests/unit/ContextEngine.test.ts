import { describe, it, expect, vi } from 'vitest';
import { ContextEngine } from '../../src/context/ContextEngine';
import type { ContextProvider, ContextResult, ToolDeclaration } from '../../src/types';

function createMockTool(name: string): ToolDeclaration {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'input value' },
      },
      required: ['input'],
    },
  };
}

function createMockProvider(
  overrides: Partial<ContextProvider> & { name: string; type: string } = { name: 'test', type: 'mock' },
  result?: Partial<ContextResult>,
): ContextProvider {
  return {
    type: overrides.type,
    name: overrides.name,
    getContext: overrides.getContext ?? vi.fn(async (): Promise<ContextResult> => ({
      content: result?.content ?? `Content from ${overrides.name}`,
      tools: result?.tools ?? [],
    })),
  };
}

describe('ContextEngine', () => {
  describe('addProvider()', () => {
    it('stores a valid provider', () => {
      const engine = new ContextEngine();
      const provider = createMockProvider({ name: 'nav', type: 'navigation' });

      engine.addProvider(provider);

      expect(engine.getProvider('nav')).toBe(provider);
    });

    it('throws when provider is missing type', () => {
      const engine = new ContextEngine();
      const invalid = { name: 'bad', getContext: vi.fn() } as unknown as ContextProvider;

      expect(() => engine.addProvider(invalid)).toThrow('Provider must have type, name, and getContext()');
    });

    it('throws when provider is missing name', () => {
      const engine = new ContextEngine();
      const invalid = { type: 'x', getContext: vi.fn() } as unknown as ContextProvider;

      expect(() => engine.addProvider(invalid)).toThrow('Provider must have type, name, and getContext()');
    });

    it('throws when provider is missing getContext', () => {
      const engine = new ContextEngine();
      const invalid = { type: 'x', name: 'bad' } as unknown as ContextProvider;

      expect(() => engine.addProvider(invalid)).toThrow('Provider must have type, name, and getContext()');
    });

    it('throws when provider has empty string type', () => {
      const engine = new ContextEngine();
      const invalid = { type: '', name: 'bad', getContext: vi.fn() } as unknown as ContextProvider;

      expect(() => engine.addProvider(invalid)).toThrow('Provider must have type, name, and getContext()');
    });

    it('throws when provider has empty string name', () => {
      const engine = new ContextEngine();
      const invalid = { type: 'x', name: '', getContext: vi.fn() } as unknown as ContextProvider;

      expect(() => engine.addProvider(invalid)).toThrow('Provider must have type, name, and getContext()');
    });

    it('overwrites a provider with the same name', () => {
      const engine = new ContextEngine();
      const first = createMockProvider({ name: 'nav', type: 'navigation' });
      const second = createMockProvider({ name: 'nav', type: 'navigation-v2' });

      engine.addProvider(first);
      engine.addProvider(second);

      expect(engine.getProvider('nav')).toBe(second);
    });
  });

  describe('removeProvider()', () => {
    it('removes a provider by name', () => {
      const engine = new ContextEngine();
      const provider = createMockProvider({ name: 'nav', type: 'navigation' });

      engine.addProvider(provider);
      engine.removeProvider('nav');

      expect(engine.getProvider('nav')).toBeUndefined();
    });

    it('does not throw when removing a non-existent provider', () => {
      const engine = new ContextEngine();

      expect(() => engine.removeProvider('nonexistent')).not.toThrow();
    });
  });

  describe('getProvider()', () => {
    it('returns the provider when it exists', () => {
      const engine = new ContextEngine();
      const provider = createMockProvider({ name: 'forms', type: 'form' });

      engine.addProvider(provider);

      expect(engine.getProvider('forms')).toBe(provider);
    });

    it('returns undefined when provider does not exist', () => {
      const engine = new ContextEngine();

      expect(engine.getProvider('nonexistent')).toBeUndefined();
    });
  });

  describe('buildContext()', () => {
    it('collects content sections from all providers', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider(
        { name: 'forms', type: 'form' },
        { content: 'Form fields here', tools: [] },
      ));
      engine.addProvider(createMockProvider(
        { name: 'headings', type: 'heading' },
        { content: 'Page headings here', tools: [] },
      ));

      const { sections } = await engine.buildContext();

      expect(sections).toHaveLength(2);
      expect(sections[0]).toEqual({ type: 'form', name: 'forms', content: 'Form fields here' });
      expect(sections[1]).toEqual({ type: 'heading', name: 'headings', content: 'Page headings here' });
    });

    it('collects tools from all providers', async () => {
      const engine = new ContextEngine();
      const tool1 = createMockTool('click_button');
      const tool2 = createMockTool('fill_form');

      engine.addProvider(createMockProvider(
        { name: 'actions', type: 'action' },
        { content: 'action context', tools: [tool1] },
      ));
      engine.addProvider(createMockProvider(
        { name: 'forms', type: 'form' },
        { content: 'form context', tools: [tool2] },
      ));

      const { tools } = await engine.buildContext();

      expect(tools).toHaveLength(2);
      expect(tools[0]).toBe(tool1);
      expect(tools[1]).toBe(tool2);
    });

    it('skips sections with empty content', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider(
        { name: 'empty', type: 'none' },
        { content: '', tools: [] },
      ));
      engine.addProvider(createMockProvider(
        { name: 'full', type: 'content' },
        { content: 'has content', tools: [] },
      ));

      const { sections } = await engine.buildContext();

      expect(sections).toHaveLength(1);
      expect(sections[0].name).toBe('full');
    });

    it('handles provider errors gracefully and continues with others', async () => {
      const engine = new ContextEngine();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const failingProvider: ContextProvider = {
        type: 'broken',
        name: 'failing',
        getContext: vi.fn(async () => {
          throw new Error('provider crashed');
        }),
      };

      const workingProvider = createMockProvider(
        { name: 'working', type: 'good' },
        { content: 'still works', tools: [] },
      );

      engine.addProvider(failingProvider);
      engine.addProvider(workingProvider);

      const { sections } = await engine.buildContext();

      expect(sections).toHaveLength(1);
      expect(sections[0].name).toBe('working');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"failing"'),
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it('returns empty sections and tools when no providers exist', async () => {
      const engine = new ContextEngine();

      const result = await engine.buildContext();

      expect(result.sections).toEqual([]);
      expect(result.tools).toEqual([]);
    });

    it('still collects tools even when content is empty', async () => {
      const engine = new ContextEngine();
      const tool = createMockTool('hidden_tool');

      engine.addProvider(createMockProvider(
        { name: 'toolonly', type: 'tool' },
        { content: '', tools: [tool] },
      ));

      const { sections, tools } = await engine.buildContext();

      expect(sections).toHaveLength(0);
      expect(tools).toHaveLength(1);
      expect(tools[0]).toBe(tool);
    });
  });

  describe('buildSystemPrompt()', () => {
    it('formats sections with header and footer markers', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider(
        { name: 'navigation', type: 'nav' },
        { content: 'Home | About | Contact', tools: [] },
      ));

      const prompt = await engine.buildSystemPrompt();

      expect(prompt).toContain('=== PAGE CONTEXT ===');
      expect(prompt).toContain('[navigation]');
      expect(prompt).toContain('Home | About | Contact');
      expect(prompt).toContain('=== END CONTEXT ===');
    });

    it('includes multiple sections in order', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider(
        { name: 'nav', type: 'navigation' },
        { content: 'nav content', tools: [] },
      ));
      engine.addProvider(createMockProvider(
        { name: 'forms', type: 'form' },
        { content: 'form content', tools: [] },
      ));

      const prompt = await engine.buildSystemPrompt();

      const navIndex = prompt.indexOf('[nav]');
      const formsIndex = prompt.indexOf('[forms]');
      expect(navIndex).toBeLessThan(formsIndex);
      expect(prompt).toContain('nav content');
      expect(prompt).toContain('form content');
    });

    it('returns empty string when no providers are registered', async () => {
      const engine = new ContextEngine();

      const prompt = await engine.buildSystemPrompt();

      expect(prompt).toBe('');
    });

    it('returns empty string when all providers return empty content', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider(
        { name: 'empty1', type: 'none' },
        { content: '', tools: [] },
      ));

      const prompt = await engine.buildSystemPrompt();

      expect(prompt).toBe('');
    });

    it('prompt structure starts with PAGE CONTEXT and ends with END CONTEXT', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider(
        { name: 'test', type: 'test' },
        { content: 'test content', tools: [] },
      ));

      const prompt = await engine.buildSystemPrompt();
      const lines = prompt.split('\n');

      expect(lines[0]).toBe('=== PAGE CONTEXT ===');
      expect(lines[lines.length - 1]).toBe('=== END CONTEXT ===');
    });
  });

  describe('getTools()', () => {
    it('returns aggregated tools from all providers', async () => {
      const engine = new ContextEngine();
      const tool1 = createMockTool('tool_a');
      const tool2 = createMockTool('tool_b');
      const tool3 = createMockTool('tool_c');

      engine.addProvider(createMockProvider(
        { name: 'p1', type: 'a' },
        { content: 'ctx', tools: [tool1, tool2] },
      ));
      engine.addProvider(createMockProvider(
        { name: 'p2', type: 'b' },
        { content: 'ctx', tools: [tool3] },
      ));

      const tools = await engine.getTools();

      expect(tools).toHaveLength(3);
      expect(tools).toContain(tool1);
      expect(tools).toContain(tool2);
      expect(tools).toContain(tool3);
    });

    it('returns empty array when no providers exist', async () => {
      const engine = new ContextEngine();

      const tools = await engine.getTools();

      expect(tools).toEqual([]);
    });

    it('returns empty array when no providers declare tools', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider(
        { name: 'notool', type: 'basic' },
        { content: 'some content', tools: [] },
      ));

      const tools = await engine.getTools();

      expect(tools).toEqual([]);
    });
  });

  describe('buildSystemPromptAndTools()', () => {
    it('returns both systemPrompt and tools from a single call', async () => {
      const engine = new ContextEngine();
      const tool = createMockTool('my_tool');

      engine.addProvider(createMockProvider(
        { name: 'nav', type: 'navigation' },
        { content: 'nav content', tools: [tool] },
      ));

      const result = await engine.buildSystemPromptAndTools();

      expect(result.systemPrompt).toContain('[nav]');
      expect(result.systemPrompt).toContain('nav content');
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toBe(tool);
    });

    it('output matches buildSystemPrompt() + getTools() individually', async () => {
      const engine = new ContextEngine();
      const tool1 = createMockTool('t1');
      const tool2 = createMockTool('t2');

      engine.addProvider(createMockProvider(
        { name: 'forms', type: 'form' },
        { content: 'form data', tools: [tool1] },
      ));
      engine.addProvider(createMockProvider(
        { name: 'headings', type: 'heading' },
        { content: 'heading data', tools: [tool2] },
      ));

      const combined = await engine.buildSystemPromptAndTools();
      const separatePrompt = await engine.buildSystemPrompt();
      const separateTools = await engine.getTools();

      expect(combined.systemPrompt).toBe(separatePrompt);
      expect(combined.tools).toEqual(separateTools);
    });

    it('returns empty systemPrompt and empty tools when no providers exist', async () => {
      const engine = new ContextEngine();

      const result = await engine.buildSystemPromptAndTools();

      expect(result.systemPrompt).toBe('');
      expect(result.tools).toEqual([]);
    });
  });

  describe('buildSystemPromptAndToolsIfChanged()', () => {
    it('returns changed: true on first call', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider(
        { name: 'test', type: 'test' },
        { content: 'hello', tools: [] },
      ));

      const result = await engine.buildSystemPromptAndToolsIfChanged();

      expect(result.changed).toBe(true);
      expect(result.systemPrompt).toContain('hello');
    });

    it('returns changed: false when called again with same provider content', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider(
        { name: 'test', type: 'test' },
        { content: 'stable content', tools: [] },
      ));

      await engine.buildSystemPromptAndToolsIfChanged();
      const result = await engine.buildSystemPromptAndToolsIfChanged();

      expect(result.changed).toBe(false);
      expect(result.systemPrompt).toContain('stable content');
    });

    it('returns changed: true when provider content changes', async () => {
      const engine = new ContextEngine();
      let content = 'version 1';
      const provider: ContextProvider = {
        type: 'dynamic',
        name: 'dynamic',
        getContext: async () => ({ content, tools: [] }),
      };
      engine.addProvider(provider);

      await engine.buildSystemPromptAndToolsIfChanged();

      content = 'version 2';
      const result = await engine.buildSystemPromptAndToolsIfChanged();

      expect(result.changed).toBe(true);
      expect(result.systemPrompt).toContain('version 2');
    });

    it('returns changed: true when a provider is removed', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider(
        { name: 'a', type: 'test' },
        { content: 'section a', tools: [] },
      ));
      engine.addProvider(createMockProvider(
        { name: 'b', type: 'test' },
        { content: 'section b', tools: [] },
      ));

      await engine.buildSystemPromptAndToolsIfChanged();

      engine.removeProvider('b');
      const result = await engine.buildSystemPromptAndToolsIfChanged();

      expect(result.changed).toBe(true);
      expect(result.systemPrompt).toContain('section a');
      expect(result.systemPrompt).not.toContain('section b');
    });

    it('returns changed: true when a provider is added', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider(
        { name: 'a', type: 'test' },
        { content: 'section a', tools: [] },
      ));

      await engine.buildSystemPromptAndToolsIfChanged();

      engine.addProvider(createMockProvider(
        { name: 'b', type: 'test' },
        { content: 'section b', tools: [] },
      ));
      const result = await engine.buildSystemPromptAndToolsIfChanged();

      expect(result.changed).toBe(true);
      expect(result.systemPrompt).toContain('section b');
    });
  });
});

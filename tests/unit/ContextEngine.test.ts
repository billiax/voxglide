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
});

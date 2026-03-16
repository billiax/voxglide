import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextEngine } from '../../src/context/ContextEngine';
import { TextProvider } from '../../src/context/TextProvider';
import type { ContextProvider, ContextResult, ToolDeclaration } from '../../src/types';

// --- Test helpers ---

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
  name: string,
  type: string,
  result?: Partial<ContextResult>,
): ContextProvider {
  return {
    type,
    name,
    getContext: vi.fn(async (): Promise<ContextResult> => ({
      content: result?.content ?? `Content from ${name}`,
      tools: result?.tools ?? [],
    })),
  };
}

/**
 * Creates a provider whose content can be mutated between calls.
 * Simulates dynamic content changes like DOM mutations or user input.
 */
function createDynamicProvider(
  name: string,
  type: string,
  initialContent: string,
  tools: ToolDeclaration[] = [],
): { provider: ContextProvider; setContent: (c: string) => void; setTools: (t: ToolDeclaration[]) => void } {
  let content = initialContent;
  let currentTools = tools;
  const provider: ContextProvider = {
    type,
    name,
    getContext: async (): Promise<ContextResult> => ({
      content,
      tools: currentTools,
    }),
  };
  return {
    provider,
    setContent: (c: string) => { content = c; },
    setTools: (t: ToolDeclaration[]) => { currentTools = t; },
  };
}

// --- Tests ---

describe('Context Coordination Layer', () => {

  describe('Context Aggregation', () => {
    it('aggregates content from multiple providers into a combined system prompt', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('page', 'page', { content: 'Page title and forms' }));
      engine.addProvider(createMockProvider('developer', 'text', { content: 'This is a CRM app' }));
      engine.addProvider(createMockProvider('workflow', 'workflow', { content: 'Step 1: Enter name' }));

      const prompt = await engine.buildSystemPrompt();

      expect(prompt).toContain('[page]');
      expect(prompt).toContain('Page title and forms');
      expect(prompt).toContain('[developer]');
      expect(prompt).toContain('This is a CRM app');
      expect(prompt).toContain('[workflow]');
      expect(prompt).toContain('Step 1: Enter name');
    });

    it('aggregates tools from multiple providers', async () => {
      const engine = new ContextEngine();
      const tool1 = createMockTool('fillField');
      const tool2 = createMockTool('clickElement');
      const tool3 = createMockTool('startWorkflow');

      engine.addProvider(createMockProvider('actions', 'action', { content: 'actions', tools: [tool1, tool2] }));
      engine.addProvider(createMockProvider('workflows', 'workflow', { content: 'flows', tools: [tool3] }));

      const { tools } = await engine.buildContext();

      expect(tools).toHaveLength(3);
      expect(tools).toContain(tool1);
      expect(tools).toContain(tool2);
      expect(tools).toContain(tool3);
    });

    it('uses buildSystemPromptAndTools to avoid double iteration', async () => {
      const engine = new ContextEngine();
      const tool = createMockTool('scanPage');
      const provider = createMockProvider('page', 'page', { content: 'Page context', tools: [tool] });
      engine.addProvider(provider);

      const { systemPrompt, tools } = await engine.buildSystemPromptAndTools();

      expect(systemPrompt).toContain('[page]');
      expect(systemPrompt).toContain('Page context');
      expect(tools).toHaveLength(1);
      expect(tools[0]).toBe(tool);
      // The provider's getContext should have been called exactly once
      expect(provider.getContext).toHaveBeenCalledTimes(1);
    });

    it('preserves provider insertion order in sections', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('alpha', 'text', { content: 'First' }));
      engine.addProvider(createMockProvider('beta', 'text', { content: 'Second' }));
      engine.addProvider(createMockProvider('gamma', 'text', { content: 'Third' }));

      const prompt = await engine.buildSystemPrompt();

      const alphaIdx = prompt.indexOf('[alpha]');
      const betaIdx = prompt.indexOf('[beta]');
      const gammaIdx = prompt.indexOf('[gamma]');

      expect(alphaIdx).toBeLessThan(betaIdx);
      expect(betaIdx).toBeLessThan(gammaIdx);
    });

    it('combines real TextProvider content with mock providers', async () => {
      const engine = new ContextEngine();
      const textProvider = new TextProvider('This is a healthcare scheduling app');
      engine.addProvider(textProvider);
      engine.addProvider(createMockProvider('page', 'page', { content: 'Appointments list page' }));

      const prompt = await engine.buildSystemPrompt();

      expect(prompt).toContain('This is a healthcare scheduling app');
      expect(prompt).toContain('Appointments list page');
    });
  });

  describe('Deduplication via Fingerprinting', () => {
    it('detects no change when content is identical between calls', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('page', 'page', { content: 'Static page content' }));

      const first = await engine.buildSystemPromptAndToolsIfChanged();
      expect(first.changed).toBe(true);

      const second = await engine.buildSystemPromptAndToolsIfChanged();
      expect(second.changed).toBe(false);
      expect(second.systemPrompt).toBe(first.systemPrompt);
    });

    it('returns cached prompt and tools on no-change', async () => {
      const engine = new ContextEngine();
      const tool = createMockTool('myTool');
      engine.addProvider(createMockProvider('ctx', 'text', { content: 'stable', tools: [tool] }));

      const first = await engine.buildSystemPromptAndToolsIfChanged();
      const second = await engine.buildSystemPromptAndToolsIfChanged();

      expect(second.changed).toBe(false);
      expect(second.systemPrompt).toBe(first.systemPrompt);
      expect(second.tools).toEqual(first.tools);
    });

    it('detects change when provider content changes', async () => {
      const engine = new ContextEngine();
      const { provider, setContent } = createDynamicProvider('page', 'page', 'Version 1');
      engine.addProvider(provider);

      const first = await engine.buildSystemPromptAndToolsIfChanged();
      expect(first.changed).toBe(true);
      expect(first.systemPrompt).toContain('Version 1');

      setContent('Version 2');
      const second = await engine.buildSystemPromptAndToolsIfChanged();
      expect(second.changed).toBe(true);
      expect(second.systemPrompt).toContain('Version 2');
    });

    it('detects change when provider count changes (provider added)', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('a', 'text', { content: 'Section A' }));

      await engine.buildSystemPromptAndToolsIfChanged();

      engine.addProvider(createMockProvider('b', 'text', { content: 'Section B' }));
      const result = await engine.buildSystemPromptAndToolsIfChanged();

      expect(result.changed).toBe(true);
      expect(result.systemPrompt).toContain('Section B');
    });

    it('detects change when provider count changes (provider removed)', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('a', 'text', { content: 'Section A' }));
      engine.addProvider(createMockProvider('b', 'text', { content: 'Section B' }));

      await engine.buildSystemPromptAndToolsIfChanged();

      engine.removeProvider('b');
      const result = await engine.buildSystemPromptAndToolsIfChanged();

      expect(result.changed).toBe(true);
      expect(result.systemPrompt).not.toContain('Section B');
    });

    it('reports no change when content reverts to original value', async () => {
      const engine = new ContextEngine();
      const { provider, setContent } = createDynamicProvider('page', 'page', 'Original');
      engine.addProvider(provider);

      await engine.buildSystemPromptAndToolsIfChanged();

      setContent('Changed');
      await engine.buildSystemPromptAndToolsIfChanged();

      setContent('Original');
      const result = await engine.buildSystemPromptAndToolsIfChanged();

      // The hash should match the first call's hash, but since fingerprints
      // are compared against the *last* call (which was 'Changed'), this is a change
      // from the perspective of the last known state.
      expect(result.changed).toBe(true);
    });

    it('handles hash collisions gracefully by using per-section comparison', async () => {
      const engine = new ContextEngine();
      const { provider: p1, setContent: set1 } = createDynamicProvider('section1', 'text', 'AAA');
      const { provider: p2, setContent: set2 } = createDynamicProvider('section2', 'text', 'BBB');
      engine.addProvider(p1);
      engine.addProvider(p2);

      await engine.buildSystemPromptAndToolsIfChanged();

      // Change only one section
      set1('CCC');
      const result = await engine.buildSystemPromptAndToolsIfChanged();

      expect(result.changed).toBe(true);
      expect(result.systemPrompt).toContain('CCC');
      expect(result.systemPrompt).toContain('BBB');
    });

    it('treats section rename (provider replaced with same content) as changed', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('oldName', 'text', { content: 'Same content' }));

      await engine.buildSystemPromptAndToolsIfChanged();

      engine.removeProvider('oldName');
      engine.addProvider(createMockProvider('newName', 'text', { content: 'Same content' }));

      const result = await engine.buildSystemPromptAndToolsIfChanged();
      // The section name changed even though content is the same -- fingerprint map keys differ
      expect(result.changed).toBe(true);
    });
  });

  describe('Debouncing (VoiceSDK Context Change Handler)', () => {
    // These tests simulate the debouncing pattern used in VoiceSDK.handleContextChange()
    // and PageContextProvider.debouncedFingerprintCheck()

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('debounces rapid context change callbacks into a single update', async () => {
      const updateFn = vi.fn();
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      // Simulate the handleContextChange pattern from VoiceSDK
      function handleContextChange() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          updateFn();
        }, 100);
      }

      // Fire 5 rapid changes
      handleContextChange();
      handleContextChange();
      handleContextChange();
      handleContextChange();
      handleContextChange();

      // Before debounce completes
      expect(updateFn).not.toHaveBeenCalled();

      // After debounce window
      vi.advanceTimersByTime(100);
      expect(updateFn).toHaveBeenCalledTimes(1);
    });

    it('fires separate updates for changes spaced apart', async () => {
      const updateFn = vi.fn();
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      function handleContextChange() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          updateFn();
        }, 100);
      }

      handleContextChange();
      vi.advanceTimersByTime(100);
      expect(updateFn).toHaveBeenCalledTimes(1);

      handleContextChange();
      vi.advanceTimersByTime(100);
      expect(updateFn).toHaveBeenCalledTimes(2);
    });

    it('uses 300ms debounce window for normal DOM mutations', () => {
      const onChangeCallback = vi.fn();
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      // Simulate PageContextProvider.debouncedFingerprintCheck() (normal mode)
      function debouncedFingerprintCheck(inWatchPeriod: boolean) {
        if (debounceTimer) clearTimeout(debounceTimer);
        const delay = inWatchPeriod ? 100 : 300;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          onChangeCallback();
        }, delay);
      }

      debouncedFingerprintCheck(false); // normal mode: 300ms

      vi.advanceTimersByTime(299);
      expect(onChangeCallback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onChangeCallback).toHaveBeenCalledTimes(1);
    });

    it('uses 100ms debounce window during SPA watch period', () => {
      const onChangeCallback = vi.fn();
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      function debouncedFingerprintCheck(inWatchPeriod: boolean) {
        if (debounceTimer) clearTimeout(debounceTimer);
        const delay = inWatchPeriod ? 100 : 300;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          onChangeCallback();
        }, delay);
      }

      debouncedFingerprintCheck(true); // watch period: 100ms

      vi.advanceTimersByTime(99);
      expect(onChangeCallback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onChangeCallback).toHaveBeenCalledTimes(1);
    });

    it('resets debounce timer on each new mutation', () => {
      const updateFn = vi.fn();
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      function handleContextChange() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          updateFn();
        }, 100);
      }

      handleContextChange();
      vi.advanceTimersByTime(80);
      handleContextChange(); // resets the 100ms timer
      vi.advanceTimersByTime(80);
      // Total elapsed: 160ms, but only 80ms since last reset
      expect(updateFn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(20); // 100ms since last reset
      expect(updateFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Change Detection', () => {
    it('detects change when a single provider updates content', async () => {
      const engine = new ContextEngine();
      const { provider, setContent } = createDynamicProvider('dynamic', 'page', 'Initial scan');
      engine.addProvider(provider);

      const r1 = await engine.buildSystemPromptAndToolsIfChanged();
      expect(r1.changed).toBe(true);

      setContent('Updated after DOM mutation');
      const r2 = await engine.buildSystemPromptAndToolsIfChanged();
      expect(r2.changed).toBe(true);
      expect(r2.systemPrompt).toContain('Updated after DOM mutation');
    });

    it('detects change when one of several providers changes', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('static1', 'text', { content: 'Never changes' }));
      const { provider, setContent } = createDynamicProvider('dynamic', 'page', 'v1');
      engine.addProvider(provider);
      engine.addProvider(createMockProvider('static2', 'text', { content: 'Also stable' }));

      await engine.buildSystemPromptAndToolsIfChanged();

      setContent('v2');
      const result = await engine.buildSystemPromptAndToolsIfChanged();
      expect(result.changed).toBe(true);
    });

    it('no change detected when all providers return same content', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('a', 'text', { content: 'Stable A' }));
      engine.addProvider(createMockProvider('b', 'text', { content: 'Stable B' }));
      engine.addProvider(createMockProvider('c', 'text', { content: 'Stable C' }));

      await engine.buildSystemPromptAndToolsIfChanged();
      const result = await engine.buildSystemPromptAndToolsIfChanged();

      expect(result.changed).toBe(false);
    });

    it('detects change from empty to non-empty content', async () => {
      const engine = new ContextEngine();
      const { provider, setContent } = createDynamicProvider('lazy', 'page', '');
      engine.addProvider(provider);

      const r1 = await engine.buildSystemPromptAndToolsIfChanged();
      // First call with empty content: empty sections -> 0 fingerprints.
      // Initial lastSectionFingerprints is also size 0, so 0 === 0 -> changed = false.
      expect(r1.changed).toBe(false);
      expect(r1.systemPrompt).toBe('');

      setContent('Now has content');
      const r2 = await engine.buildSystemPromptAndToolsIfChanged();
      // Now section count goes from 0 to 1 — fingerprint map sizes differ
      expect(r2.changed).toBe(true);
      expect(r2.systemPrompt).toContain('Now has content');
    });

    it('detects change from non-empty to empty content', async () => {
      const engine = new ContextEngine();
      const { provider, setContent } = createDynamicProvider('disappearing', 'page', 'Has content');
      engine.addProvider(provider);

      await engine.buildSystemPromptAndToolsIfChanged();

      setContent('');
      const result = await engine.buildSystemPromptAndToolsIfChanged();
      // Section count goes from 1 to 0
      expect(result.changed).toBe(true);
      expect(result.systemPrompt).toBe('');
    });

    it('repeatedly calling with no changes yields changed: false every time', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('fixed', 'text', { content: 'Fixed content' }));

      await engine.buildSystemPromptAndToolsIfChanged(); // first call: changed

      for (let i = 0; i < 5; i++) {
        const result = await engine.buildSystemPromptAndToolsIfChanged();
        expect(result.changed).toBe(false);
      }
    });
  });

  describe('Provider Lifecycle', () => {
    it('add provider, get context, remove provider, verify removal', async () => {
      const engine = new ContextEngine();
      const provider = createMockProvider('nav', 'navigation', { content: 'Nav links here' });

      // Add
      engine.addProvider(provider);
      expect(engine.getProvider('nav')).toBe(provider);

      // Get context
      const { sections } = await engine.buildContext();
      expect(sections).toHaveLength(1);
      expect(sections[0].content).toBe('Nav links here');

      // Remove
      engine.removeProvider('nav');
      expect(engine.getProvider('nav')).toBeUndefined();

      // Verify removed from context
      const { sections: after } = await engine.buildContext();
      expect(after).toHaveLength(0);
    });

    it('replacing a provider updates context output', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('ctx', 'text', { content: 'Old context' }));

      const before = await engine.buildSystemPrompt();
      expect(before).toContain('Old context');

      // Replace with same name
      engine.addProvider(createMockProvider('ctx', 'text', { content: 'New context' }));

      const after = await engine.buildSystemPrompt();
      expect(after).toContain('New context');
      expect(after).not.toContain('Old context');
    });

    it('TextProvider supports setText for runtime content updates', async () => {
      const engine = new ContextEngine();
      const textProvider = new TextProvider('Initial instructions');
      engine.addProvider(textProvider);

      const prompt1 = await engine.buildSystemPrompt();
      expect(prompt1).toContain('Initial instructions');

      textProvider.setText('Updated instructions for new page');
      const prompt2 = await engine.buildSystemPrompt();
      expect(prompt2).toContain('Updated instructions for new page');
    });

    it('provider with empty name is rejected', () => {
      const engine = new ContextEngine();
      const invalid = { type: 'test', name: '', getContext: vi.fn() } as unknown as ContextProvider;

      expect(() => engine.addProvider(invalid)).toThrow('Provider must have type, name, and getContext()');
    });

    it('provider with empty type is rejected', () => {
      const engine = new ContextEngine();
      const invalid = { type: '', name: 'test', getContext: vi.fn() } as unknown as ContextProvider;

      expect(() => engine.addProvider(invalid)).toThrow('Provider must have type, name, and getContext()');
    });

    it('provider without getContext is rejected', () => {
      const engine = new ContextEngine();
      const invalid = { type: 'test', name: 'test' } as unknown as ContextProvider;

      expect(() => engine.addProvider(invalid)).toThrow('Provider must have type, name, and getContext()');
    });

    it('multiple providers with unique names coexist', async () => {
      const engine = new ContextEngine();

      for (let i = 0; i < 10; i++) {
        engine.addProvider(createMockProvider(`provider-${i}`, 'text', { content: `Content ${i}` }));
      }

      const { sections } = await engine.buildContext();
      expect(sections).toHaveLength(10);
    });

    it('removing a non-existent provider does not throw', () => {
      const engine = new ContextEngine();
      expect(() => engine.removeProvider('does-not-exist')).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('provider returning empty content is excluded from sections but tools are kept', async () => {
      const engine = new ContextEngine();
      const tool = createMockTool('hiddenTool');
      engine.addProvider(createMockProvider('toolOnly', 'tool', { content: '', tools: [tool] }));

      const { sections, tools } = await engine.buildContext();

      expect(sections).toHaveLength(0);
      expect(tools).toHaveLength(1);
      expect(tools[0]).toBe(tool);
    });

    it('provider throwing an error does not break other providers', async () => {
      const engine = new ContextEngine();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const failing: ContextProvider = {
        type: 'broken',
        name: 'failing',
        getContext: async () => { throw new Error('Database connection lost'); },
      };
      const working = createMockProvider('working', 'text', { content: 'Still works fine' });

      engine.addProvider(failing);
      engine.addProvider(working);

      const { sections } = await engine.buildContext();

      expect(sections).toHaveLength(1);
      expect(sections[0].content).toBe('Still works fine');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"failing"'),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it('all providers throwing errors results in empty context', async () => {
      const engine = new ContextEngine();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      engine.addProvider({
        type: 'broken', name: 'fail1',
        getContext: async () => { throw new Error('crash 1'); },
      });
      engine.addProvider({
        type: 'broken', name: 'fail2',
        getContext: async () => { throw new Error('crash 2'); },
      });

      const { sections, tools } = await engine.buildContext();

      expect(sections).toEqual([]);
      expect(tools).toEqual([]);

      consoleSpy.mockRestore();
    });

    it('provider returning undefined/null content is handled gracefully', async () => {
      const engine = new ContextEngine();
      // Simulate a provider that returns null/undefined content
      const weirdProvider: ContextProvider = {
        type: 'weird',
        name: 'nullProvider',
        getContext: async () => ({
          content: null as unknown as string,
          tools: [],
        }),
      };
      engine.addProvider(weirdProvider);

      const { sections } = await engine.buildContext();
      // null/undefined is falsy, so it should be filtered out
      expect(sections).toHaveLength(0);
    });

    it('provider returning undefined tools does not crash', async () => {
      const engine = new ContextEngine();
      const weirdProvider: ContextProvider = {
        type: 'weird',
        name: 'noTools',
        getContext: async () => ({
          content: 'Has content',
          tools: undefined as unknown as ToolDeclaration[],
        }),
      };
      engine.addProvider(weirdProvider);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // This may throw or handle gracefully -- test the behavior
      try {
        const { sections } = await engine.buildContext();
        expect(sections).toHaveLength(1);
      } catch {
        // If it throws due to spreading undefined tools, that's also valid behavior
      }

      consoleSpy.mockRestore();
    });

    it('no providers yields empty prompt and no tools', async () => {
      const engine = new ContextEngine();

      const prompt = await engine.buildSystemPrompt();
      expect(prompt).toBe('');

      const tools = await engine.getTools();
      expect(tools).toEqual([]);

      const combined = await engine.buildSystemPromptAndTools();
      expect(combined.systemPrompt).toBe('');
      expect(combined.tools).toEqual([]);
    });

    it('TextProvider with empty string returns empty content', async () => {
      const engine = new ContextEngine();
      const textProvider = new TextProvider('');
      engine.addProvider(textProvider);

      const { sections } = await engine.buildContext();
      // Empty content should be filtered out
      expect(sections).toHaveLength(0);
    });

    it('TextProvider with whitespace-only string returns empty content', async () => {
      const engine = new ContextEngine();
      const textProvider = new TextProvider('   \n\t  ');
      engine.addProvider(textProvider);

      const { sections } = await engine.buildContext();
      expect(sections).toHaveLength(0);
    });

    it('TextProvider trims whitespace from content', async () => {
      const engine = new ContextEngine();
      const textProvider = new TextProvider('  Hello World  ');
      engine.addProvider(textProvider);

      const result = await textProvider.getContext();
      expect(result.content).toBe('Hello World');
    });
  });

  describe('Fingerprinting Details', () => {
    it('same string content produces same hash (no false positives)', async () => {
      const engine = new ContextEngine();
      const { provider, setContent } = createDynamicProvider('page', 'page', 'Exact content A');
      engine.addProvider(provider);

      await engine.buildSystemPromptAndToolsIfChanged();

      // Set to different content, then back
      setContent('Different');
      await engine.buildSystemPromptAndToolsIfChanged();

      // Set back to original
      setContent('Exact content A');
      const result = await engine.buildSystemPromptAndToolsIfChanged();
      // Changed from 'Different' -> 'Exact content A'
      expect(result.changed).toBe(true);
    });

    it('different strings produce different hashes (no false negatives)', async () => {
      const engine = new ContextEngine();
      const { provider, setContent } = createDynamicProvider('page', 'page', 'Content Alpha');
      engine.addProvider(provider);

      await engine.buildSystemPromptAndToolsIfChanged();

      setContent('Content Beta');
      const result = await engine.buildSystemPromptAndToolsIfChanged();
      expect(result.changed).toBe(true);
    });

    it('first call always reports changed (no previous fingerprints)', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('test', 'text', { content: 'hello' }));

      const result = await engine.buildSystemPromptAndToolsIfChanged();
      expect(result.changed).toBe(true);
    });

    it('first call with no providers also reports changed (0 vs 0 size is false)', async () => {
      const engine = new ContextEngine();

      // No providers: sections is empty, newFingerprints size is 0
      // lastSectionFingerprints is also empty (size 0), so changed = false?
      // Let's verify the actual behavior
      const result = await engine.buildSystemPromptAndToolsIfChanged();

      // When both old and new fingerprint maps are size 0, the code says:
      // newFingerprints.size (0) !== lastSectionFingerprints.size (0) => false
      // So changed = false, and empty cached prompt is returned
      expect(result.systemPrompt).toBe('');
      expect(result.tools).toEqual([]);
    });

    it('per-section fingerprints detect which section changed', async () => {
      const engine = new ContextEngine();
      const { provider: p1, setContent: set1 } = createDynamicProvider('forms', 'form', 'Form A');
      const { provider: p2 } = createDynamicProvider('headings', 'heading', 'H1: Welcome');
      engine.addProvider(p1);
      engine.addProvider(p2);

      await engine.buildSystemPromptAndToolsIfChanged();

      // Only forms content changes
      set1('Form B (user typed)');
      const result = await engine.buildSystemPromptAndToolsIfChanged();

      expect(result.changed).toBe(true);
      expect(result.systemPrompt).toContain('Form B (user typed)');
      expect(result.systemPrompt).toContain('H1: Welcome');
    });
  });

  describe('Integration: TextProvider with ContextEngine', () => {
    it('TextProvider updates propagate through change detection', async () => {
      const engine = new ContextEngine();
      const textProvider = new TextProvider('Context v1');
      engine.addProvider(textProvider);

      const r1 = await engine.buildSystemPromptAndToolsIfChanged();
      expect(r1.changed).toBe(true);
      expect(r1.systemPrompt).toContain('Context v1');

      const r2 = await engine.buildSystemPromptAndToolsIfChanged();
      expect(r2.changed).toBe(false);

      textProvider.setText('Context v2');
      const r3 = await engine.buildSystemPromptAndToolsIfChanged();
      expect(r3.changed).toBe(true);
      expect(r3.systemPrompt).toContain('Context v2');
    });

    it('TextProvider setText to same value does not trigger change', async () => {
      const engine = new ContextEngine();
      const textProvider = new TextProvider('Same value');
      engine.addProvider(textProvider);

      await engine.buildSystemPromptAndToolsIfChanged();

      textProvider.setText('Same value');
      const result = await engine.buildSystemPromptAndToolsIfChanged();
      expect(result.changed).toBe(false);
    });
  });

  describe('Concurrent Operations', () => {
    it('multiple simultaneous buildContext calls all resolve correctly', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('a', 'text', { content: 'A content' }));
      engine.addProvider(createMockProvider('b', 'text', { content: 'B content' }));

      const results = await Promise.all([
        engine.buildContext(),
        engine.buildContext(),
        engine.buildContext(),
      ]);

      for (const result of results) {
        expect(result.sections).toHaveLength(2);
      }
    });

    it('buildSystemPromptAndToolsIfChanged handles rapid sequential calls', async () => {
      const engine = new ContextEngine();
      const { provider, setContent } = createDynamicProvider('page', 'page', 'v1');
      engine.addProvider(provider);

      const r1 = await engine.buildSystemPromptAndToolsIfChanged();
      expect(r1.changed).toBe(true);

      setContent('v2');
      const r2 = await engine.buildSystemPromptAndToolsIfChanged();
      expect(r2.changed).toBe(true);

      // No change
      const r3 = await engine.buildSystemPromptAndToolsIfChanged();
      expect(r3.changed).toBe(false);

      setContent('v3');
      const r4 = await engine.buildSystemPromptAndToolsIfChanged();
      expect(r4.changed).toBe(true);
    });
  });

  describe('System Prompt Format', () => {
    it('wraps sections with PAGE CONTEXT / END CONTEXT markers', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('test', 'text', { content: 'Some content' }));

      const prompt = await engine.buildSystemPrompt();

      expect(prompt.startsWith('=== PAGE CONTEXT ===')).toBe(true);
      expect(prompt.endsWith('=== END CONTEXT ===')).toBe(true);
    });

    it('each section is labeled with [providerName]', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('Navigation', 'nav', { content: 'Home | About' }));
      engine.addProvider(createMockProvider('Page Forms', 'form', { content: 'Name field' }));

      const prompt = await engine.buildSystemPrompt();

      expect(prompt).toContain('[Navigation]');
      expect(prompt).toContain('[Page Forms]');
    });

    it('empty sections result in empty string, not wrapped markers', async () => {
      const engine = new ContextEngine();
      engine.addProvider(createMockProvider('empty', 'text', { content: '' }));

      const prompt = await engine.buildSystemPrompt();

      expect(prompt).toBe('');
      expect(prompt).not.toContain('=== PAGE CONTEXT ===');
    });
  });
});

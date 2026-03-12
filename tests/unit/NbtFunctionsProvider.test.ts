import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NbtFunctionsProvider } from '../../src/actions/NbtFunctionsProvider';

describe('NbtFunctionsProvider', () => {
  let onChange: ReturnType<typeof vi.fn>;
  let provider: NbtFunctionsProvider | null;

  beforeEach(() => {
    onChange = vi.fn();
    provider = null;
    delete window.nbt_functions;
  });

  afterEach(() => {
    provider?.destroy();
    delete window.nbt_functions;
  });

  function makeProvider(debug = false): NbtFunctionsProvider {
    provider = new NbtFunctionsProvider(onChange, debug);
    return provider;
  }

  describe('discovery on construction', () => {
    it('reads window.nbt_functions on construction', () => {
      window.nbt_functions = {
        greet: {
          description: 'Say hello',
          handler: () => 'hello',
        },
      };
      const p = makeProvider();
      expect(p.getRegisteredNames()).toEqual(new Set(['greet']));
    });

    it('calls onChange with added functions on construction', () => {
      window.nbt_functions = {
        greet: {
          description: 'Say hello',
          handler: () => 'hello',
        },
      };
      makeProvider();
      expect(onChange).toHaveBeenCalledWith(['greet'], []);
    });

    it('handles undefined window.nbt_functions', () => {
      const p = makeProvider();
      expect(p.getRegisteredNames().size).toBe(0);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('skips entries without description', () => {
      window.nbt_functions = {
        bad: { handler: () => 'x' } as any,
      };
      const p = makeProvider();
      expect(p.getRegisteredNames().size).toBe(0);
    });

    it('skips entries with empty description', () => {
      window.nbt_functions = {
        bad: { description: '  ', handler: () => 'x' },
      };
      const p = makeProvider();
      expect(p.getRegisteredNames().size).toBe(0);
    });

    it('skips entries without handler', () => {
      window.nbt_functions = {
        bad: { description: 'test' } as any,
      };
      const p = makeProvider();
      expect(p.getRegisteredNames().size).toBe(0);
    });

    it('skips entries with non-function handler', () => {
      window.nbt_functions = {
        bad: { description: 'test', handler: 'not a function' } as any,
      };
      const p = makeProvider();
      expect(p.getRegisteredNames().size).toBe(0);
    });

    it('skips non-object entries', () => {
      window.nbt_functions = {
        bad: 'string' as any,
      };
      const p = makeProvider();
      expect(p.getRegisteredNames().size).toBe(0);
    });

    it('logs warnings in debug mode for invalid entries', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      window.nbt_functions = {
        noDesc: { handler: () => 'x' } as any,
        noHandler: { description: 'test' } as any,
      };
      makeProvider(true);
      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });
  });

  describe('parameter conversion', () => {
    it('converts flat parameters to ToolDeclaration format', () => {
      window.nbt_functions = {
        search: {
          description: 'Search items',
          parameters: {
            query: { type: 'string', description: 'Search query', required: true },
            limit: { type: 'integer', description: 'Max results' },
          },
          handler: () => [],
        },
      };
      const p = makeProvider();
      const tools = p.getToolDeclarations();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('search');
      expect(tools[0].parameters.type).toBe('OBJECT');
      expect(tools[0].parameters.properties.query.type).toBe('STRING');
      expect(tools[0].parameters.properties.limit.type).toBe('INTEGER');
      expect(tools[0].parameters.required).toEqual(['query']);
    });

    it('uppercases type values', () => {
      window.nbt_functions = {
        test: {
          description: 'Test',
          parameters: {
            flag: { type: 'boolean', description: 'A flag' },
            count: { type: 'number', description: 'Count' },
          },
          handler: () => null,
        },
      };
      const p = makeProvider();
      const tools = p.getToolDeclarations();
      expect(tools[0].parameters.properties.flag.type).toBe('BOOLEAN');
      expect(tools[0].parameters.properties.count.type).toBe('NUMBER');
    });

    it('handles missing parameters', () => {
      window.nbt_functions = {
        noParams: {
          description: 'No params function',
          handler: () => 'done',
        },
      };
      const p = makeProvider();
      const tools = p.getToolDeclarations();
      expect(tools[0].parameters.properties).toEqual({});
      expect(tools[0].parameters.required).toBeUndefined();
    });

    it('passes enum values through', () => {
      window.nbt_functions = {
        setPriority: {
          description: 'Set priority',
          parameters: {
            level: { type: 'string', description: 'Priority level', enum: ['low', 'medium', 'high'] },
          },
          handler: () => null,
        },
      };
      const p = makeProvider();
      const tools = p.getToolDeclarations();
      expect(tools[0].parameters.properties.level.enum).toEqual(['low', 'medium', 'high']);
    });

    it('omits required array when no params are required', () => {
      window.nbt_functions = {
        test: {
          description: 'Test',
          parameters: {
            opt: { type: 'string', description: 'Optional' },
          },
          handler: () => null,
        },
      };
      const p = makeProvider();
      const tools = p.getToolDeclarations();
      expect(tools[0].parameters.required).toBeUndefined();
    });
  });

  describe('sync()', () => {
    it('detects added functions', () => {
      const p = makeProvider();
      onChange.mockClear();

      window.nbt_functions = {
        newFunc: { description: 'New', handler: () => 'ok' },
      };
      const changed = p.sync();
      expect(changed).toBe(true);
      expect(onChange).toHaveBeenCalledWith(['newFunc'], []);
      expect(p.getRegisteredNames()).toEqual(new Set(['newFunc']));
    });

    it('detects removed functions', () => {
      window.nbt_functions = {
        a: { description: 'A', handler: () => 1 },
        b: { description: 'B', handler: () => 2 },
      };
      const p = makeProvider();
      onChange.mockClear();

      window.nbt_functions = {
        a: { description: 'A', handler: () => 1 },
      };
      const changed = p.sync();
      expect(changed).toBe(true);
      expect(onChange).toHaveBeenCalledWith([], ['b']);
    });

    it('detects both added and removed', () => {
      window.nbt_functions = {
        old: { description: 'Old', handler: () => 1 },
      };
      const p = makeProvider();
      onChange.mockClear();

      window.nbt_functions = {
        fresh: { description: 'Fresh', handler: () => 2 },
      };
      const changed = p.sync();
      expect(changed).toBe(true);
      expect(onChange).toHaveBeenCalledWith(['fresh'], ['old']);
    });

    it('returns false and does not call onChange when nothing changed', () => {
      window.nbt_functions = {
        stable: { description: 'Stable', handler: () => 'ok' },
      };
      const p = makeProvider();
      onChange.mockClear();

      const changed = p.sync();
      expect(changed).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('clears all when window.nbt_functions is set to undefined', () => {
      window.nbt_functions = {
        func: { description: 'Func', handler: () => 'x' },
      };
      const p = makeProvider();
      onChange.mockClear();

      delete window.nbt_functions;
      const changed = p.sync();
      expect(changed).toBe(true);
      expect(onChange).toHaveBeenCalledWith([], ['func']);
      expect(p.getRegisteredNames().size).toBe(0);
    });

    it('detects description changes and updates tool declarations', () => {
      window.nbt_functions = {
        func: { description: 'Version 1', handler: () => 'x' },
      };
      const p = makeProvider();

      window.nbt_functions = {
        func: { description: 'Version 2', handler: () => 'x' },
      };
      const changed = p.sync();
      expect(changed).toBe(true);
      // Description change is detected via fingerprint, but same name
      // stays in the set — tool declarations are rebuilt with new description
      const tools = p.getToolDeclarations();
      expect(tools[0].description).toBe('Version 2');
    });
  });

  describe('handler wrapping', () => {
    it('wraps return value as JSON string', async () => {
      window.nbt_functions = {
        test: {
          description: 'Test',
          handler: () => ({ data: 42 }),
        },
      };
      const p = makeProvider();
      const actions = p.getActions();
      const result = await actions.test.handler({});
      expect(result).toBe(JSON.stringify({ data: 42 }));
    });

    it('returns string results as-is', async () => {
      window.nbt_functions = {
        test: {
          description: 'Test',
          handler: () => 'plain string',
        },
      };
      const p = makeProvider();
      const actions = p.getActions();
      const result = await actions.test.handler({});
      expect(result).toBe('plain string');
    });

    it('returns { success: true } for null/undefined results', async () => {
      window.nbt_functions = {
        test: {
          description: 'Test',
          handler: () => undefined,
        },
      };
      const p = makeProvider();
      const actions = p.getActions();
      const result = await actions.test.handler({});
      expect(result).toBe(JSON.stringify({ success: true }));
    });

    it('catches errors and returns error JSON', async () => {
      window.nbt_functions = {
        failing: {
          description: 'Fails',
          handler: () => { throw new Error('boom'); },
        },
      };
      const p = makeProvider();
      const actions = p.getActions();
      const result = await actions.failing.handler({});
      expect(result).toBe(JSON.stringify({ error: 'boom' }));
    });

    it('handles async handlers', async () => {
      window.nbt_functions = {
        async: {
          description: 'Async',
          handler: async () => ({ async: true }),
        },
      };
      const p = makeProvider();
      const actions = p.getActions();
      const result = await actions.async.handler({});
      expect(result).toBe(JSON.stringify({ async: true }));
    });

    it('passes args to handler', async () => {
      const handlerSpy = vi.fn().mockReturnValue('ok');
      window.nbt_functions = {
        test: {
          description: 'Test',
          handler: handlerSpy,
        },
      };
      const p = makeProvider();
      const actions = p.getActions();
      await actions.test.handler({ key: 'value' });
      expect(handlerSpy).toHaveBeenCalledWith({ key: 'value' });
    });
  });

  describe('custom event listener', () => {
    it('triggers sync on voxglide:functions-changed event', () => {
      makeProvider();
      onChange.mockClear();

      window.nbt_functions = {
        dynamic: { description: 'Dynamic', handler: () => 'ok' },
      };
      window.dispatchEvent(new CustomEvent('voxglide:functions-changed'));

      expect(onChange).toHaveBeenCalledWith(['dynamic'], []);
    });
  });

  describe('destroy()', () => {
    it('cleans up interval', () => {
      const p = makeProvider();
      const clearSpy = vi.spyOn(global, 'clearInterval');
      p.destroy();
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });

    it('removes event listener', () => {
      const p = makeProvider();
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      p.destroy();
      expect(removeSpy).toHaveBeenCalledWith('voxglide:functions-changed', expect.any(Function));
      removeSpy.mockRestore();
    });

    it('stops responding to events after destroy', () => {
      const p = makeProvider();
      p.destroy();
      onChange.mockClear();

      window.nbt_functions = {
        late: { description: 'Late', handler: () => 'x' },
      };
      window.dispatchEvent(new CustomEvent('voxglide:functions-changed'));
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('getToolDeclarations()', () => {
    it('returns correct array of tool declarations', () => {
      window.nbt_functions = {
        a: { description: 'A', handler: () => 1 },
        b: { description: 'B', parameters: { x: { type: 'string', description: 'X', required: true } }, handler: () => 2 },
      };
      const p = makeProvider();
      const tools = p.getToolDeclarations();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual(['a', 'b']);
    });

    it('returns a copy (not the internal array)', () => {
      window.nbt_functions = {
        a: { description: 'A', handler: () => 1 },
      };
      const prov = makeProvider();
      const t1 = prov.getToolDeclarations();
      const t2 = prov.getToolDeclarations();
      expect(t1).not.toBe(t2);
    });
  });

  describe('getRegisteredNames()', () => {
    it('returns current set of names', () => {
      window.nbt_functions = {
        x: { description: 'X', handler: () => 1 },
        y: { description: 'Y', handler: () => 2 },
      };
      const p = makeProvider();
      expect(p.getRegisteredNames()).toEqual(new Set(['x', 'y']));
    });

    it('returns a copy (not the internal set)', () => {
      window.nbt_functions = {
        x: { description: 'X', handler: () => 1 },
      };
      const prov = makeProvider();
      const s1 = prov.getRegisteredNames();
      const s2 = prov.getRegisteredNames();
      expect(s1).not.toBe(s2);
    });
  });
});

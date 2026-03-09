import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionRouter } from '../../src/actions/ActionRouter';

// Mock the NavigationHandler so ActionRouter can construct without real DOM/sessionStorage
vi.mock('../../src/actions/NavigationHandler', () => {
  return {
    NavigationHandler: class MockNavigationHandler {
      navigateTo = vi.fn().mockResolvedValue({ result: JSON.stringify({ success: true }) });
    },
  };
});

const mockConfig = { serverUrl: 'ws://localhost:3100' } as any;

describe('ActionRouter', () => {
  let router: ActionRouter;

  beforeEach(() => {
    router = new ActionRouter(mockConfig);
  });

  describe('constructor', () => {
    it('registers built-in handler: fillField', async () => {
      document.body.innerHTML = '<input id="f" type="text" />';
      const result = await router.route({ id: '1', name: 'fillField', args: { fieldId: 'f', value: 'v' } });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
    });

    it('registers built-in handler: clickElement', async () => {
      document.body.innerHTML = '<button>Go</button>';
      const result = await router.route({ id: '2', name: 'clickElement', args: { description: 'Go' } });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
    });

    it('registers built-in handler: readContent', async () => {
      document.body.innerHTML = '<main>Hello</main>';
      const result = await router.route({ id: '3', name: 'readContent', args: {} });
      const parsed = JSON.parse(result.result);
      expect(parsed.content).toBe('Hello');
    });

    it('registers built-in handler: navigateTo', async () => {
      const result = await router.route({ id: '4', name: 'navigateTo', args: { url: '/page' } });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
    });
  });

  describe('route()', () => {
    it('dispatches to correct handler', async () => {
      const handler = vi.fn().mockResolvedValue({ result: '{"ok":true}' });
      router.registerHandler('myAction', handler);

      const fc = { id: '10', name: 'myAction', args: { foo: 'bar' } };
      const result = await router.route(fc);

      expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
      expect(JSON.parse(result.result)).toEqual({ ok: true });
    });

    it('returns error for unknown action', async () => {
      const result = await router.route({ id: '11', name: 'doesNotExist', args: {} });
      const parsed = JSON.parse(result.result);
      expect(parsed.error).toContain('Unknown action');
      expect(parsed.error).toContain('doesNotExist');
    });
  });

  describe('registerHandler()', () => {
    it('adds new handler that can be routed to', async () => {
      const handler = vi.fn().mockResolvedValue({ result: '{"added":true}' });
      router.registerHandler('custom', handler);

      const result = await router.route({ id: '20', name: 'custom', args: { x: 1 } });
      expect(handler).toHaveBeenCalledWith({ x: 1 });
      expect(JSON.parse(result.result)).toEqual({ added: true });
    });

    it('overwrites existing handler with same name', async () => {
      const handler1 = vi.fn().mockResolvedValue({ result: '"first"' });
      const handler2 = vi.fn().mockResolvedValue({ result: '"second"' });
      router.registerHandler('dup', handler1);
      router.registerHandler('dup', handler2);

      await router.route({ id: '21', name: 'dup', args: {} });
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('removeHandler()', () => {
    it('removes handler so route returns unknown action error', async () => {
      const handler = vi.fn().mockResolvedValue({ result: '{}' });
      router.registerHandler('temp', handler);

      // Verify it works before removal
      const before = await router.route({ id: '30', name: 'temp', args: {} });
      expect(JSON.parse(before.result)).toEqual({});

      router.removeHandler('temp');

      const after = await router.route({ id: '31', name: 'temp', args: {} });
      const parsed = JSON.parse(after.result);
      expect(parsed.error).toContain('Unknown action');
    });

    it('does not throw when removing a handler that does not exist', () => {
      expect(() => router.removeHandler('nope')).not.toThrow();
    });
  });

  describe('registerCustomActions()', () => {
    it('registers handlers from config object', async () => {
      const handler = vi.fn().mockResolvedValue({ greeting: 'hello' });
      router.registerCustomActions({
        greet: {
          declaration: { name: 'greet', description: 'Say hi', parameters: { type: 'object', properties: {} } },
          handler,
        },
      });

      const result = await router.route({ id: '40', name: 'greet', args: { name: 'Alice' } });
      expect(handler).toHaveBeenCalledWith({ name: 'Alice' });
      const parsed = JSON.parse(result.result);
      expect(parsed).toEqual({ greeting: 'hello' });
    });

    it('wraps string return value in { result: ... }', async () => {
      router.registerCustomActions({
        echo: {
          declaration: { name: 'echo', description: 'Echo', parameters: { type: 'object', properties: {} } },
          handler: async (args) => `echoed: ${args.msg}`,
        },
      });

      // The custom action wrapper returns { result: <string> } where the string is whatever the handler returns
      const result = await router.route({ id: '41', name: 'echo', args: { msg: 'hi' } });
      // Handler returned a string, so it should be passed through as-is
      expect(result.result).toBe('echoed: hi');
    });

    it('wraps object return value in { result: JSON.stringify(...) }', async () => {
      router.registerCustomActions({
        data: {
          declaration: { name: 'data', description: 'Data', parameters: { type: 'object', properties: {} } },
          handler: async () => ({ count: 42 }),
        },
      });

      const result = await router.route({ id: '42', name: 'data', args: {} });
      expect(JSON.parse(result.result)).toEqual({ count: 42 });
    });

    it('wraps null/undefined return in { result: JSON.stringify({ success: true }) }', async () => {
      router.registerCustomActions({
        noop: {
          declaration: { name: 'noop', description: 'Noop', parameters: { type: 'object', properties: {} } },
          handler: async () => undefined,
        },
      });

      const result = await router.route({ id: '43', name: 'noop', args: {} });
      expect(JSON.parse(result.result)).toEqual({ success: true });
    });

    it('registers multiple custom actions at once', async () => {
      router.registerCustomActions({
        actionA: {
          declaration: { name: 'actionA', description: 'A', parameters: { type: 'object', properties: {} } },
          handler: async () => 'a',
        },
        actionB: {
          declaration: { name: 'actionB', description: 'B', parameters: { type: 'object', properties: {} } },
          handler: async () => 'b',
        },
      });

      const resultA = await router.route({ id: '44', name: 'actionA', args: {} });
      const resultB = await router.route({ id: '45', name: 'actionB', args: {} });
      expect(resultA.result).toBe('a');
      expect(resultB.result).toBe('b');
    });
  });

  describe('error handling', () => {
    it('catches handler errors and returns them as error result', async () => {
      router.registerHandler('fail', async () => {
        throw new Error('Something went wrong');
      });

      const result = await router.route({ id: '50', name: 'fail', args: {} });
      const parsed = JSON.parse(result.result);
      expect(parsed.error).toBe('Something went wrong');
    });

    it('catches synchronous handler throws', async () => {
      router.registerHandler('syncFail', (() => {
        throw new Error('Sync boom');
      }) as any);

      const result = await router.route({ id: '51', name: 'syncFail', args: {} });
      const parsed = JSON.parse(result.result);
      expect(parsed.error).toBe('Sync boom');
    });
  });
});

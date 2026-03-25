import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FunctionLoader } from '../../src/actions/FunctionLoader';

/** Helper to create a mock Response with proper headers */
function mockResponse(opts: { ok: boolean; status?: number; text?: string; contentType?: string }) {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    text: () => Promise.resolve(opts.text ?? ''),
    headers: { get: (name: string) => name === 'content-type' ? (opts.contentType ?? 'application/javascript') : null },
  };
}

describe('FunctionLoader', () => {
  let loader: FunctionLoader;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete window.nbt_functions;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Stub AbortController
    vi.stubGlobal('AbortController', class {
      signal = { aborted: false };
      abort() { (this.signal as any).aborted = true; }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.nbt_functions;
  });

  describe('constructor', () => {
    it('derives HTTP URL from ws:// serverUrl', async () => {
      loader = new FunctionLoader('ws://localhost:3100');
      fetchMock.mockResolvedValue(mockResponse({ ok: true }));
      await loader.load();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:3100/api/functions'),
        expect.objectContaining({ headers: expect.objectContaining({ 'ngrok-skip-browser-warning': '1' }) }),
      );
    });

    it('derives HTTP URL from wss:// serverUrl', async () => {
      loader = new FunctionLoader('wss://example.com/ws');
      fetchMock.mockResolvedValue(mockResponse({ ok: true }));
      await loader.load();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('https://example.com/ws/api/functions'),
        expect.any(Object),
      );
    });
  });

  describe('load()', () => {
    it('fetches bundle with current page URL and ngrok header', async () => {
      loader = new FunctionLoader('ws://localhost:3100');
      fetchMock.mockResolvedValue(mockResponse({ ok: true }));

      await loader.load();

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain('url=%2F');
      expect(url).toContain('bundle=true');
      expect(opts.headers['ngrok-skip-browser-warning']).toBe('1');
    });

    it('evaluates returned code and registers functions', async () => {
      loader = new FunctionLoader('ws://localhost:3100');
      const code = `
        window.nbt_functions = window.nbt_functions || {};
        window.nbt_functions.testTool = {
          description: 'A test tool',
          parameters: {},
          handler: async function() { return { success: true }; }
        };
      `;
      fetchMock.mockResolvedValue(mockResponse({ ok: true, text: code }));

      const added = await loader.load();

      expect(window.nbt_functions).toBeDefined();
      expect(window.nbt_functions!.testTool).toBeDefined();
      expect(window.nbt_functions!.testTool.description).toBe('A test tool');
      expect(added).toContain('testTool');
    });

    it('returns empty array on fetch error', async () => {
      loader = new FunctionLoader('ws://localhost:3100');
      fetchMock.mockRejectedValue(new Error('Network error'));

      const added = await loader.load();
      expect(added).toEqual([]);
    });

    it('returns empty array on non-ok response', async () => {
      loader = new FunctionLoader('ws://localhost:3100');
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 500 }));

      const added = await loader.load();
      expect(added).toEqual([]);
    });

    it('rejects HTML responses (ngrok interstitial)', async () => {
      loader = new FunctionLoader('ws://localhost:3100');
      fetchMock.mockResolvedValue(mockResponse({
        ok: true,
        text: '<html>ngrok interstitial</html>',
        contentType: 'text/html',
      }));

      const added = await loader.load();
      expect(added).toEqual([]);
      expect(loader.isLoaded()).toBe(false);
    });

    it('sets isLoaded to true after successful load', async () => {
      loader = new FunctionLoader('ws://localhost:3100');
      fetchMock.mockResolvedValue(mockResponse({
        ok: true,
        text: 'window.nbt_functions = window.nbt_functions || {};',
      }));

      expect(loader.isLoaded()).toBe(false);
      await loader.load();
      expect(loader.isLoaded()).toBe(true);
    });

    it('deduplicates concurrent calls for the same path', async () => {
      loader = new FunctionLoader('ws://localhost:3100');
      fetchMock.mockResolvedValue(mockResponse({ ok: true }));

      const p1 = loader.load();
      const p2 = loader.load();

      expect(p1).toBe(p2); // Same promise reference
      await p1;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('reload()', () => {
    it('skips re-fetch if pathname has not changed', async () => {
      loader = new FunctionLoader('ws://localhost:3100');
      fetchMock.mockResolvedValue(mockResponse({ ok: true }));

      await loader.load(); // first load for "/"
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await loader.reload(); // same path "/" — should skip
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('ownership tracking', () => {
    it('removes stale functions when navigating to a page with fewer matches', async () => {
      loader = new FunctionLoader('ws://localhost:3100');

      // First load: two functions
      fetchMock.mockResolvedValueOnce(mockResponse({
        ok: true,
        text: `
          window.nbt_functions = window.nbt_functions || {};
          window.nbt_functions.global1 = { description: 'G1', handler: () => {} };
          window.nbt_functions.pageSpecific = { description: 'PS', handler: () => {} };
        `,
      }));
      await loader.load();
      expect(Object.keys(window.nbt_functions!)).toContain('pageSpecific');

      // Simulate navigation to a different path (force lastLoadedPath mismatch)
      (loader as any).lastLoadedPath = '/old-path';

      // Second load: only global
      fetchMock.mockResolvedValueOnce(mockResponse({
        ok: true,
        text: `
          window.nbt_functions = window.nbt_functions || {};
          window.nbt_functions.global1 = { description: 'G1', handler: () => {} };
        `,
      }));
      await loader.load();

      expect(Object.keys(window.nbt_functions!)).toContain('global1');
      expect(Object.keys(window.nbt_functions!)).not.toContain('pageSpecific');
    });

    it('does not remove functions from other sources', async () => {
      // External source sets a function BEFORE FunctionLoader runs
      window.nbt_functions = {
        external: { description: 'From extension', handler: () => ({}) },
      };

      loader = new FunctionLoader('ws://localhost:3100');

      fetchMock.mockResolvedValueOnce(mockResponse({
        ok: true,
        text: `
          window.nbt_functions = window.nbt_functions || {};
          window.nbt_functions.serverFunc = { description: 'From server', handler: () => {} };
        `,
      }));
      await loader.load();

      expect(window.nbt_functions!.external).toBeDefined();
      expect(window.nbt_functions!.serverFunc).toBeDefined();

      // Navigate — server returns empty bundle
      (loader as any).lastLoadedPath = '/old';
      fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, text: '' }));
      await loader.load();

      // External function survives, server function removed
      expect(window.nbt_functions!.external).toBeDefined();
      expect(window.nbt_functions!.serverFunc).toBeUndefined();
    });
  });

  describe('ready()', () => {
    it('resolves immediately if no load is in-flight', async () => {
      loader = new FunctionLoader('ws://localhost:3100');
      await loader.ready(); // should not throw or hang
    });

    it('waits for in-flight load to settle', async () => {
      loader = new FunctionLoader('ws://localhost:3100');
      let resolveResponse!: (v: any) => void;
      fetchMock.mockReturnValue(new Promise(r => { resolveResponse = r; }));

      const loadPromise = loader.load();
      let readyResolved = false;
      loader.ready().then(() => { readyResolved = true; });

      // ready() hasn't resolved yet
      await Promise.resolve();
      expect(readyResolved).toBe(false);

      // Resolve the fetch
      resolveResponse(mockResponse({ ok: true }));
      await loadPromise;

      // Now ready() should resolve
      await loader.ready();
    });
  });
});

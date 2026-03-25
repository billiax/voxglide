import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BuildModeManager } from '../../src/build/BuildModeManager';
import type { BuildModeManagerCallbacks, BuildModeDeps } from '../../src/build/BuildModeManager';
import type { BuildModeConfig } from '../../src/build/types';

// Mock screenshot utility to avoid html2canvas in tests
vi.mock('../../src/utils/screenshot', () => ({
  captureScreenshot: vi.fn().mockResolvedValue(null),
}));

// Helper: create a mock API response
function apiResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    text: () => Promise.resolve(JSON.stringify({
      sessionId: 'test', response: 'ok',
      durationMs: 100, costUsd: 0, workspace: 'w', model: 'm',
      ...overrides,
    })),
  };
}

describe('BuildModeManager', () => {
  let manager: BuildModeManager;
  let callbacks: BuildModeManagerCallbacks;
  let config: BuildModeConfig;
  let deps: BuildModeDeps;

  beforeEach(() => {
    config = {
      apiUrl: 'http://localhost:9999',
      apiKey: 'test-key',
      workspace: 'test-workspace',
    };

    callbacks = {
      onModeChange: vi.fn(),
      onTranscript: vi.fn(),
      onToolsRegistered: vi.fn(),
      onToolSavedToServer: vi.fn(),
      onPendingTool: vi.fn(),
      onToolLoopStatus: vi.fn(),
      onError: vi.fn(),
      onLoadingChange: vi.fn(),
      onDebug: vi.fn(),
    };

    deps = {
      getPageContextProvider: () => null,
    };

    manager = new BuildModeManager(config, callbacks, deps);
    localStorage.clear();
    (window as any).nbt_functions = undefined;

    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    manager.destroy();
    vi.restoreAllMocks();
  });

  describe('mode toggling', () => {
    it('starts inactive', () => {
      expect(manager.isActive()).toBe(false);
    });

    it('activates', () => {
      manager.activate();
      expect(manager.isActive()).toBe(true);
      expect(callbacks.onModeChange).toHaveBeenCalledWith(true, undefined);
    });

    it('deactivates', () => {
      manager.activate();
      manager.deactivate();
      expect(manager.isActive()).toBe(false);
      expect(callbacks.onModeChange).toHaveBeenCalledWith(false);
    });

    it('supports silent activation', () => {
      manager.activate({ silent: true });
      expect(manager.isActive()).toBe(true);
      expect(callbacks.onModeChange).toHaveBeenCalledWith(true, true);
    });

    it('toggles', () => {
      manager.toggle();
      expect(manager.isActive()).toBe(true);
      manager.toggle();
      expect(manager.isActive()).toBe(false);
    });

    it('does not double-activate', () => {
      manager.activate();
      manager.activate();
      expect(callbacks.onModeChange).toHaveBeenCalledTimes(1);
    });

    it('does not double-deactivate', () => {
      manager.deactivate();
      expect(callbacks.onModeChange).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('emits user transcript', async () => {
      manager.activate();
      (fetch as any).mockResolvedValueOnce(apiResponse());

      await manager.sendMessage('build something');

      expect(callbacks.onTranscript).toHaveBeenCalledWith('build something', 'user', true);
      expect(callbacks.onLoadingChange).toHaveBeenCalledWith(true);
    });

    it('shows AI response in transcript when no tool calls', async () => {
      manager.activate();
      (fetch as any).mockResolvedValueOnce(apiResponse({ response: 'Here is the tool' }));

      await manager.sendMessage('create a tool');

      expect(callbacks.onTranscript).toHaveBeenCalledWith('Here is the tool', 'ai', true);
    });

    it('skips empty messages', async () => {
      manager.activate();
      await manager.sendMessage('  ');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('includes prompt and structured tools on first message', async () => {
      manager.activate();
      (fetch as any).mockResolvedValueOnce(apiResponse());

      await manager.sendMessage('create a tool');

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.message).toContain('building page actions for a voice AI agent');
      expect(body.message).toContain('USER REQUEST:');
      // Should send browser tools as structured tool definitions
      expect(body.tools).toBeDefined();
      expect(body.tools).toHaveLength(6);
      expect(body.tools.map((t: any) => t.name)).toEqual([
        'page_snapshot', 'take_screenshot', 'evaluate_js', 'get_console_logs', 'get_network_requests', 'register_tool',
      ]);
    });

    it('does not send preamble on subsequent same-URL messages', async () => {
      manager.activate();
      (fetch as any)
        .mockResolvedValue(apiResponse());

      await manager.sendMessage('first');
      await manager.sendMessage('second');

      // Find the second /chat call (skip the PUT /tools call from persistent tool registration)
      const chatCalls = (fetch as any).mock.calls.filter(
        (c: any[]) => c[0].endsWith('/chat'),
      );
      const secondBody = JSON.parse(chatCalls[1][1].body);
      expect(secondBody.message).toBe('second');
    });
  });

  describe('request-based tool handling', () => {
    it('executes requests and sends results back as text', async () => {
      manager.activate();

      (fetch as any)
        .mockResolvedValue(apiResponse({ response: 'Got it!' }))
        .mockResolvedValueOnce(apiResponse({
          response: '',
          requests: [{ name: 'page_snapshot' }],
        }))
        .mockResolvedValueOnce(apiResponse({ response: 'Got it!' }));

      await manager.sendMessage('create a tool');

      const chatCalls = (fetch as any).mock.calls.filter(
        (c: any[]) => c[0].endsWith('/chat'),
      );
      expect(chatCalls).toHaveLength(2);
      const secondBody = JSON.parse(chatCalls[1][1].body);
      expect(secondBody.message).toContain('[REQUEST RESULT: page_snapshot]');
      expect(secondBody.toolResults).toBeUndefined();
      expect(callbacks.onTranscript).toHaveBeenCalledWith('Got it!', 'ai', true);
      expect(callbacks.onToolLoopStatus).toHaveBeenCalledWith('Running page snapshot...');
    });

    it('passes params to tool executor', async () => {
      manager.activate();

      (fetch as any)
        .mockResolvedValue(apiResponse({ response: 'Done!' }))
        .mockResolvedValueOnce(apiResponse({
          requests: [{ name: 'evaluate_js', params: { code: 'document.title' } }],
        }))
        .mockResolvedValueOnce(apiResponse({ response: 'Done!' }));

      await manager.sendMessage('test something');

      const chatCalls = (fetch as any).mock.calls.filter(
        (c: any[]) => c[0].endsWith('/chat'),
      );
      expect(chatCalls).toHaveLength(2);
      const secondBody = JSON.parse(chatCalls[1][1].body);
      expect(secondBody.message).toContain('[REQUEST RESULT: evaluate_js]');
    });

    it('handles multiple requests in one response', async () => {
      manager.activate();

      (fetch as any)
        .mockResolvedValue(apiResponse({ response: 'All done' }))
        .mockResolvedValueOnce(apiResponse({
          requests: [
            { name: 'page_snapshot' },
            { name: 'get_console_logs' },
          ],
        }))
        .mockResolvedValueOnce(apiResponse({ response: 'All done' }));

      await manager.sendMessage('test');

      const chatCalls = (fetch as any).mock.calls.filter(
        (c: any[]) => c[0].endsWith('/chat'),
      );
      expect(chatCalls).toHaveLength(2);
      const secondBody = JSON.parse(chatCalls[1][1].body);
      expect(secondBody.message).toContain('[REQUEST RESULT: page_snapshot]');
      expect(secondBody.message).toContain('[REQUEST RESULT: get_console_logs]');
    });

    it('breaks after max iterations', async () => {
      manager.activate();

      (fetch as any).mockResolvedValue(apiResponse({
        requests: [{ name: 'page_snapshot' }],
      }));

      await manager.sendMessage('infinite loop');

      expect(callbacks.onError).toHaveBeenCalledWith('Tool loop exceeded maximum iterations');
    });

    it('returns error result when toolExecutor is unavailable', async () => {
      manager.activate();

      (fetch as any)
        .mockResolvedValueOnce(apiResponse({
          requests: [{ name: 'evaluate_js', params: { code: 'test' } }],
        }))
        .mockResolvedValueOnce(apiResponse({ response: 'ok' }));

      await manager.sendMessage('test');

      const chatCalls = (fetch as any).mock.calls.filter(
        (c: any[]) => c[0].endsWith('/chat'),
      );
      const secondBody = JSON.parse(chatCalls[1][1].body);
      expect(secondBody.message).toContain('browser tools not available');
    });
  });

  describe('screenshot support', () => {
    it('sends images on first message when screenshot succeeds', async () => {
      const { captureScreenshot } = await import('../../src/utils/screenshot');
      (captureScreenshot as any).mockResolvedValueOnce('base64data');

      manager.activate();
      (fetch as any).mockResolvedValue(apiResponse());

      await manager.sendMessage('create a tool');

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.images).toHaveLength(1);
      expect(body.images[0].data).toBe('base64data');
      expect(body.images[0].media_type).toBe('image/jpeg');
    });

    it('does not send images when screenshot fails', async () => {
      manager.activate();
      (fetch as any).mockResolvedValue(apiResponse());

      await manager.sendMessage('create a tool');

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.images).toBeUndefined();
    });

    it('does not send images on subsequent same-URL messages', async () => {
      manager.activate();
      (fetch as any).mockResolvedValue(apiResponse());

      await manager.sendMessage('first');
      await manager.sendMessage('second');

      const chatCalls = (fetch as any).mock.calls.filter(
        (c: any[]) => c[0].endsWith('/chat'),
      );
      const secondBody = JSON.parse(chatCalls[1][1].body);
      expect(secondBody.images).toBeUndefined();
    });

  });

  describe('tool extraction as pending', () => {
    it('creates pending tools from response code blocks', async () => {
      manager.activate();

      const toolCode = [
        'window.nbt_functions = window.nbt_functions || {};',
        'window.nbt_functions.searchFiles = {',
        '  description: "Search files",',
        '  handler: async (args) => ({ success: true })',
        '};',
      ].join('\n');

      (fetch as any).mockResolvedValueOnce(
        apiResponse({ response: `Here's the tool:\n\`\`\`javascript\n${toolCode}\n\`\`\`` }),
      );

      await manager.sendMessage('create search');

      expect(callbacks.onPendingTool).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'searchFiles', status: 'pending' }),
      );
      expect(callbacks.onToolsRegistered).not.toHaveBeenCalled();
      expect((window as any).nbt_functions?.searchFiles).toBeUndefined();
    });
  });

  describe('accept/reject', () => {
    it('acceptTool registers and persists', async () => {
      manager.activate();

      const toolCode = [
        'window.nbt_functions = window.nbt_functions || {};',
        'window.nbt_functions.myTool = {',
        '  description: "test",',
        '  handler: async () => ({ ok: true })',
        '};',
      ].join('\n');

      (fetch as any).mockResolvedValueOnce(
        apiResponse({ response: `\`\`\`javascript\n${toolCode}\n\`\`\`` }),
      );

      await manager.sendMessage('create tool');
      manager.acceptTool('myTool');

      expect((window as any).nbt_functions.myTool).toBeDefined();
      expect(callbacks.onToolsRegistered).toHaveBeenCalledWith(['myTool']);
    });

    it('rejectTool marks as rejected without registering', async () => {
      manager.activate();

      const toolCode = 'window.nbt_functions = window.nbt_functions || {};\nwindow.nbt_functions.badTool = { description: "x", handler: () => {} };';
      (fetch as any).mockResolvedValueOnce(
        apiResponse({ response: `\`\`\`javascript\n${toolCode}\n\`\`\`` }),
      );

      await manager.sendMessage('create tool');
      manager.rejectTool('badTool');

      expect((window as any).nbt_functions?.badTool).toBeUndefined();
      expect(callbacks.onToolsRegistered).not.toHaveBeenCalled();
    });
  });

  describe('newSession', () => {
    it('clears pending tools', async () => {
      manager.activate();

      const toolCode = 'window.nbt_functions = window.nbt_functions || {};\nwindow.nbt_functions.x = { description: "x", handler: () => {} };';
      (fetch as any).mockResolvedValueOnce(
        apiResponse({ response: `\`\`\`javascript\n${toolCode}\n\`\`\`` }),
      );

      await manager.sendMessage('create');
      expect(manager.getPendingTools()).toHaveLength(1);

      manager.newSession();
      expect(manager.getPendingTools()).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('persists active state to localStorage on activate', () => {
      manager.activate();
      expect(localStorage.getItem('vsdk-build-mode-active')).toBe('true');
    });

    it('clears localStorage on deactivate', () => {
      manager.activate();
      manager.deactivate();
      expect(localStorage.getItem('vsdk-build-mode-active')).toBeNull();
    });

    it('isPersistedActive returns true when persisted', () => {
      localStorage.setItem('vsdk-build-mode-active', 'true');
      expect(BuildModeManager.isPersistedActive()).toBe(true);
    });

    it('isPersistedActive returns false when not persisted', () => {
      expect(BuildModeManager.isPersistedActive()).toBe(false);
    });

    it('does not clear localStorage on destroy', () => {
      manager.activate();
      manager.destroy();
      expect(localStorage.getItem('vsdk-build-mode-active')).toBe('true');
    });
  });

  describe('destroy', () => {
    it('deactivates and cleans up', () => {
      manager.activate();
      manager.destroy();
      expect(manager.isActive()).toBe(false);
    });
  });

  describe('match pattern extraction', () => {
    it('extracts global match from code', async () => {
      manager.destroy();
      manager = new BuildModeManager({ ...config, serverUrl: 'http://localhost:3100' }, callbacks, deps);
      manager.activate();

      const toolCode = [
        'window.nbt_functions = window.nbt_functions || {};',
        'window.nbt_functions.search = {',
        '  description: "Search",',
        '  match: "*",',
        '  handler: async () => ({ ok: true })',
        '};',
      ].join('\n');

      (fetch as any).mockResolvedValue(apiResponse({ response: `\`\`\`javascript\n${toolCode}\n\`\`\`` }));
      await manager.sendMessage('create');
      manager.acceptTool('search');

      const saveCalls = (fetch as any).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/api/functions'),
      );
      expect(saveCalls).toHaveLength(1);
      expect(JSON.parse(saveCalls[0][1].body).match).toBe('*');
    });

    it('extracts path-specific match from code', async () => {
      manager.destroy();
      manager = new BuildModeManager({ ...config, serverUrl: 'http://localhost:3100' }, callbacks, deps);
      manager.activate();

      const toolCode = [
        'window.nbt_functions = window.nbt_functions || {};',
        'window.nbt_functions.editDoc = {',
        '  description: "Edit",',
        '  match: "/tools/files/viewer*",',
        '  handler: async () => ({ ok: true })',
        '};',
      ].join('\n');

      (fetch as any).mockResolvedValue(apiResponse({ response: `\`\`\`javascript\n${toolCode}\n\`\`\`` }));
      await manager.sendMessage('create');
      manager.acceptTool('editDoc');

      const saveCalls = (fetch as any).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/api/functions'),
      );
      expect(JSON.parse(saveCalls[0][1].body).match).toBe('/tools/files/viewer*');
    });

    it('defaults match to "*" when code has no match field', async () => {
      manager.destroy();
      manager = new BuildModeManager({ ...config, serverUrl: 'http://localhost:3100' }, callbacks, deps);
      manager.activate();

      const toolCode = [
        'window.nbt_functions = window.nbt_functions || {};',
        'window.nbt_functions.myTool = {',
        '  description: "test",',
        '  handler: async () => ({ ok: true })',
        '};',
      ].join('\n');

      (fetch as any).mockResolvedValue(apiResponse({ response: `\`\`\`javascript\n${toolCode}\n\`\`\`` }));
      await manager.sendMessage('create');
      manager.acceptTool('myTool');

      const saveCalls = (fetch as any).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/api/functions'),
      );
      expect(JSON.parse(saveCalls[0][1].body).match).toBe('*');
    });
  });

  describe('CONTEXT_PREAMBLE content', () => {
    it('includes prompt from build-mode-prompt.md', async () => {
      manager.activate();
      (fetch as any).mockResolvedValue(apiResponse());

      await manager.sendMessage('create a tool');

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.message).toContain('building page actions for a voice AI agent');
      expect(body.message).toContain('Delivering the final page action');
    });
  });
});

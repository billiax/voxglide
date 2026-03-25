import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BuildModeSession } from '../../src/build/BuildModeSession';
import type { BuildModeCallbacks } from '../../src/build/BuildModeSession';
import type { BuildModeConfig } from '../../src/build/types';

describe('BuildModeSession', () => {
  let session: BuildModeSession;
  let callbacks: BuildModeCallbacks;
  let config: BuildModeConfig;

  beforeEach(() => {
    config = {
      apiUrl: 'http://localhost:9999',
      apiKey: 'test-key',
      workspace: 'test-workspace',
    };

    callbacks = {
      onStateChange: vi.fn(),
      onError: vi.fn(),
      onDebug: vi.fn(),
    };

    vi.stubGlobal('fetch', vi.fn());
    session = new BuildModeSession(config, callbacks);
  });

  afterEach(() => {
    session.destroy();
    vi.restoreAllMocks();
  });

  it('starts with null sessionId', () => {
    expect(session.getSessionId()).toBeNull();
  });

  it('returns parsed response and stores sessionId', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        sessionId: 'sess-1', response: 'hello', turnComplete: true,
        durationMs: 100, costUsd: 0.01, workspace: 'w', model: 'm',
      })),
    });

    const response = await session.sendMessage('test message');
    expect(response.sessionId).toBe('sess-1');
    expect(response.response).toBe('hello');
    expect(response.turnComplete).toBe(true);
    expect(session.getSessionId()).toBe('sess-1');
  });

  it('includes sessionId on subsequent requests', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        sessionId: 'sess-1', response: 'ok', turnComplete: true,
        durationMs: 100, costUsd: 0, workspace: 'w', model: 'm',
      })),
    });

    await session.sendMessage('first');
    await session.sendMessage('second');

    const secondBody = JSON.parse((fetch as any).mock.calls[1][1].body);
    expect(secondBody.sessionId).toBe('sess-1');
  });

  it('sends tools when provided', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        sessionId: 'sess-1', response: 'ok', turnComplete: true,
        durationMs: 100, costUsd: 0, workspace: 'w', model: 'm',
      })),
    });

    const tools = [{ name: 'test_tool', description: 'desc', parameters: { arg: { type: 'string', description: 'test arg', required: true } } }];
    await session.sendMessage('hello', { tools });

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.tools).toEqual(tools);
  });

  it('returns requests from API response', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        sessionId: 'sess-1', response: '',
        requests: [{ name: 'page_snapshot' }],
        durationMs: 100, costUsd: 0, workspace: 'w', model: 'm',
      })),
    });

    const response = await session.sendMessage('test');
    expect(response.requests).toHaveLength(1);
    expect(response.requests![0].name).toBe('page_snapshot');
  });

  it('returns null requests when no tool use', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        sessionId: 'sess-1', response: 'ok', requests: null,
        durationMs: 100, costUsd: 0, workspace: 'w', model: 'm',
      })),
    });

    const response = await session.sendMessage('test');
    expect(response.requests).toBeNull();
  });

  it('throws on network error', async () => {
    (fetch as any).mockRejectedValueOnce(new Error('Network failure'));
    await expect(session.sendMessage('test')).rejects.toThrow('Network failure');
  });

  it('throws on HTTP error', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false, status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });
    await expect(session.sendMessage('test')).rejects.toThrow('Claude Code API error 500');
  });

  it('throws when request already in flight', async () => {
    let resolveFirst: any;
    (fetch as any).mockReturnValueOnce(new Promise(r => { resolveFirst = r; }));

    const first = session.sendMessage('first');
    await expect(session.sendMessage('second')).rejects.toThrow('already in flight');

    resolveFirst({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        sessionId: 'sess-1', response: 'ok', turnComplete: true,
        durationMs: 100, costUsd: 0, workspace: 'w', model: 'm',
      })),
    });
    await first;
  });

  it('resetSession clears sessionId', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        sessionId: 'sess-1', response: 'ok', turnComplete: true,
        durationMs: 100, costUsd: 0, workspace: 'w', model: 'm',
      })),
    });

    await session.sendMessage('test');
    expect(session.getSessionId()).toBe('sess-1');
    session.resetSession();
    expect(session.getSessionId()).toBeNull();
  });

  it('uses default model sonnet when not specified', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        sessionId: 'test', response: 'ok', turnComplete: true,
        durationMs: 100, costUsd: 0, workspace: 'w', model: 'm',
      })),
    });

    await session.sendMessage('test');
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.model).toBe('sonnet');
  });

  it('sends images when provided', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        sessionId: 'sess-1', response: 'ok', turnComplete: true,
        durationMs: 100, costUsd: 0, workspace: 'w', model: 'm',
      })),
    });

    await session.sendMessage('describe this page', {
      images: [{ data: 'abc123base64', media_type: 'image/jpeg' }],
    });

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.images).toHaveLength(1);
    expect(body.images[0].data).toBe('abc123base64');
    expect(body.images[0].media_type).toBe('image/jpeg');
  });

  it('does not include images when not provided', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        sessionId: 'sess-1', response: 'ok', turnComplete: true,
        durationMs: 100, costUsd: 0, workspace: 'w', model: 'm',
      })),
    });

    await session.sendMessage('hello');

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.images).toBeUndefined();
  });

  it('registers persistent tools via PUT', async () => {
    // First establish a session
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        sessionId: 'sess-1', response: 'ok', turnComplete: true,
        durationMs: 100, costUsd: 0, workspace: 'w', model: 'm',
      })),
    });
    await session.sendMessage('init');

    // Register persistent tools
    (fetch as any).mockResolvedValueOnce({
      ok: true, status: 200,
      text: () => Promise.resolve('ok'),
    });
    await session.registerPersistentTools([{ name: 'snap', description: 'snapshot' }]);

    const lastCall = (fetch as any).mock.calls.at(-1);
    expect(lastCall[0]).toContain('/sessions/sess-1/tools');
    const lastOpts = lastCall[1];
    expect(lastOpts.method).toBe('PUT');
    const body = JSON.parse(lastOpts.body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('snap');
  });

  it('registerPersistentTools is a no-op without sessionId', async () => {
    await session.registerPersistentTools([{ name: 'snap', description: 'snapshot' }]);
    // Should not have made any fetch calls
    expect(fetch).not.toHaveBeenCalled();
  });
});

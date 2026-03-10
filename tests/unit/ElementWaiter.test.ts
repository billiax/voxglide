import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForElement } from '../../src/actions/ElementWaiter';

describe('ElementWaiter', () => {
  let observerInstances: Array<{
    callback: MutationCallback;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    document.body.innerHTML = '';
    observerInstances = [];

    (globalThis as any).MutationObserver = class {
      callback: MutationCallback;
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      constructor(callback: MutationCallback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        observerInstances.push(this as any);
      }
      takeRecords() { return []; }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns element immediately if already present', async () => {
    document.body.innerHTML = '<button id="btn">Click</button>';

    const el = await waitForElement(() => document.getElementById('btn') as HTMLElement | null);
    expect(el).not.toBeNull();
    expect(el!.id).toBe('btn');
    // Should not have created a MutationObserver since element was found immediately
    expect(observerInstances).toHaveLength(0);
  });

  it('returns element when it appears after delay', async () => {
    const promise = waitForElement(
      () => document.getElementById('delayed') as HTMLElement | null,
      5000,
    );

    // Simulate element appearing later via observer
    setTimeout(() => {
      document.body.innerHTML = '<div id="delayed">Hello</div>';
      // Trigger the observer callback
      if (observerInstances[0]) {
        observerInstances[0].callback(
          [{ type: 'childList' }] as unknown as MutationRecord[],
          {} as MutationObserver,
        );
      }
    }, 50);

    const el = await promise;
    expect(el).not.toBeNull();
    expect(el!.id).toBe('delayed');
  });

  it('returns null on timeout', async () => {
    const el = await waitForElement(
      () => document.getElementById('never') as HTMLElement | null,
      100,
    );
    expect(el).toBeNull();
  });

  it('disconnects observer after finding element', async () => {
    const promise = waitForElement(
      () => document.getElementById('found') as HTMLElement | null,
      5000,
    );

    setTimeout(() => {
      document.body.innerHTML = '<span id="found">Yes</span>';
      if (observerInstances[0]) {
        observerInstances[0].callback(
          [{ type: 'childList' }] as unknown as MutationRecord[],
          {} as MutationObserver,
        );
      }
    }, 50);

    await promise;
    expect(observerInstances[0].disconnect).toHaveBeenCalled();
  });

  it('disconnects observer on timeout', async () => {
    await waitForElement(
      () => document.getElementById('never') as HTMLElement | null,
      100,
    );
    expect(observerInstances[0].disconnect).toHaveBeenCalled();
  });
});

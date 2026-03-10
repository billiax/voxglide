import { describe, it, expect } from 'vitest';

/**
 * Standalone test of the async serial queue pattern used on the server.
 * This tests the queue logic in isolation without importing server code.
 */

interface QueueHolder {
  queue: Array<() => Promise<void>>;
  processing: boolean;
}

function enqueueTurn(holder: QueueHolder, fn: () => Promise<void>): void {
  holder.queue.push(fn);
  if (!holder.processing) {
    processTurnQueue(holder);
  }
}

async function processTurnQueue(holder: QueueHolder): Promise<void> {
  holder.processing = true;
  while (holder.queue.length > 0) {
    const fn = holder.queue.shift()!;
    try {
      await fn();
    } catch {
      // swallow errors, continue processing
    }
  }
  holder.processing = false;
}

describe('TurnQueue', () => {
  it('executes items in serial order', async () => {
    const order: number[] = [];
    const holder: QueueHolder = { queue: [], processing: false };

    const done = new Promise<void>((resolve) => {
      enqueueTurn(holder, async () => {
        await delay(10);
        order.push(1);
      });
      enqueueTurn(holder, async () => {
        await delay(5);
        order.push(2);
      });
      enqueueTurn(holder, async () => {
        order.push(3);
        resolve();
      });
    });

    await done;
    expect(order).toEqual([1, 2, 3]);
  });

  it('does not stall on error', async () => {
    const order: number[] = [];
    const holder: QueueHolder = { queue: [], processing: false };

    const done = new Promise<void>((resolve) => {
      enqueueTurn(holder, async () => {
        order.push(1);
        throw new Error('boom');
      });
      enqueueTurn(holder, async () => {
        order.push(2);
        resolve();
      });
    });

    await done;
    expect(order).toEqual([1, 2]);
  });

  it('processes items added during execution', async () => {
    const order: number[] = [];
    const holder: QueueHolder = { queue: [], processing: false };

    // Item1 runs synchronously within the first enqueueTurn call,
    // so item3 (added by item1) is queued before item2 (added after).
    // All three must complete, and the order reflects queue insertion order.
    let allDone: () => void;
    const done = new Promise<void>((resolve) => { allDone = resolve; });

    enqueueTurn(holder, async () => {
      order.push(1);
      // Add a new item while processing — queued before item2
      enqueueTurn(holder, async () => {
        order.push(3);
      });
    });
    enqueueTurn(holder, async () => {
      order.push(2);
      allDone!();
    });

    await done;
    // All three executed; item3 was inserted before item2 in the queue
    expect(order).toEqual([1, 3, 2]);
  });

  it('resets processing flag when queue drains', async () => {
    const holder: QueueHolder = { queue: [], processing: false };

    const done = new Promise<void>((resolve) => {
      enqueueTurn(holder, async () => {
        resolve();
      });
    });

    await done;
    // Allow microtask to complete the while loop
    await delay(0);
    expect(holder.processing).toBe(false);
  });

  it('kicks processor on new item after queue drained', async () => {
    const order: number[] = [];
    const holder: QueueHolder = { queue: [], processing: false };

    // First batch
    const first = new Promise<void>((resolve) => {
      enqueueTurn(holder, async () => {
        order.push(1);
        resolve();
      });
    });
    await first;
    await delay(0);
    expect(holder.processing).toBe(false);

    // Second batch after drain
    const second = new Promise<void>((resolve) => {
      enqueueTurn(holder, async () => {
        order.push(2);
        resolve();
      });
    });
    await second;
    expect(order).toEqual([1, 2]);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

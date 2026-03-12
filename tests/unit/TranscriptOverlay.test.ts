import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscriptOverlay } from '../../src/ui/TranscriptOverlay';
import type { QueueState } from '../../src/ai/types';

// Mock TranscriptStore
vi.mock('../../src/ui/TranscriptStore', () => ({
  TranscriptStore: {
    save: vi.fn(),
    load: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
  },
}));

describe('TranscriptOverlay queue panel', () => {
  let parent: HTMLElement;
  let overlay: TranscriptOverlay;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    overlay = new TranscriptOverlay(parent, 0, 'text');
  });

  function getQueuePanel(): HTMLElement | null {
    const container = parent.querySelector('.vsdk-transcript');
    return container?.querySelector('.vsdk-queue-panel') || null;
  }

  function getQueueItems(): NodeListOf<Element> {
    const panel = getQueuePanel();
    return panel?.querySelectorAll('.vsdk-queue-item') || document.querySelectorAll('.nonexistent');
  }

  it('renders active turn in queue panel', () => {
    const queue: QueueState = {
      active: { turnId: 't1', text: 'hello world', status: 'processing' },
      queued: [],
    };
    overlay.updateQueue(queue);

    const panel = getQueuePanel();
    expect(panel).not.toBeNull();

    const items = getQueueItems();
    expect(items.length).toBe(1);
    expect(items[0].querySelector('.vsdk-queue-dot')?.classList.contains('processing')).toBe(true);
    expect(items[0].querySelector('.vsdk-queue-item-text')?.textContent).toBe('hello world');
  });

  it('renders queued turns', () => {
    const queue: QueueState = {
      active: { turnId: 't1', text: 'processing', status: 'processing' },
      queued: [
        { turnId: 't2', text: 'queued 1', status: 'queued' },
        { turnId: 't3', text: 'queued 2', status: 'queued' },
      ],
    };
    overlay.updateQueue(queue);

    const items = getQueueItems();
    expect(items.length).toBe(3);
    expect(items[1].querySelector('.vsdk-queue-dot')?.classList.contains('queued')).toBe(true);
    expect(items[1].querySelector('.vsdk-queue-item-text')?.textContent).toBe('queued 1');
  });

  it('hides panel when queue is empty', () => {
    // First show something
    overlay.updateQueue({
      active: { turnId: 't1', text: 'hello', status: 'processing' },
      queued: [],
    });
    expect(getQueuePanel()).not.toBeNull();

    // Now clear
    overlay.updateQueue({ active: null, queued: [] });
    expect(getQueuePanel()).toBeNull();
  });

  it('cancel button calls cancel handler', () => {
    const cancelHandler = vi.fn();
    overlay.setCancelHandler(cancelHandler);

    overlay.updateQueue({
      active: { turnId: 't1', text: 'hello', status: 'processing' },
      queued: [],
    });

    const cancelBtn = getQueuePanel()?.querySelector('.vsdk-queue-cancel') as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();
    cancelBtn.click();

    expect(cancelHandler).toHaveBeenCalledWith('t1');
  });

  it('truncates long text', () => {
    const longText = 'a'.repeat(60);
    overlay.updateQueue({
      active: { turnId: 't1', text: longText, status: 'processing' },
      queued: [],
    });

    const textEl = getQueuePanel()?.querySelector('.vsdk-queue-item-text');
    expect(textEl?.textContent).toBe('a'.repeat(50) + '...');
  });

  it('shows executing-tools status', () => {
    overlay.updateQueue({
      active: { turnId: 't1', text: 'hello', status: 'executing-tools' },
      queued: [],
    });

    const dot = getQueuePanel()?.querySelector('.vsdk-queue-dot');
    expect(dot?.classList.contains('executing-tools')).toBe(true);
  });

  it('clearQueue removes the panel', () => {
    overlay.updateQueue({
      active: { turnId: 't1', text: 'hello', status: 'processing' },
      queued: [],
    });
    expect(getQueuePanel()).not.toBeNull();

    overlay.clearQueue();
    expect(getQueuePanel()).toBeNull();
  });

  it('removes thinking indicator when active turn is shown', () => {
    // Show thinking indicator
    overlay.showThinkingIndicator();
    const container = parent.querySelector('.vsdk-transcript')!;
    expect(container.querySelector('.vsdk-thinking')).not.toBeNull();

    // Update queue with active turn — should remove thinking
    overlay.updateQueue({
      active: { turnId: 't1', text: 'hello', status: 'processing' },
      queued: [],
    });
    expect(container.querySelector('.vsdk-thinking')).toBeNull();
  });
});

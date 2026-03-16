import type { TranscriptEvent } from '../types';
import type { QueueState } from '../ai/types';
import type { InputMode } from './FloatingButton';
import { TranscriptStore } from './TranscriptStore';
import type { StoredTranscriptLine } from './TranscriptStore';
import { sendIcon, closeIcon } from './icons';

export class TranscriptOverlay {
  private container: HTMLElement;
  private messagesEl: HTMLElement;
  private autoHideMs: number;
  private autoHideEnabled = true;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private lines: HTMLElement[] = [];
  private storedLines: StoredTranscriptLine[] = [];
  private maxLines = 10;
  private inputRow: HTMLElement | null = null;
  private onSendText: ((text: string) => void) | null = null;
  private onDisconnect: (() => void) | null = null;
  private onCancelTurn: ((turnId: string) => void) | null = null;
  private inputMode: InputMode;
  private toolStatusEl: HTMLElement | null = null;
  private thinkingEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private queuePanel: HTMLElement | null = null;
  private queueItems: Map<string, HTMLElement> = new Map();

  constructor(parent: HTMLElement, autoHideMs: number, inputMode: InputMode = 'voice') {
    this.autoHideMs = autoHideMs;
    this.inputMode = inputMode;

    this.container = document.createElement('div');
    this.container.className = 'vsdk-transcript';
    if (inputMode === 'text') {
      this.container.classList.add('text-mode');
    }
    parent.prepend(this.container);

    // Panel header (hidden until connected)
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'vsdk-panel-header';
    this.headerEl.style.display = 'none';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'vsdk-panel-header-left';

    const dot = document.createElement('span');
    dot.className = 'vsdk-panel-dot';

    const title = document.createElement('span');
    title.className = 'vsdk-panel-title';
    title.textContent = 'Assistant';

    headerLeft.appendChild(dot);
    headerLeft.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'vsdk-panel-close';
    closeBtn.innerHTML = closeIcon;
    closeBtn.setAttribute('aria-label', 'Disconnect');
    closeBtn.addEventListener('click', () => {
      this.onDisconnect?.();
    });

    this.headerEl.appendChild(headerLeft);
    this.headerEl.appendChild(closeBtn);
    this.container.appendChild(this.headerEl);

    // Scrollable messages area
    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'vsdk-messages';
    this.container.appendChild(this.messagesEl);

    // Text input row
    this.inputRow = document.createElement('div');
    this.inputRow.className = 'vsdk-text-input-row';

    const input = document.createElement('input');
    input.className = 'vsdk-text-input';
    input.type = 'text';
    input.placeholder = 'Message...';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        this.onSendText?.(input.value.trim());
        input.value = '';
      }
    });

    const sendBtn = document.createElement('button');
    sendBtn.className = 'vsdk-text-send';
    sendBtn.innerHTML = sendIcon;
    sendBtn.addEventListener('click', () => {
      if (input.value.trim()) {
        this.onSendText?.(input.value.trim());
        input.value = '';
      }
    });

    this.inputRow.appendChild(input);
    this.inputRow.appendChild(sendBtn);
    this.container.appendChild(this.inputRow);

    // In text mode: start visible
    if (inputMode === 'text') {
      this.container.classList.add('visible');
    }
  }

  setSendTextHandler(handler: (text: string) => void): void {
    this.onSendText = handler;
  }

  setDisconnectHandler(handler: () => void): void {
    this.onDisconnect = handler;
  }

  setHeaderVisible(visible: boolean): void {
    if (this.headerEl) {
      this.headerEl.style.display = visible ? '' : 'none';
    }
  }

  addTranscript(event: TranscriptEvent): void {
    this.removeThinkingIndicator();

    this.container.classList.add('visible');
    if (this.inputMode !== 'text') {
      this.resetAutoHide();
    }

    const lastLine = this.lines[this.lines.length - 1];
    const lastIsSameSpeaker = lastLine &&
      lastLine.classList.contains(`vsdk-msg-${event.speaker}`) &&
      !lastLine.dataset.final;

    // Non-final (interim) — update existing or create new
    if (!event.isFinal) {
      if (lastIsSameSpeaker) {
        lastLine.textContent = event.text;
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        return;
      }
      const line = this.createLine(event);
      this.appendLine(line);
      return;
    }

    // Final — update existing interim or create new
    if (lastIsSameSpeaker) {
      lastLine.textContent = event.text;
      lastLine.dataset.final = 'true';
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      this.storedLines.push({ speaker: event.speaker, text: event.text });
      TranscriptStore.save(this.storedLines);
      return;
    }

    const line = this.createLine(event);
    line.dataset.final = 'true';
    this.appendLine(line);

    this.storedLines.push({ speaker: event.speaker, text: event.text });
    TranscriptStore.save(this.storedLines);
  }

  restoreTranscript(): void {
    const stored = TranscriptStore.load();
    if (stored.length === 0) return;

    this.storedLines = [...stored];
    for (const entry of stored) {
      const line = this.createLine({ speaker: entry.speaker, text: entry.text, isFinal: true });
      line.dataset.final = 'true';
      line.classList.add('vsdk-restored');
      this.appendLine(line);
    }
    this.container.classList.add('visible');
  }

  showToolStatus(toolName: string): void {
    this.removeToolStatus();
    this.toolStatusEl = document.createElement('div');
    this.toolStatusEl.className = 'vsdk-tool-status';
    this.toolStatusEl.textContent = `${toolName}...`;
    this.messagesEl.appendChild(this.toolStatusEl);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  removeToolStatus(): void {
    if (this.toolStatusEl) {
      this.toolStatusEl.remove();
      this.toolStatusEl = null;
    }
  }

  showThinkingIndicator(): void {
    this.removeThinkingIndicator();
    this.thinkingEl = document.createElement('div');
    this.thinkingEl.className = 'vsdk-thinking';
    this.thinkingEl.innerHTML = '<span></span><span></span><span></span>';
    this.messagesEl.appendChild(this.thinkingEl);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  removeThinkingIndicator(): void {
    if (this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
    }
  }

  setCancelHandler(handler: (turnId: string) => void): void {
    this.onCancelTurn = handler;
  }

  updateQueue(queue: QueueState): void {
    const allItems = [
      ...(queue.active ? [queue.active] : []),
      ...queue.queued,
    ];

    if (allItems.length === 0) {
      if (this.queuePanel) {
        this.queuePanel.remove();
        this.queuePanel = null;
        this.queueItems.clear();
      }
      return;
    }

    if (queue.active) this.removeThinkingIndicator();

    if (!this.queuePanel) {
      this.queuePanel = document.createElement('div');
      this.queuePanel.className = 'vsdk-queue-panel';
    }

    // Incremental update: update existing items in place, add new, remove stale
    const currentIds = new Set(allItems.map(item => item.turnId));

    // Remove items no longer in the queue
    for (const [turnId, el] of this.queueItems) {
      if (!currentIds.has(turnId)) {
        el.remove();
        this.queueItems.delete(turnId);
      }
    }

    // Update or create items in order
    let prevEl: HTMLElement | null = null;
    for (const item of allItems) {
      let el = this.queueItems.get(item.turnId);
      if (el) {
        // Update existing item in place (no re-creation, no animation replay)
        const dot = el.querySelector('.vsdk-queue-dot') as HTMLElement;
        if (dot) {
          dot.className = `vsdk-queue-dot ${item.status}`;
        }
        const textEl = el.querySelector('.vsdk-queue-item-text') as HTMLElement;
        if (textEl) {
          const truncated = item.text.length > 50 ? item.text.slice(0, 50) + '...' : item.text;
          if (textEl.textContent !== truncated) textEl.textContent = truncated;
        }
      } else {
        // Create new item
        el = this.createQueueItem(item);
        this.queueItems.set(item.turnId, el);
      }

      // Ensure correct order in DOM
      const expectedNext: ChildNode | null = prevEl ? prevEl.nextSibling : this.queuePanel.firstChild;
      if (el.parentElement !== this.queuePanel || el !== expectedNext) {
        if (expectedNext) {
          this.queuePanel.insertBefore(el, expectedNext);
        } else {
          this.queuePanel.appendChild(el);
        }
      }
      prevEl = el;
    }

    if (!this.queuePanel.parentElement) {
      this.container.insertBefore(this.queuePanel, this.inputRow);
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  clearQueue(): void {
    if (this.queuePanel) {
      this.queuePanel.remove();
      this.queuePanel = null;
    }
    this.queueItems.clear();
  }

  private createQueueItem(item: { turnId: string; text: string; status: string }): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vsdk-queue-item';

    const dot = document.createElement('span');
    dot.className = `vsdk-queue-dot ${item.status}`;

    const text = document.createElement('span');
    text.className = 'vsdk-queue-item-text';
    text.textContent = item.text.length > 50 ? item.text.slice(0, 50) + '...' : item.text;

    const cancel = document.createElement('button');
    cancel.className = 'vsdk-queue-cancel';
    cancel.textContent = '\u00d7';
    cancel.setAttribute('aria-label', 'Cancel');
    cancel.addEventListener('click', () => {
      this.onCancelTurn?.(item.turnId);
    });

    el.appendChild(dot);
    el.appendChild(text);
    el.appendChild(cancel);
    return el;
  }

  show(): void {
    this.container.classList.add('visible');
    if (this.inputMode !== 'text') this.resetAutoHide();
  }

  hide(): void {
    this.container.classList.remove('visible');
  }

  isVisible(): boolean {
    return this.container.classList.contains('visible');
  }

  clear(): void {
    this.lines.forEach((l) => l.remove());
    this.lines = [];
    this.storedLines = [];
    this.removeToolStatus();
    this.removeThinkingIndicator();
    this.clearQueue();
    TranscriptStore.clear();
    this.hide();
  }

  toggleVisibility(): void {
    if (this.container.classList.contains('visible')) {
      this.hide();
    } else {
      this.show();
    }
  }

  focusInput(): void {
    const input = this.container.querySelector('.vsdk-text-input') as HTMLInputElement | null;
    input?.focus();
  }

  private createLine(event: { speaker: 'user' | 'ai'; text: string; isFinal?: boolean }): HTMLElement {
    const line = document.createElement('div');
    line.className = `vsdk-transcript-line vsdk-msg-${event.speaker}`;
    line.textContent = event.text;
    return line;
  }

  private appendLine(line: HTMLElement): void {
    this.lines.push(line);
    while (this.lines.length > this.maxLines) {
      const old = this.lines.shift();
      old?.remove();
    }
    this.messagesEl.appendChild(line);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  setAutoHideEnabled(enabled: boolean): void {
    this.autoHideEnabled = enabled;
    if (!enabled) {
      this.clearAutoHideTimer();
    } else {
      if (this.inputMode !== 'text' && this.isVisible()) this.resetAutoHide();
    }
  }

  private clearAutoHideTimer(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  private resetAutoHide(): void {
    this.clearAutoHideTimer();
    if (this.autoHideMs > 0 && this.autoHideEnabled) {
      this.hideTimeout = setTimeout(() => this.hide(), this.autoHideMs);
    }
  }

  destroy(): void {
    this.clearAutoHideTimer();
    this.removeThinkingIndicator();
    this.clearQueue();
    this.container.remove();
  }
}

import type { TranscriptEvent } from '../types';
import type { QueueState } from '../ai/types';
import type { InputMode } from './FloatingButton';
import { TranscriptStore } from './TranscriptStore';
import type { StoredTranscriptLine } from './TranscriptStore';
import {
  sendIcon, minimizeIcon, stopIcon, settingsIcon, refreshIcon,
  gearSmallIcon, checkSmallIcon, xSmallIcon, codeIcon,
} from './icons';

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
  private onMinimize: (() => void) | null = null;
  private endSessionBtn: HTMLElement | null = null;
  private truncationEl: HTMLElement | null = null;
  private onCancelTurn: ((turnId: string) => void) | null = null;
  private inputMode: InputMode;
  private activityEl: HTMLElement | null = null;
  private activityStage: 'thinking' | 'executing' | 'processing' | null = null;
  private headerEl: HTMLElement | null = null;
  private headerRightEl: HTMLElement | null = null;
  private headerDotEl: HTMLElement | null = null;
  private hasSettings = false;
  private refreshBtn: HTMLElement | null = null;
  private onRefresh: (() => void) | null = null;
  private settingsViewEl: HTMLElement | null = null;
  private queuePanel: HTMLElement | null = null;
  private queueItems: Map<string, HTMLElement> = new Map();
  private userInteracting = false;

  constructor(parent: HTMLElement, autoHideMs: number, inputMode: InputMode = 'voice') {
    this.autoHideMs = autoHideMs;
    this.inputMode = inputMode;

    this.container = document.createElement('div');
    this.container.className = 'vsdk-transcript';
    if (inputMode === 'text') {
      this.container.classList.add('text-mode');
    }
    parent.prepend(this.container);

    // Pause auto-hide while user is interacting with the panel (reading/scrolling)
    this.container.addEventListener('mouseenter', () => {
      this.userInteracting = true;
      this.clearAutoHideTimer();
    });
    this.container.addEventListener('mouseleave', () => {
      this.userInteracting = false;
      if (this.inputMode !== 'text' && this.isVisible()) this.resetAutoHide();
    });
    this.container.addEventListener('touchstart', () => {
      this.userInteracting = true;
      this.clearAutoHideTimer();
    }, { passive: true });
    this.container.addEventListener('touchend', () => {
      this.userInteracting = false;
      if (this.inputMode !== 'text' && this.isVisible()) this.resetAutoHide();
    }, { passive: true });

    // Panel header (hidden until connected)
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'vsdk-panel-header';
    this.headerEl.style.display = 'none';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'vsdk-panel-header-left';

    this.headerDotEl = document.createElement('span');
    this.headerDotEl.className = 'vsdk-panel-dot';

    const title = document.createElement('span');
    title.className = 'vsdk-panel-title';
    title.textContent = 'Assistant';

    headerLeft.appendChild(this.headerDotEl);
    headerLeft.appendChild(title);

    this.headerRightEl = document.createElement('div');
    this.headerRightEl.className = 'vsdk-panel-header-right';

    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'vsdk-panel-minimize';
    minimizeBtn.innerHTML = minimizeIcon;
    minimizeBtn.setAttribute('aria-label', 'Minimize');
    minimizeBtn.addEventListener('click', () => {
      this.onMinimize?.();
    });

    this.endSessionBtn = document.createElement('button');
    this.endSessionBtn.className = 'vsdk-panel-end-session';
    this.endSessionBtn.innerHTML = stopIcon;
    this.endSessionBtn.setAttribute('aria-label', 'End session');
    this.endSessionBtn.addEventListener('click', () => {
      this.onDisconnect?.();
    });

    // Refresh button (hidden by default, shown in build mode)
    this.refreshBtn = document.createElement('button');
    this.refreshBtn.className = 'vsdk-panel-refresh';
    this.refreshBtn.innerHTML = refreshIcon; // trusted SVG constant from icons.ts
    this.refreshBtn.setAttribute('aria-label', 'New build session');
    this.refreshBtn.style.display = 'none';
    this.refreshBtn.addEventListener('click', () => {
      this.onRefresh?.();
    });

    this.headerRightEl.appendChild(this.refreshBtn);
    this.headerRightEl.appendChild(minimizeBtn);
    this.headerRightEl.appendChild(this.endSessionBtn);

    this.headerEl.appendChild(headerLeft);
    this.headerEl.appendChild(this.headerRightEl);
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

  setMinimizeHandler(handler: () => void): void {
    this.onMinimize = handler;
  }

  setHeaderVisible(visible: boolean): void {
    if (!this.headerEl) return;
    if (this.hasSettings) {
      // Header always visible when settings enabled; toggle only the dot
      this.headerEl.style.display = '';
      if (this.headerDotEl) {
        this.headerDotEl.style.display = visible ? '' : 'none';
      }
    } else {
      this.headerEl.style.display = visible ? '' : 'none';
    }
  }

  setSettingsClickHandler(handler: () => void): void {
    this.hasSettings = true;
    const gearBtn = document.createElement('button');
    gearBtn.className = 'vsdk-settings-btn';
    gearBtn.innerHTML = settingsIcon;
    gearBtn.setAttribute('aria-label', 'Settings');
    gearBtn.addEventListener('click', handler);
    // Prepend so gear appears before close button
    this.headerRightEl?.prepend(gearBtn);
    // Show header immediately so settings is accessible before connect
    if (this.headerEl) {
      this.headerEl.style.display = '';
      if (this.headerDotEl) this.headerDotEl.style.display = 'none';
    }
  }

  showSettingsView(el: HTMLElement): void {
    this.settingsViewEl = el;
    this.container.classList.add('settings-open');
    this.container.appendChild(el);
  }

  hideSettingsView(): void {
    this.container.classList.remove('settings-open');
    if (this.settingsViewEl) {
      this.settingsViewEl.remove();
      this.settingsViewEl = null;
    }
  }

  isSettingsOpen(): boolean {
    return this.container.classList.contains('settings-open');
  }

  addTranscript(event: TranscriptEvent): void {
    this.removeActivity();

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

  addSystemMessage(text: string): void {
    this.container.classList.add('visible');
    const line = document.createElement('div');
    line.className = 'vsdk-transcript-line vsdk-msg-system';
    line.textContent = text;
    this.appendLine(line);
  }

  addBuildSystemMessage(text: string): void {
    const line = document.createElement('div');
    line.className = 'vsdk-transcript-line vsdk-msg-build';
    line.textContent = text;
    this.appendLine(line);
    this.container.classList.add('visible');
  }

  /** Updates the unified activity bubble with the current tool loop stage. */
  setToolLoopStatus(text: string | null): void {
    if (!text) {
      this.removeActivity();
      return;
    }

    // Determine stage from text content
    const isProcessing = text.toLowerCase().startsWith('processing');
    const stage: 'executing' | 'processing' = isProcessing ? 'processing' : 'executing';

    this.ensureActivity(stage);
    const label = this.activityEl?.querySelector('.vsdk-activity-label');
    if (label) label.textContent = text;
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  setPanelTitle(title: string): void {
    const titleEl = this.container.querySelector('.vsdk-panel-title');
    if (titleEl) titleEl.textContent = title;
  }

  setBuildModeDot(active: boolean): void {
    this.headerDotEl?.classList.toggle('vsdk-build-mode', active);
    this.container.classList.toggle('vsdk-build-panel', active);
  }

  /** Show truncated page URL in the header (build mode context). */
  setBuildUrl(url: string | null): void {
    let badge = this.headerEl?.querySelector('.vsdk-build-url') as HTMLElement | null;
    if (!url) {
      badge?.remove();
      return;
    }
    // Show just the pathname
    let display: string;
    try { display = new URL(url).pathname; } catch { display = url; }
    if (display.length > 28) display = display.slice(0, 28) + '\u2026';
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'vsdk-build-url';
      this.headerEl?.querySelector('.vsdk-panel-header-left')?.appendChild(badge);
    }
    badge.textContent = display;
    badge.title = url;
  }

  showRefreshButton(): void {
    if (this.refreshBtn) this.refreshBtn.style.display = '';
  }

  hideRefreshButton(): void {
    if (this.refreshBtn) this.refreshBtn.style.display = 'none';
  }

  setRefreshHandler(handler: () => void): void {
    this.onRefresh = handler;
  }

  addPendingTool(
    tool: { name: string; code: string },
    onAccept: () => void,
    onReject: () => void,
  ): void {
    const el = document.createElement('div');
    el.className = 'vsdk-pending-tool pending';
    el.setAttribute('data-tool-name', tool.name);

    // Icon + name row
    const header = document.createElement('div');
    header.className = 'vsdk-pending-tool-header';

    const titleRow = document.createElement('div');
    titleRow.className = 'vsdk-pending-tool-title-row';
    titleRow.innerHTML = codeIcon;
    const nameEl = document.createElement('span');
    nameEl.className = 'vsdk-pending-tool-name';
    nameEl.textContent = tool.name;
    titleRow.appendChild(nameEl);
    header.appendChild(titleRow);

    // Code preview (first 3 meaningful lines)
    const codeEl = document.createElement('pre');
    codeEl.className = 'vsdk-pending-tool-code';
    const lines = tool.code.split('\n').filter(l => l.trim()).slice(0, 3);
    codeEl.textContent = lines.join('\n') + (tool.code.split('\n').filter(l => l.trim()).length > 3 ? '\n...' : '');

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'vsdk-pending-tool-actions';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'vsdk-pending-tool-accept';
    acceptBtn.innerHTML = checkSmallIcon + ' Accept';
    acceptBtn.addEventListener('click', () => {
      onAccept();
      el.classList.add('accepted');
      el.classList.remove('pending');
      actions.remove();
    });

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'vsdk-pending-tool-reject';
    rejectBtn.innerHTML = xSmallIcon + ' Reject';
    rejectBtn.addEventListener('click', () => {
      onReject();
      el.classList.add('rejected');
      el.classList.remove('pending');
      actions.remove();
    });

    actions.appendChild(rejectBtn);
    actions.appendChild(acceptBtn);

    el.appendChild(header);
    el.appendChild(codeEl);
    el.appendChild(actions);

    this.appendLine(el);
    this.container.classList.add('visible');
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

  showThinkingIndicator(): void {
    this.ensureActivity('thinking');
  }

  removeThinkingIndicator(): void {
    // Only remove if still in thinking stage — tool execution takes over
    if (this.activityStage === 'thinking') {
      this.removeActivity();
    }
  }

  // ── Unified activity bubble ──

  private ensureActivity(stage: 'thinking' | 'executing' | 'processing'): void {
    if (!this.activityEl) {
      this.activityEl = document.createElement('div');
      this.activityEl.className = 'vsdk-activity';
      this.messagesEl.appendChild(this.activityEl);
    }

    // Skip DOM rebuild if stage hasn't changed
    if (this.activityStage === stage) return;

    this.activityStage = stage;
    this.activityEl.className = `vsdk-activity vsdk-activity-${stage}`;

    if (stage === 'thinking') {
      this.activityEl.innerHTML =
        '<div class="vsdk-activity-dots"><span></span><span></span><span></span></div>';
    } else {
      const icon = stage === 'executing' ? gearSmallIcon : gearSmallIcon;
      this.activityEl.innerHTML =
        `<div class="vsdk-activity-inner">` +
        `<span class="vsdk-activity-icon">${icon}</span>` +
        `<span class="vsdk-activity-label"></span>` +
        `</div>` +
        `<div class="vsdk-activity-shimmer"></div>`;
    }

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private removeActivity(): void {
    if (this.activityEl) {
      this.activityEl.remove();
      this.activityEl = null;
      this.activityStage = null;
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

    if (queue.active) this.removeActivity();

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
    this.removeActivity();
    this.clearQueue();
    this.truncationEl?.remove();
    this.truncationEl = null;
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
    let removed = false;
    while (this.lines.length > this.maxLines) {
      const old = this.lines.shift();
      old?.remove();
      removed = true;
    }
    if (removed) {
      this.showTruncationIndicator();
    }
    this.messagesEl.appendChild(line);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private showTruncationIndicator(): void {
    if (!this.truncationEl) {
      this.truncationEl = document.createElement('div');
      this.truncationEl.className = 'vsdk-truncation-notice';
      this.truncationEl.textContent = 'Older messages not shown';
    }
    if (this.truncationEl.parentElement !== this.messagesEl) {
      this.messagesEl.prepend(this.truncationEl);
    }
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
    if (this.autoHideMs > 0 && this.autoHideEnabled && !this.userInteracting) {
      this.hideTimeout = setTimeout(() => this.hide(), this.autoHideMs);
    }
  }

  destroy(): void {
    this.clearAutoHideTimer();
    this.removeActivity();
    this.clearQueue();
    this.hideSettingsView();
    this.container.remove();
  }
}

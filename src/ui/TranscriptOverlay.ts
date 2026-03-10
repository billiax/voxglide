import type { TranscriptEvent } from '../types';
import type { InputMode } from './FloatingButton';
import { TranscriptStore } from './TranscriptStore';
import type { StoredTranscriptLine } from './TranscriptStore';

export class TranscriptOverlay {
  private container: HTMLElement;
  private autoHideMs: number;
  private autoHideEnabled = true;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private lines: HTMLElement[] = [];
  private storedLines: StoredTranscriptLine[] = [];
  private maxLines = 10;
  private inputRow: HTMLElement | null = null;
  private onSendText: ((text: string) => void) | null = null;
  private onDisconnect: (() => void) | null = null;
  private inputMode: InputMode;
  private toolStatusEl: HTMLElement | null = null;
  private thinkingEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;

  constructor(parent: HTMLElement, autoHideMs: number, inputMode: InputMode = 'voice') {
    this.autoHideMs = autoHideMs;
    this.inputMode = inputMode;

    this.container = document.createElement('div');
    this.container.className = 'vsdk-transcript';
    if (inputMode === 'text') {
      this.container.classList.add('text-mode');
    }
    parent.prepend(this.container);

    // Panel header (hidden by default)
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'vsdk-panel-header';
    this.headerEl.style.display = 'none';

    const title = document.createElement('span');
    title.className = 'vsdk-panel-title';
    title.textContent = 'Assistant';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'vsdk-panel-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Disconnect');
    closeBtn.addEventListener('click', () => {
      this.onDisconnect?.();
    });

    this.headerEl.appendChild(title);
    this.headerEl.appendChild(closeBtn);
    this.container.appendChild(this.headerEl);

    // Text input row
    this.inputRow = document.createElement('div');
    this.inputRow.className = 'vsdk-text-input-row';

    const input = document.createElement('input');
    input.className = 'vsdk-text-input';
    input.type = 'text';
    input.placeholder = 'Type a message...';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        this.onSendText?.(input.value.trim());
        input.value = '';
      }
    });

    const sendBtn = document.createElement('button');
    sendBtn.className = 'vsdk-text-send';
    sendBtn.textContent = '\u2192';
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
    // Remove thinking indicator when new content arrives
    this.removeThinkingIndicator();

    // Show the overlay
    this.container.classList.add('visible');
    if (this.inputMode !== 'text') {
      this.resetAutoHide();
    }

    const lastLine = this.lines[this.lines.length - 1];
    const lastSpeaker = lastLine?.querySelector('.speaker');
    const lastIsSameSpeaker = lastLine && lastSpeaker?.classList.contains(event.speaker) && !lastLine.dataset.final;

    // Non-final (interim) — update existing line from the same speaker, or create new
    if (!event.isFinal) {
      if (lastIsSameSpeaker) {
        const textSpan = lastLine.querySelector('span:not(.speaker)');
        if (textSpan) {
          textSpan.textContent = event.text;
          this.container.scrollTop = this.container.scrollHeight;
          return;
        }
      }
      const line = this.createLine(event);
      this.appendLine(line);
      return;
    }

    // Final — update existing interim line from the same speaker, or create new
    if (lastIsSameSpeaker) {
      const textSpan = lastLine.querySelector('span:not(.speaker)');
      if (textSpan) {
        textSpan.textContent = event.text;
        lastLine.dataset.final = 'true';
        this.container.scrollTop = this.container.scrollHeight;
        // Persist final line
        this.storedLines.push({ speaker: event.speaker, text: event.text });
        TranscriptStore.save(this.storedLines);
        return;
      }
    }

    const line = this.createLine(event);
    line.dataset.final = 'true';
    this.appendLine(line);

    // Persist final line
    this.storedLines.push({ speaker: event.speaker, text: event.text });
    TranscriptStore.save(this.storedLines);
  }

  /**
   * Restore transcript lines from sessionStorage.
   */
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

  /**
   * Show a tool execution status indicator.
   */
  showToolStatus(toolName: string): void {
    this.removeToolStatus();
    this.toolStatusEl = document.createElement('div');
    this.toolStatusEl.className = 'vsdk-tool-status';
    this.toolStatusEl.textContent = `Executing ${toolName}...`;
    this.container.insertBefore(this.toolStatusEl, this.inputRow);
    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Remove the tool execution status indicator.
   */
  removeToolStatus(): void {
    if (this.toolStatusEl) {
      this.toolStatusEl.remove();
      this.toolStatusEl = null;
    }
  }

  /**
   * Show an animated "AI is thinking" indicator.
   */
  showThinkingIndicator(): void {
    this.removeThinkingIndicator();
    this.thinkingEl = document.createElement('div');
    this.thinkingEl.className = 'vsdk-thinking';
    this.thinkingEl.innerHTML = '<span></span><span></span><span></span>';
    this.container.insertBefore(this.thinkingEl, this.inputRow);
    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Remove the "AI is thinking" indicator.
   */
  removeThinkingIndicator(): void {
    if (this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
    }
  }

  show(): void {
    this.container.classList.add('visible');
    if (this.inputMode !== 'text') {
      this.resetAutoHide();
    }
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
    TranscriptStore.clear();
    this.hide();
  }

  /**
   * Toggle visibility of the transcript panel.
   */
  toggleVisibility(): void {
    if (this.container.classList.contains('visible')) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Focus the text input field.
   */
  focusInput(): void {
    const input = this.container.querySelector('.vsdk-text-input') as HTMLInputElement | null;
    input?.focus();
  }

  private createLine(event: { speaker: 'user' | 'ai'; text: string; isFinal?: boolean }): HTMLElement {
    const line = document.createElement('div');
    line.className = 'vsdk-transcript-line';

    const speaker = document.createElement('span');
    speaker.className = `speaker ${event.speaker}`;
    speaker.textContent = event.speaker === 'user' ? 'You' : 'AI';

    const text = document.createElement('span');
    text.textContent = event.text;

    line.appendChild(speaker);
    line.appendChild(text);

    return line;
  }

  private appendLine(line: HTMLElement): void {
    this.lines.push(line);
    // Keep only recent lines
    while (this.lines.length > this.maxLines) {
      const old = this.lines.shift();
      old?.remove();
    }

    this.container.insertBefore(line, this.inputRow);
    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Enable or disable auto-hide. Disabled during active sessions so the panel stays visible.
   */
  setAutoHideEnabled(enabled: boolean): void {
    this.autoHideEnabled = enabled;
    if (!enabled) {
      this.clearAutoHideTimer();
    } else {
      // When re-enabling: if panel is visible and not text mode, restart timer
      if (this.inputMode !== 'text' && this.isVisible()) {
        this.resetAutoHide();
      }
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
    this.container.remove();
  }
}

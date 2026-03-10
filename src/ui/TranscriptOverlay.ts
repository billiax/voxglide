import type { TranscriptEvent } from '../types';
import type { InputMode } from './FloatingButton';

export class TranscriptOverlay {
  private container: HTMLElement;
  private autoHideMs: number;
  private autoHideEnabled = true;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private lines: HTMLElement[] = [];
  private maxLines = 10;
  private inputRow: HTMLElement | null = null;
  private onSendText: ((text: string) => void) | null = null;
  private inputMode: InputMode;
  private toolStatusEl: HTMLElement | null = null;

  constructor(parent: HTMLElement, autoHideMs: number, inputMode: InputMode = 'voice') {
    this.autoHideMs = autoHideMs;
    this.inputMode = inputMode;

    this.container = document.createElement('div');
    this.container.className = 'vsdk-transcript';
    if (inputMode === 'text') {
      this.container.classList.add('text-mode');
    }
    parent.prepend(this.container);

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

  addTranscript(event: TranscriptEvent): void {
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
        return;
      }
    }

    const line = this.createLine(event);
    line.dataset.final = 'true';
    this.appendLine(line);
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

  show(): void {
    this.container.classList.add('visible');
    if (this.inputMode !== 'text') {
      this.resetAutoHide();
    }
  }

  hide(): void {
    this.container.classList.remove('visible');
  }

  clear(): void {
    this.lines.forEach((l) => l.remove());
    this.lines = [];
    this.removeToolStatus();
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

  private createLine(event: TranscriptEvent): HTMLElement {
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
    if (!enabled && this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  private resetAutoHide(): void {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    if (this.autoHideMs > 0 && this.autoHideEnabled) {
      this.hideTimeout = setTimeout(() => this.hide(), this.autoHideMs);
    }
  }

  destroy(): void {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.container.remove();
  }
}

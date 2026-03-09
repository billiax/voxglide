import type { TranscriptEvent } from '../types';

export class TranscriptOverlay {
  private container: HTMLElement;
  private autoHideMs: number;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private lines: HTMLElement[] = [];
  private maxLines = 10;
  private inputRow: HTMLElement | null = null;
  private onSendText: ((text: string) => void) | null = null;

  constructor(parent: HTMLElement, autoHideMs: number) {
    this.autoHideMs = autoHideMs;

    this.container = document.createElement('div');
    this.container.className = 'vsdk-transcript';
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
    sendBtn.textContent = '→';
    sendBtn.addEventListener('click', () => {
      if (input.value.trim()) {
        this.onSendText?.(input.value.trim());
        input.value = '';
      }
    });

    this.inputRow.appendChild(input);
    this.inputRow.appendChild(sendBtn);
    this.container.appendChild(this.inputRow);
  }

  setSendTextHandler(handler: (text: string) => void): void {
    this.onSendText = handler;
  }

  addTranscript(event: TranscriptEvent): void {
    // Show the overlay
    this.container.classList.add('visible');
    this.resetAutoHide();

    // Create line element
    const line = document.createElement('div');
    line.className = 'vsdk-transcript-line';

    const speaker = document.createElement('span');
    speaker.className = `speaker ${event.speaker}`;
    speaker.textContent = event.speaker === 'user' ? 'You' : 'AI';

    const text = document.createElement('span');
    text.textContent = event.text;

    line.appendChild(speaker);
    line.appendChild(text);

    this.lines.push(line);
    // Keep only recent lines
    while (this.lines.length > this.maxLines) {
      const old = this.lines.shift();
      old?.remove();
    }

    this.container.appendChild(line);
    this.container.scrollTop = this.container.scrollHeight;
  }

  show(): void {
    this.container.classList.add('visible');
    this.resetAutoHide();
  }

  hide(): void {
    this.container.classList.remove('visible');
  }

  clear(): void {
    this.lines.forEach((l) => l.remove());
    this.lines = [];
    this.hide();
  }

  private resetAutoHide(): void {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    if (this.autoHideMs > 0) {
      this.hideTimeout = setTimeout(() => this.hide(), this.autoHideMs);
    }
  }

  destroy(): void {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.container.remove();
  }
}

import type { UIConfig, TranscriptEvent } from '../types';
import type { ConnectionStateValue } from '../constants';
import { DEFAULT_UI } from '../constants';
import { SDK_STYLES } from './styles';
import { FloatingButton } from './FloatingButton';
import { TranscriptOverlay } from './TranscriptOverlay';
import type { InputMode } from './FloatingButton';

export class UIManager {
  private host: HTMLElement;
  private shadowRoot: ShadowRoot;
  private wrapper: HTMLElement;
  private button: FloatingButton;
  private transcript: TranscriptOverlay | null = null;
  private config: Required<UIConfig>;
  private inputMode: InputMode;
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    config: UIConfig = {},
    onToggle: () => void,
    onSendText?: (text: string) => void,
    inputMode: InputMode = 'voice',
  ) {
    this.config = { ...DEFAULT_UI, ...config };
    this.inputMode = inputMode;

    // Create Shadow DOM host
    this.host = document.createElement('div');
    this.host.setAttribute('data-voice-sdk', 'true');
    this.host.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: ' + this.config.zIndex;
    document.body.appendChild(this.host);

    this.shadowRoot = this.host.attachShadow({ mode: 'open' });

    // Inject styles
    const style = document.createElement('style');
    style.textContent = SDK_STYLES;
    this.shadowRoot.appendChild(style);

    // Set custom properties
    this.host.style.setProperty('--voice-sdk-primary', this.config.primaryColor);
    this.shadowRoot.host.setAttribute('style',
      `--voice-sdk-primary: ${this.config.primaryColor}; --vsdk-z-index: ${this.config.zIndex}`
    );

    // Create wrapper container
    this.wrapper = document.createElement('div');
    this.wrapper.className = `vsdk-container ${this.config.position}`;
    this.shadowRoot.appendChild(this.wrapper);

    // Create transcript overlay (before button so it appears above)
    if (this.config.showTranscript) {
      this.transcript = new TranscriptOverlay(this.wrapper, this.config.transcriptAutoHideMs, inputMode);
      if (onSendText) {
        this.transcript.setSendTextHandler(onSendText);
      }
    }

    // Create floating button
    this.button = new FloatingButton(this.wrapper, onToggle, inputMode);

    // Keyboard shortcut: Ctrl/Cmd+K to focus text input
    this.keyboardHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.focusInput();
      }
    };
    document.addEventListener('keydown', this.keyboardHandler);
  }

  setConnectionState(state: ConnectionStateValue): void {
    this.button.setState(state);
  }

  addTranscript(event: TranscriptEvent): void {
    this.transcript?.addTranscript(event);
  }

  /**
   * Show a tool execution status in the transcript.
   */
  showToolStatus(toolName: string): void {
    this.transcript?.showToolStatus(toolName);
  }

  /**
   * Remove the tool execution status from the transcript.
   */
  removeToolStatus(): void {
    this.transcript?.removeToolStatus();
  }

  showTranscript(): void {
    this.transcript?.show();
  }

  hideTranscript(): void {
    this.transcript?.hide();
  }

  /**
   * Enable or disable auto-hide on the transcript panel.
   * Disabled during active sessions so the panel stays visible.
   */
  setAutoHideEnabled(enabled: boolean): void {
    this.transcript?.setAutoHideEnabled(enabled);
  }

  clearTranscript(): void {
    this.transcript?.clear();
  }

  /**
   * Toggle transcript panel visibility (for text mode toggle behavior).
   */
  toggleTranscript(): void {
    this.transcript?.toggleVisibility();
  }

  /**
   * Focus the text input in the transcript.
   */
  focusInput(): void {
    this.transcript?.show();
    this.transcript?.focusInput();
  }

  destroy(): void {
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardHandler = null;
    }
    this.button.destroy();
    this.transcript?.destroy();
    this.host.remove();
  }
}

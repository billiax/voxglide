import type { UIConfig, TranscriptEvent } from '../types';
import type { ConnectionStateValue } from '../constants';
import { DEFAULT_UI } from '../constants';
import { SDK_STYLES } from './styles';
import { FloatingButton } from './FloatingButton';
import { TranscriptOverlay } from './TranscriptOverlay';

export class UIManager {
  private host: HTMLElement;
  private shadowRoot: ShadowRoot;
  private wrapper: HTMLElement;
  private button: FloatingButton;
  private transcript: TranscriptOverlay | null = null;
  private config: Required<UIConfig>;

  constructor(config: UIConfig = {}, onToggle: () => void) {
    this.config = { ...DEFAULT_UI, ...config };

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
      this.transcript = new TranscriptOverlay(this.wrapper, this.config.transcriptAutoHideMs);
    }

    // Create floating button
    this.button = new FloatingButton(this.wrapper, onToggle);
  }

  setConnectionState(state: ConnectionStateValue): void {
    this.button.setState(state);
  }

  addTranscript(event: TranscriptEvent): void {
    this.transcript?.addTranscript(event);
  }

  showTranscript(): void {
    this.transcript?.show();
  }

  hideTranscript(): void {
    this.transcript?.hide();
  }

  clearTranscript(): void {
    this.transcript?.clear();
  }

  destroy(): void {
    this.button.destroy();
    this.transcript?.destroy();
    this.host.remove();
  }
}

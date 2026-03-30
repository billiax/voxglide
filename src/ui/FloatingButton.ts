import { micIcon, micActiveIcon, micPausedIcon, loaderIcon, chatIcon, closeIcon } from './icons';
import { ConnectionState } from '../constants';
import type { UIState } from './UIStateMachine';

export type ButtonClickHandler = () => void;
export type InputMode = 'voice' | 'text';

export class FloatingButton {
  private button: HTMLButtonElement;
  private onClick: ButtonClickHandler;

  constructor(parent: HTMLElement, onClick: ButtonClickHandler, inputMode: InputMode = 'voice') {
    this.onClick = onClick;

    this.button = document.createElement('button');
    this.button.className = 'vsdk-btn';
    this.button.setAttribute('aria-label', inputMode === 'text' ? 'Open chat' : 'Voice assistant');
    this.button.innerHTML = inputMode === 'text' ? chatIcon : micIcon;
    this.button.addEventListener('click', () => this.onClick());
    parent.appendChild(this.button);
  }

  render(state: Readonly<UIState>): void {
    // Remove all state classes
    this.button.classList.remove('listening', 'connecting', 'paused', 'connected');

    if (state.inputMode === 'text') {
      // Text mode — calm blue glow when connected, no red pulse
      switch (state.connection) {
        case ConnectionState.CONNECTED:
          this.button.classList.add('connected');
          if (state.panelVisible) {
            this.button.innerHTML = closeIcon;
            this.button.setAttribute('aria-label', 'Hide chat');
          } else {
            this.button.innerHTML = chatIcon;
            this.button.setAttribute('aria-label', 'Show chat');
          }
          break;
        case ConnectionState.CONNECTING:
          this.button.classList.add('connecting');
          this.button.innerHTML = loaderIcon;
          this.button.setAttribute('aria-label', 'Connecting...');
          break;
        default:
          this.button.innerHTML = chatIcon;
          this.button.setAttribute('aria-label', 'Open chat');
          break;
      }
    } else {
      // Voice mode — icons reflect current mic state, no panelVisible branching
      switch (state.connection) {
        case ConnectionState.CONNECTED:
          if (state.speechPaused) {
            // Speech paused — show reason-specific label
            this.button.classList.add('paused');
            this.button.innerHTML = micPausedIcon;
            switch (state.pauseReason) {
              case 'tts':
                this.button.setAttribute('aria-label', 'Mic paused — AI speaking');
                break;
              case 'mic-error':
                this.button.setAttribute('aria-label', 'Mic error — retrying');
                break;
              default:
                this.button.setAttribute('aria-label', 'Microphone paused');
            }
          } else if (state.speechActive) {
            // Actively recording — mic with sound waves
            this.button.classList.add('listening');
            this.button.innerHTML = micActiveIcon;
            if (state.panelVisible) {
              this.button.setAttribute('aria-label', 'Listening — click to stop');
            } else {
              this.button.setAttribute('aria-label', 'Show transcript');
            }
          } else {
            // Connected but speech not active (failed or unavailable)
            this.button.classList.add('paused');
            this.button.innerHTML = micPausedIcon;
            this.button.setAttribute('aria-label', 'Mic unavailable — use text input');
          }
          break;
        case ConnectionState.CONNECTING:
          this.button.classList.add('connecting');
          this.button.innerHTML = loaderIcon;
          this.button.setAttribute('aria-label', 'Connecting...');
          break;
        case ConnectionState.DISCONNECTED:
        case ConnectionState.ERROR:
        default:
          this.button.innerHTML = micIcon;
          this.button.setAttribute('aria-label', 'Start voice assistant');
          break;
      }
    }
  }

  destroy(): void {
    this.button.remove();
  }
}

import { micIcon, micOffIcon, micPausedIcon, loaderIcon, chatIcon, closeIcon } from './icons';
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
    this.button.classList.remove('listening', 'connecting', 'paused');

    if (state.inputMode === 'text') {
      // Text mode
      switch (state.connection) {
        case ConnectionState.CONNECTED:
          this.button.classList.add('listening');
          // Show close icon when panel is visible, chat icon when hidden
          if (state.panelVisible) {
            this.button.innerHTML = closeIcon;
            this.button.setAttribute('aria-label', 'Close chat');
          } else {
            this.button.innerHTML = chatIcon;
            this.button.setAttribute('aria-label', 'Open chat');
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
      // Voice mode: mic icons reflecting actual speech state
      switch (state.connection) {
        case ConnectionState.CONNECTED:
          if (state.speechPaused) {
            // Speech paused (TTS playing or text input active)
            this.button.classList.add('paused');
            this.button.innerHTML = micPausedIcon;
            this.button.setAttribute('aria-label', 'Microphone paused');
          } else if (state.speechActive) {
            // Actively recording
            this.button.classList.add('listening');
            this.button.innerHTML = micOffIcon;
            this.button.setAttribute('aria-label', 'Stop voice assistant');
          } else {
            // Connected but speech not active (failed or unavailable).
            // Show paused mic so user knows mic isn't capturing.
            this.button.classList.add('paused');
            this.button.innerHTML = micPausedIcon;
            this.button.setAttribute('aria-label', 'Microphone unavailable — use text input');
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

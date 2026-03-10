import { micIcon, micOffIcon, loaderIcon, chatIcon } from './icons';
import type { ConnectionStateValue } from '../constants';
import { ConnectionState } from '../constants';

export type ButtonClickHandler = () => void;
export type InputMode = 'voice' | 'text';

export class FloatingButton {
  private button: HTMLButtonElement;
  private state: ConnectionStateValue = ConnectionState.DISCONNECTED;
  private onClick: ButtonClickHandler;
  private inputMode: InputMode;

  constructor(parent: HTMLElement, onClick: ButtonClickHandler, inputMode: InputMode = 'voice') {
    this.onClick = onClick;
    this.inputMode = inputMode;

    this.button = document.createElement('button');
    this.button.className = 'vsdk-btn';
    this.button.setAttribute('aria-label', inputMode === 'text' ? 'Open chat' : 'Voice assistant');
    this.button.innerHTML = inputMode === 'text' ? chatIcon : micIcon;
    this.button.addEventListener('click', () => this.onClick());
    parent.appendChild(this.button);
  }

  setState(state: ConnectionStateValue): void {
    this.state = state;

    // Remove all state classes
    this.button.classList.remove('listening', 'connecting');

    if (this.inputMode === 'text') {
      // Text mode: toggle between open/close chat icon
      switch (state) {
        case ConnectionState.CONNECTED:
          this.button.classList.add('listening');
          this.button.innerHTML = chatIcon;
          this.button.setAttribute('aria-label', 'Close chat');
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
      // Voice mode: mic icons
      switch (state) {
        case ConnectionState.CONNECTED:
          this.button.classList.add('listening');
          this.button.innerHTML = micOffIcon;
          this.button.setAttribute('aria-label', 'Stop voice assistant');
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

  getState(): ConnectionStateValue {
    return this.state;
  }

  destroy(): void {
    this.button.remove();
  }
}

import { buildIcon, micIcon, micOffIcon, loaderIcon } from './icons';

export type BuildButtonClickHandler = () => void;

export interface BuildButtonState {
  visible: boolean;
  panelVisible: boolean;
  speechActive: boolean;
  aiThinking: boolean;
}

export class BuildModeButton {
  private button: HTMLButtonElement;
  private onClick: BuildButtonClickHandler;

  constructor(parent: HTMLElement, onClick: BuildButtonClickHandler) {
    this.onClick = onClick;

    this.button = document.createElement('button');
    this.button.className = 'vsdk-btn vsdk-build-mode';
    this.button.setAttribute('aria-label', 'Build mode');
    // Safe: buildIcon is a trusted SVG constant from icons.ts
    this.button.innerHTML = buildIcon;
    this.button.style.display = 'none';
    this.button.addEventListener('click', () => this.onClick());
    // Insert before the main button (first child = main button) so it appears to the left
    if (parent.firstChild) {
      parent.insertBefore(this.button, parent.firstChild);
    } else {
      parent.appendChild(this.button);
    }
  }

  render(state: BuildButtonState): void {
    this.button.style.display = state.visible ? '' : 'none';
    if (!state.visible) return;

    this.button.classList.remove('listening', 'connecting');

    // Safe: all icon values are trusted SVG constants from icons.ts
    if (state.aiThinking) {
      this.button.classList.add('connecting');
      this.button.innerHTML = loaderIcon;
      this.button.setAttribute('aria-label', 'Build mode — generating...');
    } else if (state.panelVisible && state.speechActive) {
      this.button.classList.add('listening');
      this.button.innerHTML = micIcon;
      this.button.setAttribute('aria-label', 'Stop build microphone');
    } else if (state.panelVisible) {
      this.button.innerHTML = micOffIcon;
      this.button.setAttribute('aria-label', 'Start build microphone');
    } else {
      this.button.innerHTML = buildIcon;
      this.button.setAttribute('aria-label', 'Open build panel');
    }
  }

  destroy(): void {
    this.button.remove();
  }
}

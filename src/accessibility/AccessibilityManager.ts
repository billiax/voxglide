import type { AccessibilityConfig } from '../types';

const DEFAULT_A11Y: Required<AccessibilityConfig> = {
  announcements: true,
  highContrast: true,
  ttsRate: 0.85,
  keyboardShortcuts: true,
};

/**
 * Manages accessibility features: ARIA live regions, focus management,
 * keyboard shortcuts, and high contrast mode.
 */
export class AccessibilityManager {
  private config: Required<AccessibilityConfig>;
  private liveRegion: HTMLElement | null = null;
  private abortController = new AbortController();
  private destroyed = false;
  private onToggle: (() => void) | null = null;
  private shadowHost: HTMLElement | null = null;
  private formCursorIndex = -1;

  constructor(
    config: AccessibilityConfig = {},
    onToggle?: () => void,
  ) {
    this.config = { ...DEFAULT_A11Y, ...config };
    this.onToggle = onToggle ?? null;

    if (this.config.announcements) {
      this.createLiveRegion();
    }

    if (this.config.keyboardShortcuts) {
      this.registerKeyboardShortcuts();
    }
  }

  /**
   * Set the Shadow DOM host to apply high contrast class to.
   */
  setShadowHost(host: HTMLElement): void {
    this.shadowHost = host;
    if (this.config.highContrast) {
      host.classList.add('high-contrast');
    }
  }

  /**
   * Create an aria-live region in the light DOM for screen reader announcements.
   * Must be in the light DOM (not Shadow DOM) for screen readers to detect it.
   */
  private createLiveRegion(): void {
    this.liveRegion = document.createElement('div');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.liveRegion.setAttribute('aria-atomic', 'true');
    this.liveRegion.setAttribute('role', 'status');
    this.liveRegion.setAttribute('data-voice-sdk', 'live-region');
    this.liveRegion.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
    document.body.appendChild(this.liveRegion);
  }

  /**
   * Announce a message to screen readers via the aria-live region.
   */
  announce(message: string): void {
    if (this.destroyed || !this.liveRegion) return;
    // Clear and re-set to trigger screen reader announcement
    this.liveRegion.textContent = '';
    requestAnimationFrame(() => {
      if (this.liveRegion) {
        this.liveRegion.textContent = message;
      }
    });
  }

  /**
   * Announce the result of a tool action (e.g. "Filled field email").
   */
  announceAction(toolName: string, args: Record<string, unknown>): void {
    let message: string;
    switch (toolName) {
      case 'fillField':
        message = `Filled ${args.fieldId ?? args.index ?? 'field'} with ${args.value}`;
        break;
      case 'clickElement':
        message = `Clicked ${args.description ?? args.index ?? 'element'}`;
        break;
      case 'readContent':
        message = 'Read page content';
        break;
      default:
        message = `Executed ${toolName}`;
    }
    this.announce(message);
  }

  /**
   * Move focus to a DOM element. Adds tabindex if needed.
   */
  focusElement(el: HTMLElement): void {
    if (!el.hasAttribute('tabindex') && !el.matches('a, button, input, select, textarea, [tabindex]')) {
      el.setAttribute('tabindex', '-1');
    }
    el.focus();
  }

  /**
   * Register keyboard shortcuts.
   */
  private registerKeyboardShortcuts(): void {
    const signal = this.abortController.signal;

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // Alt+V: toggle SDK on/off
      if (e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.onToggle?.();
        return;
      }

      // Escape: return focus to page
      if (e.key === 'Escape') {
        const active = document.activeElement as HTMLElement;
        if (active?.closest?.('[data-voice-sdk]')) {
          active.blur();
          document.body.focus();
        }
      }
    }, { signal });
  }

  /**
   * Get the configured TTS speech rate.
   */
  getTtsRate(): number {
    return this.config.ttsRate;
  }

  /**
   * Get/set the form navigation cursor index.
   */
  getFormCursor(): number {
    return this.formCursorIndex;
  }

  setFormCursor(index: number): void {
    this.formCursorIndex = index;
  }

  /**
   * Whether high contrast mode is enabled.
   */
  isHighContrast(): boolean {
    return this.config.highContrast;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abortController.abort();
    this.liveRegion?.remove();
    this.liveRegion = null;
    if (this.shadowHost) {
      this.shadowHost.classList.remove('high-contrast');
      this.shadowHost = null;
    }
  }
}

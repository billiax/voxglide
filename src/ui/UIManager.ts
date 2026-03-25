import type { UIConfig, TranscriptEvent } from '../types';
import type { QueueState } from '../ai/types';
import type { ConnectionStateValue } from '../constants';
import { ConnectionState, DEFAULT_UI } from '../constants';
import { buildStyles } from './styles';
import { resolveTheme } from './themes';
import { FloatingButton } from './FloatingButton';
import { BuildModeButton } from './BuildModeButton';
import type { BuildButtonState } from './BuildModeButton';
import { TranscriptOverlay } from './TranscriptOverlay';
import { SettingsPanel } from './SettingsPanel';
import { UIStateMachine } from './UIStateMachine';
import type { PauseReason } from './UIStateMachine';
import type { InputMode } from './FloatingButton';

export class UIManager {
  private host: HTMLElement;
  private shadowRoot: ShadowRoot;
  private wrapper: HTMLElement;
  private styleEl: HTMLStyleElement;
  private button: FloatingButton;
  private transcript: TranscriptOverlay | null = null;
  private settingsPanel: SettingsPanel | null = null;
  private config: Required<UIConfig>;
  private inputMode: InputMode;
  private abortController = new AbortController();
  private stateMachine: UIStateMachine;
  private destroyed = false;
  private hostGuardInterval: ReturnType<typeof setInterval> | null = null;
  private bodyObserver: MutationObserver | null = null;
  private buildButton: BuildModeButton | null = null;
  private buttonRow: HTMLElement;
  private onBuildToggle: (() => void) | null = null;

  constructor(
    config: UIConfig = {},
    onToggle: () => void,
    onSendText?: (text: string) => void,
    inputMode: InputMode = 'voice',
    onBuildToggle?: () => void,
  ) {
    this.config = { ...DEFAULT_UI, ...config };
    this.inputMode = inputMode;

    // Singleton: remove ALL existing SDK host elements ("last writer wins").
    // querySelectorAll ensures every stale host is cleaned up, not just the first.
    document.querySelectorAll('div[data-voice-sdk]').forEach((el) => el.remove());

    // Create state machine
    this.stateMachine = new UIStateMachine(inputMode);

    // Create Shadow DOM host
    this.host = document.createElement('div');
    this.host.setAttribute('data-voice-sdk', 'true');
    this.host.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: ' + this.config.zIndex;
    document.body.appendChild(this.host);

    this.shadowRoot = this.host.attachShadow({ mode: 'open' });

    // Resolve theme and inject styles
    const resolvedTheme = resolveTheme(this.config);
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = buildStyles(resolvedTheme);
    this.shadowRoot.appendChild(this.styleEl);

    // Set z-index custom property
    this.shadowRoot.host.setAttribute('style', `--vsdk-z-index: ${this.config.zIndex}`);

    // Create wrapper container
    this.wrapper = document.createElement('div');
    this.wrapper.className = `vsdk-container ${this.config.position}`;
    const ox = this.config.offset?.x ?? 20;
    const oy = this.config.offset?.y ?? 20;
    this.wrapper.style.setProperty('--vsdk-ox', `${ox}px`);
    this.wrapper.style.setProperty('--vsdk-oy', `${oy}px`);
    this.shadowRoot.appendChild(this.wrapper);

    // Stop all click/pointer events from leaking through Shadow DOM to the host page.
    // Composed events (click, pointerdown, etc.) propagate across shadow boundaries
    // and can close native modals or trigger handlers on the page behind the SDK UI.
    for (const eventType of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const) {
      this.wrapper.addEventListener(eventType, (e) => {
        e.stopPropagation();
      });
    }

    // Create transcript overlay (before button so it appears above)
    if (this.config.showTranscript) {
      this.transcript = new TranscriptOverlay(this.wrapper, this.config.transcriptAutoHideMs, inputMode);
      if (onSendText) {
        this.transcript.setSendTextHandler(onSendText);
      }
    }

    // Wire up settings panel if enabled
    if (this.config.showSettings && this.transcript) {
      this.transcript.setSettingsClickHandler(() => this.toggleSettings());
    }

    // Create button row container (holds main button + optional build button)
    this.buttonRow = document.createElement('div');
    this.buttonRow.className = 'vsdk-button-row';
    this.wrapper.appendChild(this.buttonRow);

    // Create floating button inside the row
    this.button = new FloatingButton(this.buttonRow, onToggle, inputMode);

    // Store build toggle handler for later
    this.onBuildToggle = onBuildToggle ?? null;

    // Subscribe button to state changes
    this.stateMachine.subscribe((current) => {
      this.button.render(current);
    });

    // Subscribe transcript header visibility to state changes
    this.stateMachine.subscribe((current, previous) => {
      if (!this.transcript) return;
      const wasConnected = previous.connection === ConnectionState.CONNECTED;
      const isConnected = current.connection === ConnectionState.CONNECTED;
      if (wasConnected !== isConnected) {
        this.transcript.setHeaderVisible(isConnected);
      }
    });

    // Subscribe thinking indicator to state changes
    this.stateMachine.subscribe((current, previous) => {
      if (!this.transcript) return;
      if (current.aiThinking !== previous.aiThinking) {
        if (current.aiThinking) {
          this.transcript.showThinkingIndicator();
        } else {
          this.transcript.removeThinkingIndicator();
        }
      }
    });

    // Keyboard shortcut: Ctrl/Cmd+K to focus text input
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.focusInput();
      }
    }, { signal: this.abortController.signal });

    // Start host self-healing: re-attach UI if removed from DOM by SPA navigation
    this.startHostGuard();
  }

  /**
   * Watch for the host element being removed from the DOM and re-attach it.
   * SPAs (React, Vue, Angular) may remove body children during route transitions.
   * Uses MutationObserver for immediate detection + interval as fallback.
   */
  private startHostGuard(): void {
    // MutationObserver detects direct removal of the host from document.body
    if (typeof MutationObserver !== 'undefined') {
      this.bodyObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const removed of mutation.removedNodes) {
            if (removed === this.host) {
              this.ensureAttached();
              return;
            }
          }
        }
      });
      this.bodyObserver.observe(document.body, { childList: true });
    }

    // Fallback interval: covers cases where body.innerHTML is replaced
    // (which disconnects the MutationObserver itself)
    this.hostGuardInterval = setInterval(() => this.ensureAttached(), 500);
  }

  /**
   * Re-attach the host to document.body if it was removed.
   * The Shadow DOM and all its children are preserved in memory.
   */
  ensureAttached(): void {
    if (this.destroyed) return;
    if (!this.host.isConnected) {
      document.body.appendChild(this.host);
      // Re-observe body if the observer was disconnected
      this.bodyObserver?.observe(document.body, { childList: true });
    }
  }

  setConnectionState(state: ConnectionStateValue): void {
    if (this.destroyed) return;
    this.stateMachine.setConnection(state);
  }

  setSpeechState(active: boolean, paused: boolean): void {
    if (this.destroyed) return;
    this.stateMachine.setSpeechState(active, paused);
  }

  setPauseReason(reason: PauseReason): void {
    if (this.destroyed) return;
    this.stateMachine.setPauseReason(reason);
  }

  addTranscript(event: TranscriptEvent): void {
    if (this.destroyed) return;
    this.transcript?.addTranscript(event);
  }

  addSystemMessage(text: string): void {
    if (this.destroyed) return;
    this.transcript?.addSystemMessage(text);
  }

  isPanelVisible(): boolean {
    return this.stateMachine.getState().panelVisible;
  }

  showBuildButton(): void {
    if (this.destroyed || this.buildButton) return;
    if (!this.onBuildToggle) return;
    this.buildButton = new BuildModeButton(this.buttonRow, this.onBuildToggle);
  }

  hideBuildButton(): void {
    this.buildButton?.destroy();
    this.buildButton = null;
  }

  renderBuildButton(state: BuildButtonState): void {
    this.buildButton?.render(state);
  }

  addBuildSystemMessage(text: string): void {
    if (this.destroyed) return;
    this.transcript?.addBuildSystemMessage(text);
  }

  setTranscriptBuildMode(active: boolean, title: string): void {
    if (this.destroyed) return;
    this.transcript?.setPanelTitle(title);
    this.transcript?.setBuildModeDot(active);
    if (active) {
      this.transcript?.setBuildUrl(window.location.href);
    } else {
      this.transcript?.setBuildUrl(null);
    }
  }

  showRefreshButton(): void {
    if (this.destroyed) return;
    this.transcript?.showRefreshButton();
  }

  hideRefreshButton(): void {
    if (this.destroyed) return;
    this.transcript?.hideRefreshButton();
  }

  setRefreshHandler(handler: () => void): void {
    if (this.destroyed) return;
    this.transcript?.setRefreshHandler(handler);
  }

  setToolLoopStatus(text: string | null): void {
    if (this.destroyed) return;
    this.transcript?.setToolLoopStatus(text);
  }

  addPendingTool(
    tool: { name: string; code: string },
    onAccept: () => void,
    onReject: () => void,
  ): void {
    if (this.destroyed) return;
    this.transcript?.addPendingTool(tool, onAccept, onReject);
  }


  showTranscript(): void {
    if (this.destroyed) return;
    this.transcript?.show();
    this.stateMachine.showPanel();
  }

  hideTranscript(): void {
    if (this.destroyed) return;
    this.transcript?.hide();
    this.stateMachine.hidePanel();
  }

  /**
   * Enable or disable auto-hide on the transcript panel.
   * Disabled during active sessions so the panel stays visible.
   */
  setAutoHideEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    this.transcript?.setAutoHideEnabled(enabled);
  }

  clearTranscript(): void {
    if (this.destroyed) return;
    this.transcript?.clear();
  }

  /**
   * Toggle transcript panel visibility (for text mode toggle behavior).
   */
  toggleTranscript(): void {
    if (this.destroyed) return;
    this.transcript?.toggleVisibility();
    this.stateMachine.togglePanel();
  }

  /**
   * Focus the text input in the transcript.
   */
  focusInput(): void {
    if (this.destroyed) return;
    this.transcript?.show();
    this.transcript?.focusInput();
  }

  /**
   * Set AI thinking state — shows/hides animated indicator.
   */
  setAIThinking(thinking: boolean): void {
    if (this.destroyed) return;
    this.stateMachine.setAIThinking(thinking);
  }

  /**
   * Restore transcript lines from sessionStorage.
   */
  restoreTranscript(): void {
    if (this.destroyed) return;
    this.transcript?.restoreTranscript();
  }

  /**
   * Update the queue panel display.
   */
  updateQueue(queue: QueueState): void {
    if (this.destroyed) return;
    this.transcript?.updateQueue(queue);
  }

  /**
   * Set a handler for cancel buttons in the queue panel.
   */
  setCancelHandler(handler: (turnId: string) => void): void {
    if (this.destroyed) return;
    this.transcript?.setCancelHandler(handler);
  }

  /**
   * Set a handler for the panel disconnect/end-session button.
   */
  setDisconnectHandler(handler: () => void): void {
    if (this.destroyed) return;
    this.transcript?.setDisconnectHandler(handler);
  }

  /**
   * Set a handler for the panel minimize button.
   */
  setMinimizeHandler(handler: () => void): void {
    if (this.destroyed) return;
    this.transcript?.setMinimizeHandler(handler);
  }

  /**
   * Get the UI state machine (for advanced usage).
   */
  getStateMachine(): UIStateMachine {
    return this.stateMachine;
  }

  /**
   * Get the Shadow DOM host element.
   */
  getHost(): HTMLElement {
    return this.host;
  }

  /**
   * Toggle the settings panel open/closed.
   */
  private toggleSettings(): void {
    if (this.destroyed || !this.transcript) return;

    if (this.transcript.isSettingsOpen()) {
      this.settingsPanel?.destroy();
      this.settingsPanel = null;
      this.transcript.hideSettingsView();
    } else {
      this.settingsPanel = new SettingsPanel(
        this.config,
        (patch) => this.updateConfig(patch),
        () => this.toggleSettings(),
      );
      this.transcript.showSettingsView(this.settingsPanel.getElement());
    }
  }

  /**
   * Apply a partial config update at runtime.
   * Immediately updates position, offset, and theme in the live UI.
   */
  updateConfig(patch: Partial<UIConfig>): void {
    if (this.destroyed) return;

    // Merge position
    if (patch.position) {
      this.config.position = patch.position;
      this.wrapper.className = `vsdk-container ${this.config.position}`;
    }

    // Merge offset
    if (patch.offset) {
      this.config.offset = { ...this.config.offset, ...patch.offset };
      const ox = this.config.offset.x ?? 20;
      const oy = this.config.offset.y ?? 20;
      this.wrapper.style.setProperty('--vsdk-ox', `${ox}px`);
      this.wrapper.style.setProperty('--vsdk-oy', `${oy}px`);
    }

    // Merge theme (deep merge colors)
    if (patch.theme) {
      const prev = this.config.theme ?? {};
      this.config.theme = {
        ...prev,
        ...patch.theme,
        colors: patch.theme.colors
          ? { ...prev.colors, ...patch.theme.colors }
          : prev.colors,
      };

      // Rebuild CSS from resolved theme
      const resolved = resolveTheme(this.config);
      this.styleEl.textContent = buildStyles(resolved);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abortController.abort();
    if (this.hostGuardInterval) {
      clearInterval(this.hostGuardInterval);
      this.hostGuardInterval = null;
    }
    this.bodyObserver?.disconnect();
    this.bodyObserver = null;
    this.stateMachine.markDestroyed();
    this.settingsPanel?.destroy();
    this.settingsPanel = null;
    this.buildButton?.destroy();
    this.buildButton = null;
    this.button.destroy();
    this.transcript?.destroy();
    this.host.remove();
  }
}

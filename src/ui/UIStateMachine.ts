import type { ConnectionStateValue } from '../constants';
import { ConnectionState } from '../constants';
import type { InputMode } from './FloatingButton';

export interface UIState {
  connection: ConnectionStateValue;
  panelVisible: boolean;
  inputMode: InputMode;
  aiThinking: boolean;
  activeTool: string | null;
  speechActive: boolean;
  speechPaused: boolean;
  destroyed: boolean;
}

export type UIStateListener = (current: Readonly<UIState>, previous: Readonly<UIState>) => void;

export class UIStateMachine {
  private state: UIState;
  private listeners: Set<UIStateListener> = new Set();

  constructor(inputMode: InputMode) {
    this.state = {
      connection: ConnectionState.DISCONNECTED,
      panelVisible: inputMode === 'text',
      inputMode,
      aiThinking: false,
      activeTool: null,
      speechActive: false,
      speechPaused: false,
      destroyed: false,
    };
  }

  getState(): Readonly<UIState> {
    return { ...this.state };
  }

  subscribe(listener: UIStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setConnection(connection: ConnectionStateValue): void {
    if (this.state.destroyed) return;
    if (this.state.connection === connection) return;
    const previous = { ...this.state };
    this.state = { ...this.state, connection };
    // Auto-show panel on connected
    if (connection === ConnectionState.CONNECTED) {
      this.state.panelVisible = true;
    }
    // Reset speech state on disconnect/error
    if (connection === ConnectionState.DISCONNECTED || connection === ConnectionState.ERROR) {
      this.state.speechActive = false;
      this.state.speechPaused = false;
    }
    this.notify(previous);
  }

  setSpeechState(active: boolean, paused: boolean): void {
    if (this.state.destroyed) return;
    if (this.state.speechActive === active && this.state.speechPaused === paused) return;
    const previous = { ...this.state };
    this.state = { ...this.state, speechActive: active, speechPaused: paused };
    this.notify(previous);
  }

  showPanel(): void {
    if (this.state.destroyed) return;
    if (this.state.panelVisible) return;
    const previous = { ...this.state };
    this.state = { ...this.state, panelVisible: true };
    this.notify(previous);
  }

  hidePanel(): void {
    if (this.state.destroyed) return;
    if (!this.state.panelVisible) return;
    const previous = { ...this.state };
    this.state = { ...this.state, panelVisible: false };
    this.notify(previous);
  }

  togglePanel(): void {
    if (this.state.destroyed) return;
    const previous = { ...this.state };
    this.state = { ...this.state, panelVisible: !this.state.panelVisible };
    this.notify(previous);
  }

  setAIThinking(aiThinking: boolean): void {
    if (this.state.destroyed) return;
    if (this.state.aiThinking === aiThinking) return;
    const previous = { ...this.state };
    this.state = { ...this.state, aiThinking };
    this.notify(previous);
  }

  setActiveTool(activeTool: string | null): void {
    if (this.state.destroyed) return;
    const previous = { ...this.state };
    this.state = { ...this.state, activeTool };
    this.notify(previous);
  }

  markDestroyed(): void {
    if (this.state.destroyed) return;
    const previous = { ...this.state };
    this.state = { ...this.state, destroyed: true };
    this.notify(previous);
    this.listeners.clear();
  }

  private notify(previous: Readonly<UIState>): void {
    const current = this.getState();
    for (const listener of this.listeners) {
      listener(current, previous);
    }
  }
}

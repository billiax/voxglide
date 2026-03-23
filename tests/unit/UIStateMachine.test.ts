import { describe, it, expect, vi } from 'vitest';
import { UIStateMachine } from '../../src/ui/UIStateMachine';
import { ConnectionState } from '../../src/constants';

describe('UIStateMachine', () => {
  describe('initial state', () => {
    it('starts with DISCONNECTED, panel hidden, no thinking, speech inactive', () => {
      const sm = new UIStateMachine('voice');
      const state = sm.getState();
      expect(state.connection).toBe(ConnectionState.DISCONNECTED);
      expect(state.panelVisible).toBe(false);
      expect(state.inputMode).toBe('voice');
      expect(state.aiThinking).toBe(false);
      expect(state.activeTool).toBeNull();
      expect(state.speechActive).toBe(false);
      expect(state.speechPaused).toBe(false);
      expect(state.pauseReason).toBeNull();
      expect(state.destroyed).toBe(false);
    });

    it('respects text input mode', () => {
      const sm = new UIStateMachine('text');
      expect(sm.getState().inputMode).toBe('text');
    });
  });

  describe('setConnection()', () => {
    it('updates connection state', () => {
      const sm = new UIStateMachine('voice');
      sm.setConnection(ConnectionState.CONNECTING);
      expect(sm.getState().connection).toBe(ConnectionState.CONNECTING);
    });

    it('does not auto-set panelVisible when connected', () => {
      const sm = new UIStateMachine('voice');
      expect(sm.getState().panelVisible).toBe(false);
      sm.setConnection(ConnectionState.CONNECTED);
      expect(sm.getState().panelVisible).toBe(false);
    });

    it('resets speech state and pauseReason on disconnect', () => {
      const sm = new UIStateMachine('voice');
      sm.setConnection(ConnectionState.CONNECTED);
      sm.setSpeechState(true, false);
      sm.setPauseReason('tts');
      expect(sm.getState().speechActive).toBe(true);
      expect(sm.getState().pauseReason).toBe('tts');

      sm.setConnection(ConnectionState.DISCONNECTED);
      expect(sm.getState().speechActive).toBe(false);
      expect(sm.getState().speechPaused).toBe(false);
      expect(sm.getState().pauseReason).toBeNull();
    });

    it('resets speech state and pauseReason on error', () => {
      const sm = new UIStateMachine('voice');
      sm.setConnection(ConnectionState.CONNECTED);
      sm.setSpeechState(true, true);
      sm.setPauseReason('mic-error');

      sm.setConnection(ConnectionState.ERROR);
      expect(sm.getState().speechActive).toBe(false);
      expect(sm.getState().speechPaused).toBe(false);
      expect(sm.getState().pauseReason).toBeNull();
    });

    it('does nothing when destroyed', () => {
      const sm = new UIStateMachine('voice');
      sm.markDestroyed();
      sm.setConnection(ConnectionState.CONNECTED);
      expect(sm.getState().connection).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('setSpeechState()', () => {
    it('sets speech active and paused state', () => {
      const sm = new UIStateMachine('voice');
      sm.setSpeechState(true, false);
      expect(sm.getState().speechActive).toBe(true);
      expect(sm.getState().speechPaused).toBe(false);
    });

    it('sets speech paused', () => {
      const sm = new UIStateMachine('voice');
      sm.setSpeechState(true, true);
      expect(sm.getState().speechActive).toBe(true);
      expect(sm.getState().speechPaused).toBe(true);
    });

    it('notifies listeners', () => {
      const sm = new UIStateMachine('voice');
      const listener = vi.fn();
      sm.subscribe(listener);

      sm.setSpeechState(true, false);
      expect(listener).toHaveBeenCalledTimes(1);
      const [current, previous] = listener.mock.calls[0];
      expect(current.speechActive).toBe(true);
      expect(previous.speechActive).toBe(false);
    });

    it('does not notify when state unchanged', () => {
      const sm = new UIStateMachine('voice');
      const listener = vi.fn();
      sm.subscribe(listener);

      sm.setSpeechState(false, false); // same as initial
      expect(listener).not.toHaveBeenCalled();
    });

    it('does nothing when destroyed', () => {
      const sm = new UIStateMachine('voice');
      sm.markDestroyed();
      sm.setSpeechState(true, false);
      expect(sm.getState().speechActive).toBe(false);

      sm.setPauseReason('tts');
      expect(sm.getState().pauseReason).toBeNull();
    });
  });

  describe('setPauseReason()', () => {
    it('sets pauseReason to tts', () => {
      const sm = new UIStateMachine('voice');
      sm.setPauseReason('tts');
      expect(sm.getState().pauseReason).toBe('tts');
    });

    it('sets pauseReason to mic-error', () => {
      const sm = new UIStateMachine('voice');
      sm.setPauseReason('mic-error');
      expect(sm.getState().pauseReason).toBe('mic-error');
    });

    it('clears pauseReason with null', () => {
      const sm = new UIStateMachine('voice');
      sm.setPauseReason('tts');
      sm.setPauseReason(null);
      expect(sm.getState().pauseReason).toBeNull();
    });

    it('notifies listeners', () => {
      const sm = new UIStateMachine('voice');
      const listener = vi.fn();
      sm.subscribe(listener);

      sm.setPauseReason('tts');
      expect(listener).toHaveBeenCalledTimes(1);
      const [current, previous] = listener.mock.calls[0];
      expect(current.pauseReason).toBe('tts');
      expect(previous.pauseReason).toBeNull();
    });

    it('does not notify when pauseReason unchanged', () => {
      const sm = new UIStateMachine('voice');
      const listener = vi.fn();
      sm.subscribe(listener);

      sm.setPauseReason(null); // same as initial
      expect(listener).not.toHaveBeenCalled();
    });

    it('does nothing when destroyed', () => {
      const sm = new UIStateMachine('voice');
      sm.markDestroyed();
      sm.setPauseReason('tts');
      expect(sm.getState().pauseReason).toBeNull();
    });
  });

  describe('panel visibility', () => {
    it('showPanel sets panelVisible true', () => {
      const sm = new UIStateMachine('voice');
      sm.showPanel();
      expect(sm.getState().panelVisible).toBe(true);
    });

    it('hidePanel sets panelVisible false', () => {
      const sm = new UIStateMachine('voice');
      sm.showPanel();
      sm.hidePanel();
      expect(sm.getState().panelVisible).toBe(false);
    });

    it('togglePanel flips visibility', () => {
      const sm = new UIStateMachine('voice');
      sm.togglePanel();
      expect(sm.getState().panelVisible).toBe(true);
      sm.togglePanel();
      expect(sm.getState().panelVisible).toBe(false);
    });
  });

  describe('setAIThinking()', () => {
    it('sets aiThinking state', () => {
      const sm = new UIStateMachine('voice');
      sm.setAIThinking(true);
      expect(sm.getState().aiThinking).toBe(true);
      sm.setAIThinking(false);
      expect(sm.getState().aiThinking).toBe(false);
    });
  });

  describe('setActiveTool()', () => {
    it('sets and clears active tool', () => {
      const sm = new UIStateMachine('voice');
      sm.setActiveTool('fillField');
      expect(sm.getState().activeTool).toBe('fillField');
      sm.setActiveTool(null);
      expect(sm.getState().activeTool).toBeNull();
    });
  });

  describe('subscribe()', () => {
    it('notifies listeners on state changes', () => {
      const sm = new UIStateMachine('voice');
      const listener = vi.fn();
      sm.subscribe(listener);

      sm.setConnection(ConnectionState.CONNECTING);
      expect(listener).toHaveBeenCalledTimes(1);
      const [current, previous] = listener.mock.calls[0];
      expect(current.connection).toBe(ConnectionState.CONNECTING);
      expect(previous.connection).toBe(ConnectionState.DISCONNECTED);
    });

    it('returns unsubscribe function', () => {
      const sm = new UIStateMachine('voice');
      const listener = vi.fn();
      const unsub = sm.subscribe(listener);

      sm.showPanel();
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      sm.hidePanel();
      expect(listener).toHaveBeenCalledTimes(1); // not called again
    });

    it('does not notify when state has not changed', () => {
      const sm = new UIStateMachine('voice');
      const listener = vi.fn();
      sm.subscribe(listener);

      sm.setConnection(ConnectionState.DISCONNECTED); // same as initial
      expect(listener).not.toHaveBeenCalled();
    });

    it('receives current and previous state', () => {
      const sm = new UIStateMachine('voice');
      const listener = vi.fn();
      sm.subscribe(listener);

      sm.setConnection(ConnectionState.CONNECTED);
      expect(listener).toHaveBeenCalledTimes(1);
      const [current, previous] = listener.mock.calls[0];
      expect(current.connection).toBe(ConnectionState.CONNECTED);
      expect(previous.connection).toBe(ConnectionState.DISCONNECTED);
      // setConnection(CONNECTED) no longer auto-sets panelVisible
      expect(current.panelVisible).toBe(false);
    });
  });

  describe('markDestroyed()', () => {
    it('sets destroyed flag', () => {
      const sm = new UIStateMachine('voice');
      sm.markDestroyed();
      expect(sm.getState().destroyed).toBe(true);
    });

    it('prevents further state changes', () => {
      const sm = new UIStateMachine('voice');
      sm.markDestroyed();

      sm.showPanel();
      expect(sm.getState().panelVisible).toBe(false);

      sm.setAIThinking(true);
      expect(sm.getState().aiThinking).toBe(false);

      sm.setActiveTool('test');
      expect(sm.getState().activeTool).toBeNull();

      sm.setSpeechState(true, false);
      expect(sm.getState().speechActive).toBe(false);
    });

    it('does not notify listeners after destroyed', () => {
      const sm = new UIStateMachine('voice');
      const listener = vi.fn();
      sm.subscribe(listener);

      sm.markDestroyed();
      listener.mockClear();

      sm.showPanel();
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

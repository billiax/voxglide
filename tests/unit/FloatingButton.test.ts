import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FloatingButton } from '../../src/ui/FloatingButton';
import { ConnectionState } from '../../src/constants';
import { micIcon, micOffIcon, micPausedIcon, loaderIcon, chatIcon, closeIcon } from '../../src/ui/icons';
import type { UIState } from '../../src/ui/UIStateMachine';

/**
 * jsdom normalizes self-closing SVG tags (e.g. `<path ... />` -> `<path ...></path>`).
 * To compare innerHTML reliably, we normalize the source SVG strings through the DOM
 * the same way the browser does.
 */
function domNormalize(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.innerHTML;
}

function makeState(overrides: Partial<UIState> = {}): Readonly<UIState> {
  return {
    connection: ConnectionState.DISCONNECTED,
    panelVisible: false,
    inputMode: 'voice',
    aiThinking: false,
    activeTool: null,
    speechActive: false,
    speechPaused: false,
    pauseReason: null,
    destroyed: false,
    ...overrides,
  };
}

describe('FloatingButton', () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });

  afterEach(() => {
    parent.remove();
  });

  function getButton(): HTMLButtonElement {
    return parent.querySelector('button')!;
  }

  describe('constructor', () => {
    it('creates a button element in the parent', () => {
      new FloatingButton(parent, vi.fn());
      expect(getButton()).not.toBeNull();
      expect(getButton().tagName).toBe('BUTTON');
    });

    it('applies vsdk-btn class', () => {
      new FloatingButton(parent, vi.fn());
      expect(getButton().classList.contains('vsdk-btn')).toBe(true);
    });

    it('defaults to voice mode with mic icon', () => {
      new FloatingButton(parent, vi.fn());
      expect(getButton().innerHTML).toBe(domNormalize(micIcon));
    });

    it('defaults to voice mode aria-label', () => {
      new FloatingButton(parent, vi.fn());
      expect(getButton().getAttribute('aria-label')).toBe('Voice assistant');
    });

    it('uses chat icon in text mode', () => {
      new FloatingButton(parent, vi.fn(), 'text');
      expect(getButton().innerHTML).toBe(domNormalize(chatIcon));
    });

    it('uses text mode aria-label', () => {
      new FloatingButton(parent, vi.fn(), 'text');
      expect(getButton().getAttribute('aria-label')).toBe('Open chat');
    });
  });

  describe('click handler', () => {
    it('fires the callback on click', () => {
      const onClick = vi.fn();
      new FloatingButton(parent, onClick);
      getButton().click();
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('fires on multiple clicks', () => {
      const onClick = vi.fn();
      new FloatingButton(parent, onClick);
      getButton().click();
      getButton().click();
      getButton().click();
      expect(onClick).toHaveBeenCalledTimes(3);
    });
  });

  describe('render() -- voice mode', () => {
    let fb: FloatingButton;

    beforeEach(() => {
      fb = new FloatingButton(parent, vi.fn(), 'voice');
    });

    it('DISCONNECTED: shows mic icon', () => {
      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.DISCONNECTED }));
      expect(getButton().innerHTML).toBe(domNormalize(micIcon));
    });

    it('DISCONNECTED: sets aria-label to "Start voice assistant"', () => {
      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.DISCONNECTED }));
      expect(getButton().getAttribute('aria-label')).toBe('Start voice assistant');
    });

    it('DISCONNECTED: has no state classes', () => {
      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.DISCONNECTED }));
      expect(getButton().classList.contains('listening')).toBe(false);
      expect(getButton().classList.contains('connecting')).toBe(false);
      expect(getButton().classList.contains('paused')).toBe(false);
    });

    it('CONNECTING: shows loader icon', () => {
      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.CONNECTING }));
      expect(getButton().innerHTML).toBe(domNormalize(loaderIcon));
    });

    it('CONNECTING: adds connecting class', () => {
      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.CONNECTING }));
      expect(getButton().classList.contains('connecting')).toBe(true);
    });

    it('CONNECTING: sets aria-label to "Connecting..."', () => {
      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.CONNECTING }));
      expect(getButton().getAttribute('aria-label')).toBe('Connecting...');
    });

    it('CONNECTED + speechActive + panel visible: shows micOff icon', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: false,
        panelVisible: true,
      }));
      expect(getButton().innerHTML).toBe(domNormalize(micOffIcon));
    });

    it('CONNECTED + speechActive + panel hidden: shows mic icon', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: false,
        panelVisible: false,
      }));
      expect(getButton().innerHTML).toBe(domNormalize(micIcon));
    });

    it('CONNECTED + speechActive: adds listening class', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: false,
      }));
      expect(getButton().classList.contains('listening')).toBe(true);
    });

    it('CONNECTED + speechActive + panel visible: sets aria-label to "Stop voice assistant"', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: false,
        panelVisible: true,
      }));
      expect(getButton().getAttribute('aria-label')).toBe('Stop voice assistant');
    });

    it('CONNECTED + speechActive + panel hidden: sets aria-label to "Show transcript"', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: false,
        panelVisible: false,
      }));
      expect(getButton().getAttribute('aria-label')).toBe('Show transcript');
    });

    it('CONNECTED + speechPaused: shows micPaused icon', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: true,
      }));
      expect(getButton().innerHTML).toBe(domNormalize(micPausedIcon));
    });

    it('CONNECTED + speechPaused: adds paused class', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: true,
      }));
      expect(getButton().classList.contains('paused')).toBe(true);
    });

    it('CONNECTED + speechPaused (no reason): sets aria-label to "Microphone paused"', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: true,
        pauseReason: null,
      }));
      expect(getButton().getAttribute('aria-label')).toBe('Microphone paused');
    });

    it('CONNECTED + speechPaused (tts): sets aria-label to "Microphone paused — AI speaking"', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: true,
        pauseReason: 'tts',
      }));
      expect(getButton().getAttribute('aria-label')).toBe('Microphone paused — AI speaking');
    });

    it('CONNECTED + speechPaused (mic-error): sets aria-label to "Microphone error — retrying"', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: true,
        pauseReason: 'mic-error',
      }));
      expect(getButton().getAttribute('aria-label')).toBe('Microphone error — retrying');
    });

    it('CONNECTED + speech not active and not paused: shows micPaused icon (unavailable)', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: false,
        speechPaused: false,
      }));
      expect(getButton().innerHTML).toBe(domNormalize(micPausedIcon));
    });

    it('CONNECTED + speech not active: adds paused class', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: false,
        speechPaused: false,
      }));
      expect(getButton().classList.contains('paused')).toBe(true);
    });

    it('CONNECTED + speech not active: sets aria-label for unavailable mic', () => {
      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: false,
        speechPaused: false,
      }));
      expect(getButton().getAttribute('aria-label')).toContain('unavailable');
    });

    it('ERROR: shows mic icon (default)', () => {
      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.ERROR }));
      expect(getButton().innerHTML).toBe(domNormalize(micIcon));
    });

    it('ERROR: sets aria-label to "Start voice assistant"', () => {
      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.ERROR }));
      expect(getButton().getAttribute('aria-label')).toBe('Start voice assistant');
    });

    it('ERROR: has no state classes', () => {
      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.ERROR }));
      expect(getButton().classList.contains('listening')).toBe(false);
      expect(getButton().classList.contains('connecting')).toBe(false);
      expect(getButton().classList.contains('paused')).toBe(false);
    });
  });

  describe('render() -- text mode', () => {
    let fb: FloatingButton;

    beforeEach(() => {
      fb = new FloatingButton(parent, vi.fn(), 'text');
    });

    it('DISCONNECTED: shows chat icon', () => {
      fb.render(makeState({ inputMode: 'text', connection: ConnectionState.DISCONNECTED }));
      expect(getButton().innerHTML).toBe(domNormalize(chatIcon));
    });

    it('DISCONNECTED: sets aria-label to "Open chat"', () => {
      fb.render(makeState({ inputMode: 'text', connection: ConnectionState.DISCONNECTED }));
      expect(getButton().getAttribute('aria-label')).toBe('Open chat');
    });

    it('CONNECTING: shows loader icon', () => {
      fb.render(makeState({ inputMode: 'text', connection: ConnectionState.CONNECTING }));
      expect(getButton().innerHTML).toBe(domNormalize(loaderIcon));
    });

    it('CONNECTING: adds connecting class', () => {
      fb.render(makeState({ inputMode: 'text', connection: ConnectionState.CONNECTING }));
      expect(getButton().classList.contains('connecting')).toBe(true);
    });

    it('CONNECTING: sets aria-label to "Connecting..."', () => {
      fb.render(makeState({ inputMode: 'text', connection: ConnectionState.CONNECTING }));
      expect(getButton().getAttribute('aria-label')).toBe('Connecting...');
    });

    it('CONNECTED + panel hidden: shows chat icon', () => {
      fb.render(makeState({
        inputMode: 'text',
        connection: ConnectionState.CONNECTED,
        panelVisible: false,
      }));
      expect(getButton().innerHTML).toBe(domNormalize(chatIcon));
    });

    it('CONNECTED + panel hidden: sets aria-label to "Open chat"', () => {
      fb.render(makeState({
        inputMode: 'text',
        connection: ConnectionState.CONNECTED,
        panelVisible: false,
      }));
      expect(getButton().getAttribute('aria-label')).toBe('Open chat');
    });

    it('CONNECTED + panel visible: shows close icon', () => {
      fb.render(makeState({
        inputMode: 'text',
        connection: ConnectionState.CONNECTED,
        panelVisible: true,
      }));
      expect(getButton().innerHTML).toBe(domNormalize(closeIcon));
    });

    it('CONNECTED + panel visible: sets aria-label to "Close chat"', () => {
      fb.render(makeState({
        inputMode: 'text',
        connection: ConnectionState.CONNECTED,
        panelVisible: true,
      }));
      expect(getButton().getAttribute('aria-label')).toBe('Close chat');
    });

    it('CONNECTED: adds listening class', () => {
      fb.render(makeState({
        inputMode: 'text',
        connection: ConnectionState.CONNECTED,
      }));
      expect(getButton().classList.contains('listening')).toBe(true);
    });
  });

  describe('state transitions', () => {
    it('CONNECTED with speech -> CONNECTED with speechPaused transitions icon', () => {
      const fb = new FloatingButton(parent, vi.fn(), 'voice');

      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: false,
        panelVisible: true,
      }));
      expect(getButton().innerHTML).toBe(domNormalize(micOffIcon));
      expect(getButton().classList.contains('listening')).toBe(true);

      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: true,
        panelVisible: true,
      }));
      expect(getButton().innerHTML).toBe(domNormalize(micPausedIcon));
      expect(getButton().classList.contains('paused')).toBe(true);
      expect(getButton().classList.contains('listening')).toBe(false);
    });

    it('CONNECTING -> CONNECTED updates icon and classes', () => {
      const fb = new FloatingButton(parent, vi.fn(), 'voice');

      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.CONNECTING }));
      expect(getButton().innerHTML).toBe(domNormalize(loaderIcon));
      expect(getButton().classList.contains('connecting')).toBe(true);

      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        panelVisible: true,
      }));
      expect(getButton().innerHTML).toBe(domNormalize(micOffIcon));
      expect(getButton().classList.contains('connecting')).toBe(false);
      expect(getButton().classList.contains('listening')).toBe(true);
    });

    it('CONNECTED -> DISCONNECTED resets to idle state', () => {
      const fb = new FloatingButton(parent, vi.fn(), 'voice');

      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
      }));
      expect(getButton().classList.contains('listening')).toBe(true);

      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.DISCONNECTED }));
      expect(getButton().innerHTML).toBe(domNormalize(micIcon));
      expect(getButton().classList.contains('listening')).toBe(false);
    });

    it('CONNECTED -> ERROR resets to idle state', () => {
      const fb = new FloatingButton(parent, vi.fn(), 'voice');

      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
      }));

      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.ERROR }));
      expect(getButton().innerHTML).toBe(domNormalize(micIcon));
      expect(getButton().classList.contains('listening')).toBe(false);
      expect(getButton().classList.contains('paused')).toBe(false);
    });

    it('text mode: panel visible -> hidden toggles icon', () => {
      const fb = new FloatingButton(parent, vi.fn(), 'text');

      fb.render(makeState({
        inputMode: 'text',
        connection: ConnectionState.CONNECTED,
        panelVisible: true,
      }));
      expect(getButton().innerHTML).toBe(domNormalize(closeIcon));

      fb.render(makeState({
        inputMode: 'text',
        connection: ConnectionState.CONNECTED,
        panelVisible: false,
      }));
      expect(getButton().innerHTML).toBe(domNormalize(chatIcon));
    });
  });

  describe('CSS classes', () => {
    it('always has vsdk-btn class', () => {
      const fb = new FloatingButton(parent, vi.fn());
      expect(getButton().classList.contains('vsdk-btn')).toBe(true);

      // After render
      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.CONNECTED, speechActive: true }));
      expect(getButton().classList.contains('vsdk-btn')).toBe(true);
    });

    it('removes previous state classes on re-render', () => {
      const fb = new FloatingButton(parent, vi.fn(), 'voice');

      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.CONNECTING }));
      expect(getButton().classList.contains('connecting')).toBe(true);

      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
      }));
      expect(getButton().classList.contains('connecting')).toBe(false);
      expect(getButton().classList.contains('listening')).toBe(true);
    });

    it('only one state class at a time', () => {
      const fb = new FloatingButton(parent, vi.fn(), 'voice');

      // Cycle through all states and verify only one is set
      fb.render(makeState({ inputMode: 'voice', connection: ConnectionState.CONNECTING }));
      expect(getButton().classList.contains('connecting')).toBe(true);
      expect(getButton().classList.contains('listening')).toBe(false);
      expect(getButton().classList.contains('paused')).toBe(false);

      fb.render(makeState({
        inputMode: 'voice',
        connection: ConnectionState.CONNECTED,
        speechActive: true,
        speechPaused: true,
      }));
      expect(getButton().classList.contains('connecting')).toBe(false);
      expect(getButton().classList.contains('listening')).toBe(false);
      expect(getButton().classList.contains('paused')).toBe(true);
    });
  });

  describe('destroy()', () => {
    it('removes the button from the DOM', () => {
      const fb = new FloatingButton(parent, vi.fn());
      expect(getButton()).not.toBeNull();
      fb.destroy();
      expect(parent.querySelector('button')).toBeNull();
    });
  });
});

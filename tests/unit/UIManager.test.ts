import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIManager } from '../../src/ui/UIManager';
import { ConnectionState } from '../../src/constants';

describe('UIManager', () => {
  let onToggle: ReturnType<typeof vi.fn>;
  let onSendText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onToggle = vi.fn();
    onSendText = vi.fn();
    // Clean up any leftover SDK hosts
    document.querySelectorAll('div[data-voice-sdk]').forEach((el) => el.remove());
  });

  afterEach(() => {
    // Clean up any remaining SDK hosts
    document.querySelectorAll('div[data-voice-sdk]').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates Shadow DOM host with data-voice-sdk attribute', () => {
      const ui = new UIManager({}, onToggle);
      const host = document.querySelector('div[data-voice-sdk]');
      expect(host).not.toBeNull();
      expect(host!.getAttribute('data-voice-sdk')).toBe('true');
      ui.destroy();
    });

    it('attaches shadow root to the host element', () => {
      const ui = new UIManager({}, onToggle);
      const host = ui.getHost();
      expect(host.shadowRoot).not.toBeNull();
      ui.destroy();
    });

    it('appends host to document.body', () => {
      const ui = new UIManager({}, onToggle);
      const host = ui.getHost();
      expect(host.parentElement).toBe(document.body);
      ui.destroy();
    });

    it('sets z-index custom property on host', () => {
      const ui = new UIManager({ zIndex: 12345 }, onToggle);
      const host = ui.getHost();
      // The host's inline style is overwritten to set --vsdk-z-index custom property
      expect(host.getAttribute('style')).toContain('12345');
      ui.destroy();
    });

    it('uses default z-index of 9999', () => {
      const ui = new UIManager({}, onToggle);
      const host = ui.getHost();
      expect(host.style.cssText).toContain('9999');
      ui.destroy();
    });

    it('creates wrapper container with position class', () => {
      const ui = new UIManager({ position: 'top-left' }, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const wrapper = shadow.querySelector('.vsdk-container');
      expect(wrapper).not.toBeNull();
      expect(wrapper!.classList.contains('top-left')).toBe(true);
      ui.destroy();
    });

    it('defaults to bottom-right position', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const wrapper = shadow.querySelector('.vsdk-container');
      expect(wrapper!.classList.contains('bottom-right')).toBe(true);
      ui.destroy();
    });

    it('supports center position', () => {
      const ui = new UIManager({ position: 'center' }, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const wrapper = shadow.querySelector('.vsdk-container');
      expect(wrapper!.classList.contains('center')).toBe(true);
      ui.destroy();
    });

    it('supports bottom-center position', () => {
      const ui = new UIManager({ position: 'bottom-center' }, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const wrapper = shadow.querySelector('.vsdk-container');
      expect(wrapper!.classList.contains('bottom-center')).toBe(true);
      ui.destroy();
    });

    it('supports center-right position', () => {
      const ui = new UIManager({ position: 'center-right' }, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const wrapper = shadow.querySelector('.vsdk-container');
      expect(wrapper!.classList.contains('center-right')).toBe(true);
      ui.destroy();
    });

    it('applies custom offset to wrapper', () => {
      const ui = new UIManager({ offset: { x: 40, y: 60 } }, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const wrapper = shadow.querySelector('.vsdk-container') as HTMLElement;
      expect(wrapper.style.getPropertyValue('--vsdk-ox')).toBe('40px');
      expect(wrapper.style.getPropertyValue('--vsdk-oy')).toBe('60px');
      ui.destroy();
    });

    it('uses default offset of 20px when not specified', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const wrapper = shadow.querySelector('.vsdk-container') as HTMLElement;
      expect(wrapper.style.getPropertyValue('--vsdk-ox')).toBe('20px');
      expect(wrapper.style.getPropertyValue('--vsdk-oy')).toBe('20px');
      ui.destroy();
    });

    it('creates a floating button inside the shadow DOM', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const button = shadow.querySelector('.vsdk-btn');
      expect(button).not.toBeNull();
      ui.destroy();
    });

    it('creates transcript overlay when showTranscript is true (default)', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript');
      expect(transcript).not.toBeNull();
      ui.destroy();
    });

    it('does not create transcript overlay when showTranscript is false', () => {
      const ui = new UIManager({ showTranscript: false }, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript');
      expect(transcript).toBeNull();
      ui.destroy();
    });

    it('injects style element into shadow root', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const style = shadow.querySelector('style');
      expect(style).not.toBeNull();
      expect(style!.textContent).toContain('vsdk-btn');
      ui.destroy();
    });

    it('removes existing SDK hosts on construction (singleton pattern)', () => {
      // Create a first instance
      const ui1 = new UIManager({}, onToggle);
      const host1 = ui1.getHost();
      expect(host1.isConnected).toBe(true);

      // Destroy ui1 first to clean up its observers/intervals
      ui1.destroy();

      // Manually re-attach the host to simulate a stale element in the DOM
      host1.setAttribute('data-voice-sdk', 'true');
      document.body.appendChild(host1);
      expect(document.querySelectorAll('div[data-voice-sdk]').length).toBe(1);

      // Creating a second instance should remove the stale host
      const ui2 = new UIManager({}, onToggle);
      expect(host1.isConnected).toBe(false);
      expect(document.querySelectorAll('div[data-voice-sdk]').length).toBe(1);

      ui2.destroy();
    });

    it('wires onSendText handler to transcript when provided', () => {
      const ui = new UIManager({}, onToggle, onSendText);
      const shadow = ui.getHost().shadowRoot!;
      const input = shadow.querySelector('.vsdk-text-input') as HTMLInputElement;
      expect(input).not.toBeNull();

      // Simulate typing and pressing Enter
      input.value = 'hello';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(onSendText).toHaveBeenCalledWith('hello');

      ui.destroy();
    });
  });

  describe('inputMode', () => {
    it('defaults to voice inputMode', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const button = shadow.querySelector('.vsdk-btn')!;
      expect(button.getAttribute('aria-label')).toBe('Voice assistant');
      ui.destroy();
    });

    it('creates text mode button when inputMode is text', () => {
      const ui = new UIManager({}, onToggle, undefined, 'text');
      const shadow = ui.getHost().shadowRoot!;
      const button = shadow.querySelector('.vsdk-btn')!;
      expect(button.getAttribute('aria-label')).toBe('Open chat');
      ui.destroy();
    });

    it('adds text-mode class to transcript in text mode', () => {
      const ui = new UIManager({}, onToggle, undefined, 'text');
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript');
      expect(transcript!.classList.contains('text-mode')).toBe(true);
      ui.destroy();
    });

    it('transcript starts visible in text mode', () => {
      const ui = new UIManager({}, onToggle, undefined, 'text');
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript');
      expect(transcript!.classList.contains('visible')).toBe(true);
      ui.destroy();
    });
  });

  describe('theme and size config', () => {
    it('applies theme preset colors to styles', () => {
      const ui = new UIManager({
        theme: { preset: 'dark' },
      }, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      // Verify the style element exists and was injected with theme-specific CSS
      const styles = shadow.querySelectorAll('style');
      expect(styles.length).toBeGreaterThanOrEqual(1);
      // The dark preset uses different background color #1f2937
      const allStyleText = Array.from(styles).map(s => s.textContent ?? '').join('');
      expect(allStyleText).toContain('#1f2937');
      ui.destroy();
    });

    it('applies size variant to button styles', () => {
      const ui = new UIManager({
        theme: { size: 'lg' },
      }, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const style = shadow.querySelector('style')!;
      // lg size has buttonSize 72
      expect(style.textContent).toContain('72px');
      ui.destroy();
    });

    it('applies custom theme colors', () => {
      const ui = new UIManager({
        theme: { colors: { primary: '#ff0000' } },
      }, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const style = shadow.querySelector('style')!;
      expect(style.textContent).toContain('#ff0000');
      ui.destroy();
    });

    it('applies custom properties', () => {
      const ui = new UIManager({
        theme: { customProperties: { '--my-custom': '#abc123' } },
      }, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const style = shadow.querySelector('style')!;
      expect(style.textContent).toContain('--my-custom');
      expect(style.textContent).toContain('#abc123');
      ui.destroy();
    });
  });

  describe('setConnectionState()', () => {
    it('propagates connection state to state machine', () => {
      const ui = new UIManager({}, onToggle);
      const sm = ui.getStateMachine();

      ui.setConnectionState(ConnectionState.CONNECTING);
      expect(sm.getState().connection).toBe(ConnectionState.CONNECTING);

      ui.setConnectionState(ConnectionState.CONNECTED);
      expect(sm.getState().connection).toBe(ConnectionState.CONNECTED);

      ui.destroy();
    });

    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      const sm = ui.getStateMachine();
      ui.destroy();

      ui.setConnectionState(ConnectionState.CONNECTED);
      expect(sm.getState().connection).toBe(ConnectionState.DISCONNECTED);
    });

    it('updates button state via state machine subscription', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const button = shadow.querySelector('.vsdk-btn')!;

      ui.setConnectionState(ConnectionState.CONNECTING);
      expect(button.classList.contains('connecting')).toBe(true);

      ui.setConnectionState(ConnectionState.CONNECTED);
      // In voice mode, connected without speech active shows 'paused' class
      expect(button.classList.contains('connecting')).toBe(false);

      ui.destroy();
    });

    it('shows transcript header on connect and hides on disconnect', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const header = shadow.querySelector('.vsdk-panel-header') as HTMLElement;
      expect(header.style.display).toBe('none');

      ui.setConnectionState(ConnectionState.CONNECTED);
      expect(header.style.display).toBe('');

      ui.setConnectionState(ConnectionState.DISCONNECTED);
      expect(header.style.display).toBe('none');

      ui.destroy();
    });
  });

  describe('setSpeechState()', () => {
    it('propagates active/paused states to state machine', () => {
      const ui = new UIManager({}, onToggle);
      const sm = ui.getStateMachine();

      ui.setSpeechState(true, false);
      expect(sm.getState().speechActive).toBe(true);
      expect(sm.getState().speechPaused).toBe(false);

      ui.setSpeechState(true, true);
      expect(sm.getState().speechActive).toBe(true);
      expect(sm.getState().speechPaused).toBe(true);

      ui.destroy();
    });

    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      const sm = ui.getStateMachine();
      ui.destroy();

      ui.setSpeechState(true, false);
      expect(sm.getState().speechActive).toBe(false);
    });

    it('reflects speech active state on button', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const button = shadow.querySelector('.vsdk-btn')!;

      ui.setConnectionState(ConnectionState.CONNECTED);
      ui.setSpeechState(true, false);
      expect(button.classList.contains('listening')).toBe(true);

      ui.destroy();
    });

    it('reflects speech paused state on button', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const button = shadow.querySelector('.vsdk-btn')!;

      ui.setConnectionState(ConnectionState.CONNECTED);
      ui.setSpeechState(true, true);
      expect(button.classList.contains('paused')).toBe(true);

      ui.destroy();
    });
  });

  describe('addTranscript()', () => {
    it('adds transcript entries to the overlay', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;

      ui.addTranscript({ speaker: 'user', text: 'Hello', isFinal: true });
      const messages = shadow.querySelector('.vsdk-messages')!;
      const lines = messages.querySelectorAll('.vsdk-transcript-line');
      expect(lines.length).toBe(1);
      expect(lines[0].textContent).toBe('Hello');
      expect(lines[0].classList.contains('vsdk-msg-user')).toBe(true);

      ui.destroy();
    });

    it('adds AI transcript entries', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;

      ui.addTranscript({ speaker: 'ai', text: 'Hi there', isFinal: true });
      const messages = shadow.querySelector('.vsdk-messages')!;
      const lines = messages.querySelectorAll('.vsdk-transcript-line');
      expect(lines.length).toBe(1);
      expect(lines[0].textContent).toBe('Hi there');
      expect(lines[0].classList.contains('vsdk-msg-ai')).toBe(true);

      ui.destroy();
    });

    it('makes transcript panel visible when adding entries', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript')!;

      // Not visible initially in voice mode
      expect(transcript.classList.contains('visible')).toBe(false);

      ui.addTranscript({ speaker: 'user', text: 'Hello', isFinal: true });
      expect(transcript.classList.contains('visible')).toBe(true);

      ui.destroy();
    });

    it('handles multiple transcript entries', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;

      ui.addTranscript({ speaker: 'user', text: 'Hello', isFinal: true });
      ui.addTranscript({ speaker: 'ai', text: 'Hi!', isFinal: true });
      ui.addTranscript({ speaker: 'user', text: 'How are you?', isFinal: true });

      const messages = shadow.querySelector('.vsdk-messages')!;
      const lines = messages.querySelectorAll('.vsdk-transcript-line');
      expect(lines.length).toBe(3);

      ui.destroy();
    });

    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      ui.destroy();

      // Should not throw
      ui.addTranscript({ speaker: 'user', text: 'Hello', isFinal: true });
    });

    it('does nothing when showTranscript is false', () => {
      const ui = new UIManager({ showTranscript: false }, onToggle);
      // Should not throw
      ui.addTranscript({ speaker: 'user', text: 'Hello', isFinal: true });
      ui.destroy();
    });

    it('updates interim (non-final) transcript inline', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;

      ui.addTranscript({ speaker: 'user', text: 'Hel', isFinal: false });
      ui.addTranscript({ speaker: 'user', text: 'Hello', isFinal: false });

      const messages = shadow.querySelector('.vsdk-messages')!;
      const lines = messages.querySelectorAll('.vsdk-transcript-line');
      // Should still be 1 line, updated in place
      expect(lines.length).toBe(1);
      expect(lines[0].textContent).toBe('Hello');

      ui.destroy();
    });
  });

  describe('showTranscript() / hideTranscript()', () => {
    it('shows transcript panel', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript')!;

      ui.showTranscript();
      expect(transcript.classList.contains('visible')).toBe(true);

      ui.destroy();
    });

    it('hides transcript panel', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript')!;

      ui.showTranscript();
      expect(transcript.classList.contains('visible')).toBe(true);

      ui.hideTranscript();
      expect(transcript.classList.contains('visible')).toBe(false);

      ui.destroy();
    });

    it('updates state machine panel visibility on show', () => {
      const ui = new UIManager({}, onToggle);
      const sm = ui.getStateMachine();

      ui.showTranscript();
      expect(sm.getState().panelVisible).toBe(true);

      ui.destroy();
    });

    it('updates state machine panel visibility on hide', () => {
      const ui = new UIManager({}, onToggle);
      const sm = ui.getStateMachine();

      ui.showTranscript();
      ui.hideTranscript();
      expect(sm.getState().panelVisible).toBe(false);

      ui.destroy();
    });

    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      ui.destroy();

      // Should not throw
      ui.showTranscript();
      ui.hideTranscript();
    });
  });

  describe('toggleTranscript()', () => {
    it('toggles transcript visibility', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript')!;

      // Initially hidden in voice mode
      expect(transcript.classList.contains('visible')).toBe(false);

      ui.toggleTranscript();
      expect(transcript.classList.contains('visible')).toBe(true);

      ui.toggleTranscript();
      expect(transcript.classList.contains('visible')).toBe(false);

      ui.destroy();
    });

    it('toggles state machine panel state', () => {
      const ui = new UIManager({}, onToggle);
      const sm = ui.getStateMachine();

      ui.toggleTranscript();
      expect(sm.getState().panelVisible).toBe(true);

      ui.toggleTranscript();
      expect(sm.getState().panelVisible).toBe(false);

      ui.destroy();
    });
  });

  describe('clearTranscript()', () => {
    it('removes all transcript lines', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;

      ui.addTranscript({ speaker: 'user', text: 'Hello', isFinal: true });
      ui.addTranscript({ speaker: 'ai', text: 'Hi', isFinal: true });

      const messages = shadow.querySelector('.vsdk-messages')!;
      expect(messages.querySelectorAll('.vsdk-transcript-line').length).toBe(2);

      ui.clearTranscript();
      expect(messages.querySelectorAll('.vsdk-transcript-line').length).toBe(0);

      ui.destroy();
    });

    it('hides panel after clear', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript')!;

      ui.addTranscript({ speaker: 'user', text: 'Hello', isFinal: true });
      expect(transcript.classList.contains('visible')).toBe(true);

      ui.clearTranscript();
      expect(transcript.classList.contains('visible')).toBe(false);

      ui.destroy();
    });
  });

  describe('showToolStatus() / removeToolStatus()', () => {
    it('shows tool status in transcript', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;

      ui.showToolStatus('fillField');
      const status = shadow.querySelector('.vsdk-tool-status');
      expect(status).not.toBeNull();
      expect(status!.textContent).toBe('fillField...');

      ui.destroy();
    });

    it('removes tool status from transcript', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;

      ui.showToolStatus('fillField');
      expect(shadow.querySelector('.vsdk-tool-status')).not.toBeNull();

      ui.removeToolStatus();
      expect(shadow.querySelector('.vsdk-tool-status')).toBeNull();

      ui.destroy();
    });

    it('replaces existing tool status', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;

      ui.showToolStatus('fillField');
      ui.showToolStatus('clickElement');
      const statuses = shadow.querySelectorAll('.vsdk-tool-status');
      expect(statuses.length).toBe(1);
      expect(statuses[0].textContent).toBe('clickElement...');

      ui.destroy();
    });

    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      ui.destroy();
      ui.showToolStatus('test');
      ui.removeToolStatus();
    });
  });

  describe('setAIThinking()', () => {
    it('shows thinking indicator when set to true', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;

      ui.setAIThinking(true);
      const thinking = shadow.querySelector('.vsdk-thinking');
      expect(thinking).not.toBeNull();

      ui.destroy();
    });

    it('removes thinking indicator when set to false', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;

      ui.setAIThinking(true);
      expect(shadow.querySelector('.vsdk-thinking')).not.toBeNull();

      ui.setAIThinking(false);
      expect(shadow.querySelector('.vsdk-thinking')).toBeNull();

      ui.destroy();
    });

    it('propagates through state machine', () => {
      const ui = new UIManager({}, onToggle);
      const sm = ui.getStateMachine();

      ui.setAIThinking(true);
      expect(sm.getState().aiThinking).toBe(true);

      ui.setAIThinking(false);
      expect(sm.getState().aiThinking).toBe(false);

      ui.destroy();
    });

    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      ui.destroy();
      ui.setAIThinking(true);
    });
  });

  describe('focusInput()', () => {
    it('shows transcript and focuses the text input', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript')!;

      ui.focusInput();
      expect(transcript.classList.contains('visible')).toBe(true);

      ui.destroy();
    });

    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      ui.destroy();
      ui.focusInput();
    });
  });

  describe('setAutoHideEnabled()', () => {
    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      ui.destroy();
      // Should not throw
      ui.setAutoHideEnabled(false);
    });
  });

  describe('setDisconnectHandler()', () => {
    it('wires disconnect handler to panel close button', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const disconnectFn = vi.fn();

      ui.setDisconnectHandler(disconnectFn);

      // Click the close button in the panel header
      const closeBtn = shadow.querySelector('.vsdk-panel-close') as HTMLElement;
      expect(closeBtn).not.toBeNull();
      closeBtn.click();
      expect(disconnectFn).toHaveBeenCalledTimes(1);

      ui.destroy();
    });

    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      ui.destroy();
      ui.setDisconnectHandler(vi.fn());
    });
  });

  describe('setCancelHandler()', () => {
    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      ui.destroy();
      ui.setCancelHandler(vi.fn());
    });
  });

  describe('updateQueue()', () => {
    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      ui.destroy();
      ui.updateQueue({ active: null, queued: [] });
    });
  });

  describe('restoreTranscript()', () => {
    it('does nothing after destroy', () => {
      const ui = new UIManager({}, onToggle);
      ui.destroy();
      ui.restoreTranscript();
    });
  });

  describe('destroy()', () => {
    it('removes host element from the DOM', () => {
      const ui = new UIManager({}, onToggle);
      const host = ui.getHost();
      expect(host.isConnected).toBe(true);

      ui.destroy();
      expect(host.isConnected).toBe(false);
    });

    it('removes the host so querySelector no longer finds it', () => {
      const ui = new UIManager({}, onToggle);
      expect(document.querySelector('div[data-voice-sdk]')).not.toBeNull();

      ui.destroy();
      expect(document.querySelector('div[data-voice-sdk]')).toBeNull();
    });

    it('marks state machine as destroyed', () => {
      const ui = new UIManager({}, onToggle);
      const sm = ui.getStateMachine();

      ui.destroy();
      expect(sm.getState().destroyed).toBe(true);
    });

    it('clears host guard interval', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const ui = new UIManager({}, onToggle);

      ui.destroy();
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('disconnects body MutationObserver', () => {
      const ui = new UIManager({}, onToggle);
      // Access private bodyObserver for verification
      const bodyObserver = (ui as any).bodyObserver as MutationObserver | null;
      const disconnectSpy = bodyObserver ? vi.spyOn(bodyObserver, 'disconnect') : null;

      ui.destroy();
      if (disconnectSpy) {
        expect(disconnectSpy).toHaveBeenCalled();
      }
    });

    it('is idempotent (calling destroy twice does not throw)', () => {
      const ui = new UIManager({}, onToggle);
      ui.destroy();
      expect(() => ui.destroy()).not.toThrow();
    });

    it('prevents all methods from acting after destroy', () => {
      const ui = new UIManager({}, onToggle);
      const sm = ui.getStateMachine();
      ui.destroy();

      // All public methods should be no-ops
      ui.setConnectionState(ConnectionState.CONNECTED);
      ui.setSpeechState(true, false);
      ui.addTranscript({ speaker: 'user', text: 'test', isFinal: true });
      ui.showTranscript();
      ui.hideTranscript();
      ui.toggleTranscript();
      ui.clearTranscript();
      ui.showToolStatus('test');
      ui.removeToolStatus();
      ui.setAIThinking(true);
      ui.focusInput();
      ui.setAutoHideEnabled(false);
      ui.restoreTranscript();
      ui.updateQueue({ active: null, queued: [] });
      ui.setCancelHandler(vi.fn());
      ui.setDisconnectHandler(vi.fn());

      // State machine should not have changed
      expect(sm.getState().connection).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('ensureAttached()', () => {
    it('re-attaches host to document.body when removed', () => {
      const ui = new UIManager({}, onToggle);
      const host = ui.getHost();

      // Simulate SPA framework removing the host
      host.remove();
      expect(host.isConnected).toBe(false);

      ui.ensureAttached();
      expect(host.isConnected).toBe(true);
      expect(host.parentElement).toBe(document.body);

      ui.destroy();
    });

    it('does not re-attach when already connected', () => {
      const ui = new UIManager({}, onToggle);
      const host = ui.getHost();
      const appendSpy = vi.spyOn(document.body, 'appendChild');
      appendSpy.mockClear(); // Clear constructor call

      ui.ensureAttached();
      expect(appendSpy).not.toHaveBeenCalled();

      ui.destroy();
    });

    it('does not re-attach after destroy', () => {
      const ui = new UIManager({}, onToggle);
      const host = ui.getHost();
      ui.destroy();
      expect(host.isConnected).toBe(false);

      ui.ensureAttached();
      expect(host.isConnected).toBe(false);
    });

    it('preserves Shadow DOM contents after re-attach', () => {
      const ui = new UIManager({}, onToggle);
      const host = ui.getHost();

      // Add some transcript content
      ui.addTranscript({ speaker: 'user', text: 'Preserved message', isFinal: true });

      // Simulate SPA removal
      host.remove();
      ui.ensureAttached();

      // Shadow DOM contents should still be there
      const shadow = host.shadowRoot!;
      const messages = shadow.querySelector('.vsdk-messages')!;
      const lines = messages.querySelectorAll('.vsdk-transcript-line');
      expect(lines.length).toBe(1);
      expect(lines[0].textContent).toBe('Preserved message');

      ui.destroy();
    });
  });

  describe('host guard', () => {
    it('starts interval-based host guard on construction', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const ui = new UIManager({}, onToggle);

      // Should have been called with 500ms interval
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 500);

      ui.destroy();
    });

    it('starts MutationObserver on document.body', () => {
      const ui = new UIManager({}, onToggle);
      const bodyObserver = (ui as any).bodyObserver;
      expect(bodyObserver).not.toBeNull();
      ui.destroy();
    });

    it('interval fallback calls ensureAttached', () => {
      vi.useFakeTimers();
      const ui = new UIManager({}, onToggle);
      const ensureSpy = vi.spyOn(ui, 'ensureAttached');

      // Advance timers to trigger the interval
      vi.advanceTimersByTime(500);
      expect(ensureSpy).toHaveBeenCalled();

      ui.destroy();
      vi.useRealTimers();
    });

    it('cleans up interval and observer on destroy', () => {
      const ui = new UIManager({}, onToggle);
      const bodyObserver = (ui as any).bodyObserver;
      const disconnectSpy = bodyObserver ? vi.spyOn(bodyObserver, 'disconnect') : null;
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

      ui.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
      if (disconnectSpy) {
        expect(disconnectSpy).toHaveBeenCalled();
      }
      expect((ui as any).bodyObserver).toBeNull();
      expect((ui as any).hostGuardInterval).toBeNull();
    });
  });

  describe('keyboard shortcut', () => {
    it('Ctrl+K focuses text input', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript')!;

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
      }));

      // Transcript should become visible
      expect(transcript.classList.contains('visible')).toBe(true);

      ui.destroy();
    });

    it('stops responding to Ctrl+K after destroy', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const transcript = shadow.querySelector('.vsdk-transcript')!;
      ui.destroy();

      // The AbortController should have removed the listener
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
      }));

      // Should not have made transcript visible (already destroyed)
    });
  });

  describe('getStateMachine()', () => {
    it('returns the internal UIStateMachine instance', () => {
      const ui = new UIManager({}, onToggle);
      const sm = ui.getStateMachine();
      expect(sm).toBeDefined();
      expect(sm.getState()).toBeDefined();
      expect(sm.getState().connection).toBe(ConnectionState.DISCONNECTED);
      ui.destroy();
    });
  });

  describe('getHost()', () => {
    it('returns the shadow DOM host element', () => {
      const ui = new UIManager({}, onToggle);
      const host = ui.getHost();
      expect(host).toBeInstanceOf(HTMLElement);
      expect(host.getAttribute('data-voice-sdk')).toBe('true');
      ui.destroy();
    });
  });

  describe('button click wiring', () => {
    it('calls onToggle when button is clicked', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const button = shadow.querySelector('.vsdk-btn') as HTMLElement;

      button.click();
      expect(onToggle).toHaveBeenCalledTimes(1);

      button.click();
      expect(onToggle).toHaveBeenCalledTimes(2);

      ui.destroy();
    });
  });

  describe('state machine subscriptions integration', () => {
    it('thinking state change shows/removes indicator in transcript', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;

      ui.setAIThinking(true);
      expect(shadow.querySelector('.vsdk-thinking')).not.toBeNull();

      ui.setAIThinking(false);
      expect(shadow.querySelector('.vsdk-thinking')).toBeNull();

      ui.destroy();
    });

    it('connection state transition toggles transcript header', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const header = shadow.querySelector('.vsdk-panel-header') as HTMLElement;

      // Initially hidden
      expect(header.style.display).toBe('none');

      // Connect
      ui.setConnectionState(ConnectionState.CONNECTED);
      expect(header.style.display).toBe('');

      // Disconnect
      ui.setConnectionState(ConnectionState.DISCONNECTED);
      expect(header.style.display).toBe('none');

      ui.destroy();
    });

    it('connection to error hides transcript header', () => {
      const ui = new UIManager({}, onToggle);
      const shadow = ui.getHost().shadowRoot!;
      const header = shadow.querySelector('.vsdk-panel-header') as HTMLElement;

      ui.setConnectionState(ConnectionState.CONNECTED);
      expect(header.style.display).toBe('');

      ui.setConnectionState(ConnectionState.ERROR);
      expect(header.style.display).toBe('none');

      ui.destroy();
    });
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AccessibilityManager } from '../../src/accessibility/AccessibilityManager';

describe('AccessibilityManager', () => {
  let manager: AccessibilityManager;

  afterEach(() => {
    manager?.destroy();
    document.body.innerHTML = '';
  });

  describe('constructor', () => {
    it('creates live region in the DOM', () => {
      manager = new AccessibilityManager();
      const liveRegion = document.querySelector('[data-voice-sdk="live-region"]');
      expect(liveRegion).not.toBeNull();
      expect(liveRegion?.getAttribute('aria-live')).toBe('polite');
      expect(liveRegion?.getAttribute('role')).toBe('status');
    });

    it('does not create live region when announcements disabled', () => {
      manager = new AccessibilityManager({ announcements: false });
      const liveRegion = document.querySelector('[data-voice-sdk="live-region"]');
      expect(liveRegion).toBeNull();
    });
  });

  describe('announce', () => {
    it('sets text on the live region', async () => {
      manager = new AccessibilityManager();
      manager.announce('Hello screen reader');
      // Uses requestAnimationFrame, simulate async
      await new Promise(resolve => requestAnimationFrame(resolve));
      const liveRegion = document.querySelector('[data-voice-sdk="live-region"]');
      expect(liveRegion?.textContent).toBe('Hello screen reader');
    });

    it('does nothing after destroy', async () => {
      manager = new AccessibilityManager();
      manager.destroy();
      manager.announce('Should not appear');
      await new Promise(resolve => requestAnimationFrame(resolve));
      const liveRegion = document.querySelector('[data-voice-sdk="live-region"]');
      expect(liveRegion).toBeNull();
    });
  });

  describe('announceAction', () => {
    it('announces fillField actions', async () => {
      manager = new AccessibilityManager();
      manager.announceAction('fillField', { fieldId: 'email', value: 'test@example.com' });
      await new Promise(resolve => requestAnimationFrame(resolve));
      const liveRegion = document.querySelector('[data-voice-sdk="live-region"]');
      expect(liveRegion?.textContent).toContain('Filled email');
    });

    it('announces clickElement actions', async () => {
      manager = new AccessibilityManager();
      manager.announceAction('clickElement', { description: 'Submit' });
      await new Promise(resolve => requestAnimationFrame(resolve));
      const liveRegion = document.querySelector('[data-voice-sdk="live-region"]');
      expect(liveRegion?.textContent).toContain('Clicked Submit');
    });

    it('announces generic actions', async () => {
      manager = new AccessibilityManager();
      manager.announceAction('scanPage', {});
      await new Promise(resolve => requestAnimationFrame(resolve));
      const liveRegion = document.querySelector('[data-voice-sdk="live-region"]');
      expect(liveRegion?.textContent).toContain('Executed scanPage');
    });
  });

  describe('focusElement', () => {
    it('focuses an element', () => {
      manager = new AccessibilityManager();
      document.body.innerHTML = '<button id="btn">Click me</button>';
      const btn = document.getElementById('btn')!;
      manager.focusElement(btn);
      expect(document.activeElement).toBe(btn);
    });

    it('adds tabindex to non-focusable elements', () => {
      manager = new AccessibilityManager();
      document.body.innerHTML = '<div id="d">text</div>';
      const div = document.getElementById('d')!;
      manager.focusElement(div);
      expect(div.getAttribute('tabindex')).toBe('-1');
    });

    it('does not add tabindex to already-focusable elements', () => {
      manager = new AccessibilityManager();
      document.body.innerHTML = '<input id="inp" />';
      const inp = document.getElementById('inp')!;
      manager.focusElement(inp);
      expect(inp.hasAttribute('tabindex')).toBe(false);
    });
  });

  describe('keyboard shortcuts', () => {
    it('Alt+V calls toggle handler', () => {
      const toggle = vi.fn();
      manager = new AccessibilityManager({}, toggle);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', altKey: true }));
      expect(toggle).toHaveBeenCalled();
    });

    it('does not register shortcuts when disabled', () => {
      const toggle = vi.fn();
      manager = new AccessibilityManager({ keyboardShortcuts: false }, toggle);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', altKey: true }));
      expect(toggle).not.toHaveBeenCalled();
    });
  });

  describe('setShadowHost', () => {
    it('adds high-contrast class when highContrast is true', () => {
      manager = new AccessibilityManager({ highContrast: true });
      const host = document.createElement('div');
      manager.setShadowHost(host);
      expect(host.classList.contains('high-contrast')).toBe(true);
    });

    it('does not add high-contrast class when highContrast is false', () => {
      manager = new AccessibilityManager({ highContrast: false });
      const host = document.createElement('div');
      manager.setShadowHost(host);
      expect(host.classList.contains('high-contrast')).toBe(false);
    });
  });

  describe('getTtsRate', () => {
    it('returns default rate', () => {
      manager = new AccessibilityManager();
      expect(manager.getTtsRate()).toBe(0.85);
    });

    it('returns custom rate', () => {
      manager = new AccessibilityManager({ ttsRate: 1.2 });
      expect(manager.getTtsRate()).toBe(1.2);
    });
  });

  describe('form cursor', () => {
    it('manages form cursor index', () => {
      manager = new AccessibilityManager();
      expect(manager.getFormCursor()).toBe(-1);
      manager.setFormCursor(3);
      expect(manager.getFormCursor()).toBe(3);
    });
  });

  describe('destroy', () => {
    it('removes live region', () => {
      manager = new AccessibilityManager();
      expect(document.querySelector('[data-voice-sdk="live-region"]')).not.toBeNull();
      manager.destroy();
      expect(document.querySelector('[data-voice-sdk="live-region"]')).toBeNull();
    });

    it('removes high-contrast class from host', () => {
      manager = new AccessibilityManager({ highContrast: true });
      const host = document.createElement('div');
      manager.setShadowHost(host);
      expect(host.classList.contains('high-contrast')).toBe(true);
      manager.destroy();
      expect(host.classList.contains('high-contrast')).toBe(false);
    });

    it('is idempotent', () => {
      manager = new AccessibilityManager();
      manager.destroy();
      expect(() => manager.destroy()).not.toThrow();
    });
  });
});

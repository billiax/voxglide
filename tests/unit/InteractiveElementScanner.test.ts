import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InteractiveElementScanner } from '../../src/context/InteractiveElementScanner';

// jsdom doesn't support offsetParent — mock it to make elements "visible"
function makeAllVisible() {
  const els = document.querySelectorAll('*');
  els.forEach(el => {
    Object.defineProperty(el, 'offsetParent', { value: document.body, configurable: true });
  });
}

describe('InteractiveElementScanner', () => {
  let scanner: InteractiveElementScanner;

  beforeEach(() => {
    document.body.innerHTML = '';
    scanner = new InteractiveElementScanner();
    // Mock getBoundingClientRect to always return visible
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100,
      x: 0, y: 0, toJSON: () => ({}),
    });
  });

  describe('index assignment', () => {
    it('assigns sequential indices starting at 1', () => {
      document.body.innerHTML = `
        <button>First</button>
        <button>Second</button>
        <button>Third</button>
      `;
      makeAllVisible();
      const results = scanner.scan();
      expect(results.length).toBe(3);
      // Indices may not be sorted in order after viewport sort, but all 3 should be present
      const indices = results.map(el => el.index).sort();
      expect(indices).toEqual([1, 2, 3]);
    });

    it('includes index in each element result', () => {
      document.body.innerHTML = '<button>Click Me</button>';
      makeAllVisible();
      const results = scanner.scan();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].index).toBe(1);
    });
  });

  describe('getElementByIndex', () => {
    it('returns the DOM element for a valid index', () => {
      document.body.innerHTML = '<button id="btn">Test</button>';
      makeAllVisible();
      scanner.scan();
      const el = scanner.getElementByIndex(1);
      expect(el).not.toBeNull();
      expect(el?.id).toBe('btn');
    });

    it('returns null for an invalid index', () => {
      document.body.innerHTML = '<button>Test</button>';
      makeAllVisible();
      scanner.scan();
      expect(scanner.getElementByIndex(999)).toBeNull();
    });

    it('returns null if the element was removed from DOM', () => {
      document.body.innerHTML = '<button id="btn">Test</button>';
      makeAllVisible();
      scanner.scan();

      // Remove the element from DOM
      document.getElementById('btn')!.remove();

      expect(scanner.getElementByIndex(1)).toBeNull();
    });
  });

  describe('re-scan clears index map', () => {
    it('resets indices on each scan', () => {
      document.body.innerHTML = '<button>Alpha</button>';
      makeAllVisible();
      let results = scanner.scan();
      expect(results[0].index).toBe(1);

      // Change the DOM and re-scan
      document.body.innerHTML = `
        <button>Beta</button>
        <button>Gamma</button>
      `;
      makeAllVisible();
      results = scanner.scan();
      const indices = results.map(r => r.index).sort();
      expect(indices).toEqual([1, 2]);
    });

    it('old indices do not resolve after re-scan removes elements', () => {
      document.body.innerHTML = `
        <button>First</button>
        <button>Second</button>
      `;
      makeAllVisible();
      scanner.scan();
      expect(scanner.getElementByIndex(2)).not.toBeNull();

      // Re-scan with fewer elements
      document.body.innerHTML = '<button>Only</button>';
      makeAllVisible();
      scanner.scan();
      // Index 2 should not exist in new scan
      expect(scanner.getElementByIndex(2)).toBeNull();
    });
  });

  describe('getIndexMap', () => {
    it('returns the full index map', () => {
      document.body.innerHTML = `
        <button>A</button>
        <button>B</button>
      `;
      makeAllVisible();
      scanner.scan();
      const map = scanner.getIndexMap();
      expect(map.size).toBe(2);
      expect(map.has(1)).toBe(true);
      expect(map.has(2)).toBe(true);
    });
  });

  describe('computeStructuralFingerprint()', () => {
    it('changes when a button is added', () => {
      document.body.innerHTML = '<button>One</button>';
      const fp1 = scanner.computeStructuralFingerprint();

      document.body.innerHTML = '<button>One</button><button>Two</button>';
      const fp2 = scanner.computeStructuralFingerprint();

      expect(fp1).not.toBe(fp2);
    });

    it('does not change when input value changes', () => {
      document.body.innerHTML = '<input type="text" value="old" />';
      const fp1 = scanner.computeStructuralFingerprint();

      (document.querySelector('input') as HTMLInputElement).value = 'new';
      const fp2 = scanner.computeStructuralFingerprint();

      expect(fp1).toBe(fp2);
    });
  });

  describe('computeValueFingerprint()', () => {
    it('changes when input value changes', () => {
      document.body.innerHTML = '<input type="text" value="old" />';
      const fp1 = scanner.computeValueFingerprint();

      (document.querySelector('input') as HTMLInputElement).value = 'new';
      const fp2 = scanner.computeValueFingerprint();

      expect(fp1).not.toBe(fp2);
    });

    it('does not change when an attribute-only change occurs on existing element', () => {
      document.body.innerHTML = '<div><input type="text" value="stable" /><button id="btn">X</button></div>';
      const fp1 = scanner.computeValueFingerprint();

      // Change an attribute — not a value change
      document.getElementById('btn')!.setAttribute('aria-expanded', 'true');
      const fp2 = scanner.computeValueFingerprint();

      expect(fp1).toBe(fp2);
    });
  });

  describe('cursor:pointer detection', () => {
    it('detects div elements with cursor:pointer as clickable', () => {
      document.body.innerHTML = `
        <div style="cursor: pointer; display: block;">Folder A</div>
        <div style="cursor: pointer; display: block;">Folder B</div>
      `;
      makeAllVisible();
      const results = scanner.scan();
      expect(results.length).toBe(2);
      expect(results[0].capabilities).toContain('clickable');
      expect(results[1].capabilities).toContain('clickable');
    });

    it('does not duplicate elements already matched by selector', () => {
      document.body.innerHTML = `
        <button style="cursor: pointer;">Already a button</button>
        <div style="cursor: pointer; display: block;">Custom clickable</div>
      `;
      makeAllVisible();
      const results = scanner.scan();
      // button found by selector, div found by cursor:pointer — 2 total, no dupes
      expect(results.length).toBe(2);
      const descs = results.map(r => r.description);
      expect(descs).toContain('Already a button');
      expect(descs).toContain('Custom clickable');
    });

    it('picks only outermost cursor:pointer element, not nested children', () => {
      document.body.innerHTML = `
        <div style="cursor: pointer; display: block;">
          <div style="cursor: pointer; display: block;">
            <span style="cursor: pointer;">Nested text</span>
          </div>
        </div>
      `;
      makeAllVisible();
      const results = scanner.scan();
      // Should find only the outermost div
      expect(results.length).toBe(1);
      expect(results[0].description).toContain('Nested text');
    });

    it('skips cursor:pointer elements inside selector-matched parents', () => {
      document.body.innerHTML = `
        <button>
          <div style="cursor: pointer; display: block;">Inside button</div>
        </button>
      `;
      makeAllVisible();
      const results = scanner.scan();
      // Only the button, not the inner div
      expect(results.length).toBe(1);
      expect(results[0].tagName).toBe('button');
    });

    it('skips cursor:pointer elements with no text', () => {
      document.body.innerHTML = `
        <div style="cursor: pointer; display: block;"></div>
        <div style="cursor: pointer; display: block;">Has text</div>
      `;
      makeAllVisible();
      const results = scanner.scan();
      expect(results.length).toBe(1);
      expect(results[0].description).toBe('Has text');
    });

    it('skips cursor:pointer elements inside SDK shadow host', () => {
      document.body.innerHTML = `
        <div data-voice-sdk>
          <div style="cursor: pointer; display: block;">SDK element</div>
        </div>
        <div style="cursor: pointer; display: block;">Page element</div>
      `;
      makeAllVisible();
      const results = scanner.scan();
      expect(results.length).toBe(1);
      expect(results[0].description).toBe('Page element');
    });

    it('includes cursor:pointer elements in index map', () => {
      document.body.innerHTML = `
        <div id="clickable-div" style="cursor: pointer; display: block;">Click me</div>
      `;
      makeAllVisible();
      scanner.scan();
      const el = scanner.getElementByIndex(1);
      expect(el).not.toBeNull();
      expect(el?.id).toBe('clickable-div');
    });
  });
});

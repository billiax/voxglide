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
});

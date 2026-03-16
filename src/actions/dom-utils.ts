/**
 * Shared DOM utility functions used by DOMActions and InteractiveElementScanner.
 */

/**
 * Score how well a text matches a query string.
 * Returns: exact=100, starts-with=80, word-boundary=60, contains=40, no match=0.
 */
export function scoreText(text: string | null | undefined, query: string): number {
  if (!text) return 0;
  const t = text.trim().toLowerCase();
  if (!t) return 0;
  const lower = query.toLowerCase();
  if (t === lower) return 100;
  if (t.startsWith(lower)) return 80;
  const wordBoundaryPattern = new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  if (wordBoundaryPattern.test(t)) return 60;
  if (t.includes(lower)) return 40;
  return 0;
}

/**
 * Find label text from sibling/parent elements for controls without their own text.
 * Searches both preceding and following siblings, then walks up parent containers.
 */
export function getNearbyLabelText(el: HTMLElement): string {
  // Check preceding siblings
  let sibling: Element | null = el.previousElementSibling;
  while (sibling) {
    const text = sibling.textContent?.trim().toLowerCase();
    if (text && text.length < 100) return text;
    sibling = sibling.previousElementSibling;
  }

  // Check following siblings
  sibling = el.nextElementSibling;
  while (sibling) {
    const text = sibling.textContent?.trim().toLowerCase();
    if (text && text.length < 100) return text;
    sibling = sibling.nextElementSibling;
  }

  // Walk up to parent containers and check their text/siblings
  let parent = el.parentElement;
  for (let depth = 0; parent && depth < 3; depth++) {
    const prevSibling = parent.previousElementSibling;
    if (prevSibling) {
      const text = prevSibling.textContent?.trim().toLowerCase();
      if (text && text.length < 100) return text;
    }
    const nextSibling = parent.nextElementSibling;
    if (nextSibling) {
      const text = nextSibling.textContent?.trim().toLowerCase();
      if (text && text.length < 100) return text;
    }
    parent = parent.parentElement;
  }

  return '';
}

/**
 * Dispatch a full click event sequence including pointer and mouse events.
 * This ensures frameworks that listen for pointer/mouse events (not just click) respond correctly.
 */
export function dispatchClickSequence(el: HTMLElement): void {
  el.focus();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  el.click();
}

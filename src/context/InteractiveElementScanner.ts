import type { InteractiveElement, ElementCapability } from '../types';
import { INTERACTIVE_SELECTOR } from '../constants';
import { getNearbyLabelText } from '../actions/dom-utils';

/**
 * Deeply scans the DOM for all interactive elements and categorizes
 * their capabilities. Generates human-readable descriptions and
 * stable CSS selectors for each element.
 */
export class InteractiveElementScanner {
  private maxElements: number;
  private wasTruncated = false;
  private totalFound = 0;
  private includedCount = 0;
  private indexMap = new Map<number, HTMLElement>();
  private nextIndex = 1;

  constructor(maxElements = 100) {
    this.maxElements = maxElements;
  }

  /**
   * Full scan of interactive elements on the page.
   */
  scan(): InteractiveElement[] {
    const rawElements = document.querySelectorAll(INTERACTIVE_SELECTOR);
    const results: InteractiveElement[] = [];
    let visibleCount = 0;

    // Clear index map and reset counter for each scan
    this.indexMap.clear();
    this.nextIndex = 1;

    for (const el of rawElements) {
      const htmlEl = el as HTMLElement;

      // Skip hidden elements
      if (this.isHidden(htmlEl)) continue;

      // Skip elements inside SDK shadow DOM
      if (htmlEl.closest('[data-voice-sdk]')) continue;

      // Skip password inputs
      if (htmlEl instanceof HTMLInputElement && htmlEl.type === 'password') continue;

      const capabilities = this.determineCapabilities(htmlEl);
      if (capabilities.length === 0) continue;

      const description = this.generateDescription(htmlEl);
      if (!description) continue;

      // Count all visible qualifying elements, even if we don't include them
      visibleCount++;

      if (results.length >= this.maxElements) continue;

      // Assign index before viewport sort so indices are stable per scan
      const index = this.nextIndex++;
      this.indexMap.set(index, htmlEl);

      const selector = this.generateSelector(htmlEl);
      const role = htmlEl.getAttribute('role') || undefined;
      const state = this.captureState(htmlEl);
      const inViewport = this.isInViewport(htmlEl);

      results.push({
        index,
        description,
        selector,
        tagName: htmlEl.tagName.toLowerCase(),
        role,
        capabilities,
        state: Object.keys(state).length > 0 ? state : undefined,
        inViewport,
      });
    }

    // Secondary pass: detect cursor:pointer elements missed by selector scan.
    // Common in React/Vue/Angular apps where divs have framework event handlers
    // but no semantic HTML attributes (no role, no tabindex, no onclick attr).
    const selectorMatched = new Set<Element>(rawElements);
    const cursorPointerCount = this.scanCursorPointerElements(selectorMatched, results);
    visibleCount += cursorPointerCount;

    // Track truncation info
    this.totalFound = visibleCount;
    this.includedCount = results.length;
    this.wasTruncated = visibleCount > results.length;

    // Sort: viewport elements first, then off-screen
    results.sort((a, b) => {
      if (a.inViewport && !b.inViewport) return -1;
      if (!a.inViewport && b.inViewport) return 1;
      return 0;
    });

    return results;
  }

  /**
   * Resolve an element by its scan index. Returns null if the element
   * is no longer connected to the DOM.
   */
  getElementByIndex(index: number): HTMLElement | null {
    const el = this.indexMap.get(index);
    if (el?.isConnected) return el;
    this.indexMap.delete(index);
    return null;
  }

  /**
   * Returns the full index map for bulk access.
   */
  getIndexMap(): Map<number, HTMLElement> {
    return this.indexMap;
  }

  /**
   * Returns truncation info from the last scan, or null if no scan has been performed.
   */
  getTruncationInfo(): { wasTruncated: boolean; included: number; total: number } | null {
    if (this.totalFound === 0 && this.includedCount === 0) return null;
    return {
      wasTruncated: this.wasTruncated,
      included: this.includedCount,
      total: this.totalFound,
    };
  }

  /**
   * Compute a cheap fingerprint of the page's interactive structure.
   * Used for change detection without a full scan.
   */
  computeFingerprint(): string {
    const interactiveCount = document.querySelectorAll(INTERACTIVE_SELECTOR).length;
    const formCount = document.querySelectorAll('form').length;
    const bodyChildCount = document.body ? document.body.children.length : 0;

    let valueHash = 0;
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      const val = (el as HTMLInputElement).value;
      if (val) valueHash = (valueHash * 31 + simpleHash(val)) | 0;
    });

    const contentLen = (document.querySelector('main') || document.body)?.textContent?.length || 0;
    return `${interactiveCount}:${formCount}:${bodyChildCount}:${valueHash}:${contentLen}`;
  }

  /**
   * Secondary scan: find elements with cursor:pointer that weren't caught
   * by the selector-based scan. Detects clickable divs/spans/li/etc common
   * in React/Vue/Angular apps with framework-managed event handlers.
   *
   * Only picks the outermost cursor:pointer ancestor to avoid duplicates
   * from nested children that inherit the style.
   */
  private scanCursorPointerElements(
    selectorMatched: Set<Element>,
    results: InteractiveElement[],
  ): number {
    const SKIP_TAGS = new Set([
      'svg', 'path', 'rect', 'circle', 'ellipse', 'line', 'g',
      'polygon', 'polyline', 'use', 'defs', 'clippath',
      'script', 'style', 'noscript', 'link', 'meta', 'img', 'br', 'hr',
    ]);
    const MAX_STYLE_CHECKS = 500;
    const MIN_SIZE = 16;

    let checks = 0;
    let addedCount = 0;
    const foundRoots: HTMLElement[] = [];

    const allElements = document.body.querySelectorAll('*');
    for (const node of allElements) {
      if (checks >= MAX_STYLE_CHECKS) break;
      if (results.length >= this.maxElements) break;

      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;

      // Skip SDK elements
      if (el.closest('[data-voice-sdk]')) continue;

      // Skip if already matched by selector (is or is inside one)
      if (selectorMatched.has(el)) continue;
      if (el.closest(INTERACTIVE_SELECTOR)) continue;

      // Skip if inside an already-found cursor:pointer root
      if (foundRoots.some(root => root.contains(el))) continue;

      checks++;
      const style = window.getComputedStyle(el);
      if (style.cursor !== 'pointer') continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      // Minimum size filter — avoids tiny decorative elements
      const rect = el.getBoundingClientRect();
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) continue;

      // Must have visible text
      const description = this.generateDescription(el);
      if (!description) continue;

      foundRoots.push(el);

      const index = this.nextIndex++;
      this.indexMap.set(index, el);

      results.push({
        index,
        description,
        selector: this.generateSelector(el),
        tagName: tag,
        role: el.getAttribute('role') || undefined,
        capabilities: ['clickable'],
        inViewport: this.isInViewport(el),
      });
      addedCount++;
    }

    return addedCount;
  }

  private isInViewport(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return (
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0
    );
  }

  private isHidden(el: HTMLElement): boolean {
    // offsetParent is null for hidden elements (except fixed/body)
    if (el.offsetParent === null && el.tagName !== 'BODY') {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return true;
      }
      // position:fixed elements have null offsetParent but are visible
      if (style.position !== 'fixed') {
        return true;
      }
    }
    return false;
  }

  private determineCapabilities(el: HTMLElement): ElementCapability[] {
    const caps: ElementCapability[] = [];
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');

    // Clickable
    if (
      tag === 'button' || tag === 'a' || tag === 'summary' ||
      role === 'button' || role === 'menuitem' || role === 'link' ||
      el.hasAttribute('onclick') || el.hasAttribute('data-action') ||
      el.hasAttribute('tabindex')
    ) {
      caps.push('clickable');
    }

    // Toggleable
    if (
      role === 'switch' || role === 'checkbox' ||
      (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio'))
    ) {
      caps.push('toggleable');
    }

    // Expandable
    if (tag === 'summary' || tag === 'details') {
      caps.push('expandable');
    }

    // Editable
    if (
      tag === 'input' || tag === 'textarea' ||
      (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') ||
      role === 'combobox'
    ) {
      caps.push('editable');
    }

    // Draggable
    if (el.getAttribute('draggable') === 'true') {
      caps.push('draggable');
    }

    // Selectable
    if (
      tag === 'select' || role === 'tab' || role === 'option' || role === 'radio'
    ) {
      caps.push('selectable');
    }

    // Navigable
    if (tag === 'a' && (el as HTMLAnchorElement).href) {
      caps.push('navigable');
    }

    return caps;
  }

  private generateDescription(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select'
      || (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false');

    // Try various sources for a descriptive label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return this.truncate(ariaLabel, 60);

    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.textContent?.trim()) return this.truncate(labelEl.textContent.trim(), 60);
    }

    const title = el.getAttribute('title');
    if (title) return this.truncate(title, 60);

    const alt = el.getAttribute('alt');
    if (alt) return this.truncate(alt, 60);

    const placeholder = (el as HTMLInputElement).placeholder;
    if (placeholder) return this.truncate(placeholder, 60);

    // For form elements, use associated label or name attribute
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const label = this.findLabelText(el);
      if (label) return this.truncate(label, 60);
      const name = el.getAttribute('name');
      if (name) return name;
    }

    // For contenteditable elements, try associated label and nearby text
    if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') {
      const label = this.findLabelText(el);
      if (label) return this.truncate(label, 60);
      const nearby = getNearbyLabelText(el);
      if (nearby) return this.truncate(nearby, 60);
    }

    // Text content (trimmed, truncated)
    const text = el.textContent?.trim();
    if (text) return this.truncate(text, 60);

    // For label-less controls (switches, checkboxes), look at nearby sibling/parent text
    if (role === 'switch' || role === 'checkbox' || role === 'radio' || role === 'slider') {
      const nearby = getNearbyLabelText(el);
      if (nearby) return this.truncate(nearby, 60);
    }

    // Fallback for editable elements: never drop them from scan results even when empty.
    // Use role, type, or tag to generate a minimal description so the AI can still target them.
    if (isEditable) {
      if (role) return role;
      if (tag === 'input') {
        const type = (el as HTMLInputElement).type || 'text';
        return `${type} input`;
      }
      if (tag === 'textarea') return 'textarea';
      if (tag === 'select') return 'select';
      // contenteditable
      return 'editable area';
    }

    return '';
  }

  private findLabelText(el: HTMLElement): string {
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel?.textContent?.trim()) {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input, select, textarea').forEach((c) => c.remove());
      if (clone.textContent?.trim()) return clone.textContent.trim();
    }
    return '';
  }

  private generateSelector(el: HTMLElement): string {
    // Prefer #id
    if (el.id) return `#${el.id}`;

    // Prefer [data-testid]
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;

    // Prefer [name]
    const name = el.getAttribute('name');
    if (name) {
      const tag = el.tagName.toLowerCase();
      return `${tag}[name="${name}"]`;
    }

    // Fallback: tag.class:nth-of-type
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList).filter((c) => !c.startsWith('vsdk-')).join('.');
    const parent = el.parentElement;

    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      const index = siblings.indexOf(el) + 1;
      const classSelector = classes ? `.${classes}` : '';
      if (siblings.length > 1) {
        return `${tag}${classSelector}:nth-of-type(${index})`;
      }
      return `${tag}${classSelector}`;
    }

    return classes ? `${tag}.${classes}` : tag;
  }

  private captureState(el: HTMLElement): Record<string, string> {
    const state: Record<string, string> = {};

    // Checked state
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      state['checked'] = String(el.checked);
    }

    // aria-selected
    const ariaSelected = el.getAttribute('aria-selected');
    if (ariaSelected) state['aria-selected'] = ariaSelected;

    // aria-expanded
    const ariaExpanded = el.getAttribute('aria-expanded');
    if (ariaExpanded) state['aria-expanded'] = ariaExpanded;

    // aria-checked (for role=switch/checkbox)
    const ariaChecked = el.getAttribute('aria-checked');
    if (ariaChecked) state['aria-checked'] = ariaChecked;

    // disabled
    if ((el as HTMLButtonElement).disabled) {
      state['disabled'] = 'true';
    }

    // open state for details
    if (el.tagName.toLowerCase() === 'summary') {
      const details = el.closest('details');
      if (details) state['open'] = String(details.open);
    }

    // Current value for selects
    if (el instanceof HTMLSelectElement && el.value) {
      state['value'] = el.value;
    }

    return state;
  }

  private truncate(text: string, max: number): string {
    // Collapse whitespace
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    return clean.slice(0, max - 3) + '...';
  }
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

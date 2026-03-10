import type { InteractiveElement, ElementCapability } from '../types';
import { INTERACTIVE_SELECTOR } from '../constants';

/**
 * Deeply scans the DOM for all interactive elements and categorizes
 * their capabilities. Generates human-readable descriptions and
 * stable CSS selectors for each element.
 */
export class InteractiveElementScanner {
  private maxElements: number;

  constructor(maxElements = 100) {
    this.maxElements = maxElements;
  }

  /**
   * Full scan of interactive elements on the page.
   */
  scan(): InteractiveElement[] {
    const rawElements = document.querySelectorAll(INTERACTIVE_SELECTOR);
    const results: InteractiveElement[] = [];

    for (const el of rawElements) {
      if (results.length >= this.maxElements) break;

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

      const selector = this.generateSelector(htmlEl);
      const role = htmlEl.getAttribute('role') || undefined;
      const state = this.captureState(htmlEl);
      const inViewport = this.isInViewport(htmlEl);

      results.push({
        description,
        selector,
        tagName: htmlEl.tagName.toLowerCase(),
        role,
        capabilities,
        state: Object.keys(state).length > 0 ? state : undefined,
        inViewport,
      });
    }

    // Sort: viewport elements first, then off-screen
    results.sort((a, b) => {
      if (a.inViewport && !b.inViewport) return -1;
      if (!a.inViewport && b.inViewport) return 1;
      return 0;
    });

    return results;
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
      el.getAttribute('contenteditable') === 'true' ||
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

    // For inputs, use label or name
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const label = this.findLabelText(el);
      if (label) return this.truncate(label, 60);
      const name = el.getAttribute('name');
      if (name) return name;
    }

    // Text content (trimmed, truncated)
    const text = el.textContent?.trim();
    if (text) return this.truncate(text, 60);

    // For label-less controls (switches, checkboxes), look at nearby sibling/parent text
    if (role === 'switch' || role === 'checkbox' || role === 'radio' || role === 'slider') {
      const nearby = this.findNearbyLabelText(el);
      if (nearby) return this.truncate(nearby, 60);
    }

    return '';
  }

  /**
   * For controls without their own text (role=switch, checkbox, etc.),
   * look at sibling elements and parent containers for label text.
   */
  private findNearbyLabelText(el: HTMLElement): string {
    // Check preceding siblings for text
    let sibling = el.previousElementSibling;
    while (sibling) {
      const text = sibling.textContent?.trim();
      if (text && text.length < 80) return text;
      sibling = sibling.previousElementSibling;
    }

    // Walk up to find a container with text that isn't just the element itself
    let parent = el.parentElement;
    for (let depth = 0; parent && depth < 3; depth++) {
      // Look at siblings of the parent
      const prevSibling = parent.previousElementSibling;
      if (prevSibling) {
        const text = prevSibling.textContent?.trim();
        if (text && text.length < 80) return text;
      }
      parent = parent.parentElement;
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

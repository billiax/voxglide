/**
 * Built-in DOM manipulation actions the AI can call.
 */

import { waitForElement } from './ElementWaiter';
import { INTERACTIVE_SELECTOR } from '../constants';
import { scoreText, getNearbyLabelText, dispatchClickSequence } from './dom-utils';

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type EditableElement = FieldElement | HTMLElement;

// ── Element caches ──

const fieldCache = new Map<string, HTMLElement>();
const clickCache = new Map<string, HTMLElement>();

function getCachedField(fieldId: string): EditableElement | null {
  const cached = fieldCache.get(fieldId);
  if (cached?.isConnected) return cached as EditableElement;
  fieldCache.delete(fieldId);
  return null;
}

function getCachedClick(key: string): HTMLElement | null {
  const cached = clickCache.get(key);
  if (cached?.isConnected) return cached;
  clickCache.delete(key);
  return null;
}

export function invalidateElementCache(): void {
  fieldCache.clear();
  clickCache.clear();
}

// ── Module-level resolver/callback setters ──

let indexResolver: ((index: number) => HTMLElement | null) | null = null;

export function setIndexResolver(resolver: ((index: number) => HTMLElement | null) | null): void {
  indexResolver = resolver;
}

let rescanCallback: (() => Promise<void>) | null = null;

export function setRescanCallback(callback: (() => Promise<void>) | null): void {
  rescanCallback = callback;
}

let postClickCallback: (() => void) | null = null;

export function setPostClickCallback(callback: (() => void) | null): void {
  postClickCallback = callback;
}

/**
 * Resolve a form field by cascading through: id → name → label text → placeholder → aria-label → combobox → scored fuzzy
 */
function resolveField(fieldId: string): EditableElement | null {
  // Check cache first
  const cached = getCachedField(fieldId);
  if (cached) return cached;

  // 1. By ID
  const byId = document.getElementById(fieldId);
  if (byId && isEditableElement(byId)) return cacheField(fieldId, byId);

  // 2. By name
  const byName = document.querySelector(`[name="${fieldId}"]`);
  if (byName && isEditableElement(byName)) return cacheField(fieldId, byName);

  // 3. By label text (case-insensitive)
  const labels = document.querySelectorAll('label');
  for (const label of labels) {
    if (label.textContent?.trim().toLowerCase() === fieldId.toLowerCase()) {
      const forAttr = label.getAttribute('for');
      if (forAttr) {
        const el = document.getElementById(forAttr);
        if (el && isEditableElement(el)) return cacheField(fieldId, el);
      }
      // Check nested field
      const nested = label.querySelector('input, select, textarea, [contenteditable]:not([contenteditable="false"])');
      if (nested && isEditableElement(nested)) return cacheField(fieldId, nested);
    }
  }

  // 4. By placeholder (case-insensitive)
  const allFields = document.querySelectorAll('input, select, textarea, [contenteditable]:not([contenteditable="false"])');
  for (const el of allFields) {
    const placeholder = (el as HTMLInputElement).placeholder;
    if (placeholder && placeholder.toLowerCase() === fieldId.toLowerCase()) {
      return cacheField(fieldId, el as EditableElement);
    }
  }

  // 5. By aria-label (case-insensitive)
  for (const el of allFields) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.toLowerCase() === fieldId.toLowerCase()) {
      return cacheField(fieldId, el as EditableElement);
    }
  }

  // 6. By combobox role with aria-label/label match
  const comboboxes = document.querySelectorAll('[role="combobox"]');
  for (const el of comboboxes) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.toLowerCase() === fieldId.toLowerCase()) {
      return cacheField(fieldId, el as EditableElement);
    }
  }

  // 7. Scored fuzzy resolution
  return scoredFuzzyResolve(fieldId);
}

function cacheField(fieldId: string, el: EditableElement): EditableElement {
  fieldCache.set(fieldId, el);
  return el;
}

/**
 * Scored fuzzy resolution: scores candidates against label text, placeholder,
 * aria-label, and name attribute. Returns the best match or null.
 *
 * Scoring: exact=100, starts-with=80, word-boundary=60, contains=40.
 * On tie, prefer visible/enabled elements.
 */
function scoredFuzzyResolve(fieldId: string): EditableElement | null {
  interface ScoredCandidate {
    el: EditableElement;
    score: number;
    visible: boolean;
    enabled: boolean;
  }

  const candidates: ScoredCandidate[] = [];

  // Score label-associated fields
  const labels = document.querySelectorAll('label');
  for (const label of labels) {
    const labelScore = scoreText(label.textContent, fieldId);
    if (labelScore === 0) continue;

    const forAttr = label.getAttribute('for');
    if (forAttr) {
      const el = document.getElementById(forAttr);
      if (el && isEditableElement(el)) {
        const htmlEl = el as HTMLElement;
        candidates.push({
          el,
          score: labelScore,
          visible: htmlEl.offsetParent !== null,
          enabled: !(el as HTMLInputElement).disabled,
        });
      }
    }
    const nested = label.querySelector('input, select, textarea, [contenteditable]:not([contenteditable="false"])');
    if (nested && isEditableElement(nested)) {
      const htmlEl = nested as HTMLElement;
      candidates.push({
        el: nested,
        score: labelScore,
        visible: htmlEl.offsetParent !== null,
        enabled: !(nested as HTMLInputElement).disabled,
      });
    }
  }

  // Score all editable fields by placeholder, aria-label, name
  const allFields = document.querySelectorAll('input, select, textarea, [contenteditable]:not([contenteditable="false"])');
  for (const el of allFields) {
    if (!isEditableElement(el)) continue;

    const placeholderScore = scoreText((el as HTMLInputElement).placeholder, fieldId);
    const ariaScore = scoreText(el.getAttribute('aria-label'), fieldId);
    const nameScore = scoreText(el.getAttribute('name'), fieldId);
    const bestScore = Math.max(placeholderScore, ariaScore, nameScore);

    if (bestScore > 0) {
      const htmlEl = el as HTMLElement;
      candidates.push({
        el,
        score: bestScore,
        visible: htmlEl.offsetParent !== null,
        enabled: !(el as HTMLInputElement).disabled,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Sort by score descending, then prefer visible+enabled on tie
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // On tie: prefer visible and enabled
    const aRank = (a.visible ? 2 : 0) + (a.enabled ? 1 : 0);
    const bRank = (b.visible ? 2 : 0) + (b.enabled ? 1 : 0);
    return bRank - aRank;
  });

  return cacheField(fieldId, candidates[0].el);
}

function isFieldElement(el: Element): el is FieldElement {
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

function isEditableElement(el: Element): el is EditableElement {
  return isFieldElement(el) || (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false');
}

function isContentEditable(el: Element): boolean {
  return el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false';
}

/**
 * Set a field value and dispatch change events so frameworks detect the update.
 * Note: focus should already have been called by the caller.
 */
function setFieldValue(el: EditableElement, value: string): void {
  // Handle contenteditable elements
  if (isContentEditable(el) && !isFieldElement(el)) {
    (el as HTMLElement).textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (el instanceof HTMLSelectElement) {
    // Find matching option by text or value
    const option = Array.from(el.options).find(
      (o) => o.text.toLowerCase() === value.toLowerCase() || o.value.toLowerCase() === value.toLowerCase()
    );
    if (option) {
      el.value = option.value;
    } else {
      el.value = value;
    }
  } else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    el.checked = value === 'true' || value === '1' || value === 'yes';
  } else {
    // Use native setter to trigger React/Vue/etc. change detection
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      (el as HTMLInputElement | HTMLTextAreaElement).value = value;
    }
  }

  // Dispatch events to notify frameworks (focus already called by caller)
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

/**
 * Attempt to fill a combobox by clicking it and selecting from the dropdown.
 */
async function fillCombobox(el: HTMLElement, value: string): Promise<boolean> {
  // 1. Click to open the dropdown
  el.click();
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

  // 2. Wait for options to appear
  const optionEl = await waitForElement(() => {
    const listbox = document.querySelector('[role="listbox"], [role="menu"]');
    if (!listbox) return null;
    const options = listbox.querySelectorAll('[role="option"], [role="menuitem"], li');
    for (const opt of options) {
      if (opt.textContent?.trim().toLowerCase().includes(value.toLowerCase())) {
        return opt as HTMLElement;
      }
    }
    return null;
  }, 2000);

  if (optionEl) {
    optionEl.click();
    return true;
  }
  return false;
}

/**
 * Resolve a clickable element using scored matching across text, aria-label, title, and nearby labels.
 * Returns the best match (highest score), preferring visible elements on tie.
 */
function resolveClickTarget(description: string, selector?: string): HTMLElement | null {
  // Check cache
  const cacheKey = selector || description;
  const cached = getCachedClick(cacheKey);
  if (cached) return cached;

  // 1. Exact CSS selector if provided
  if (selector) {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el) return cacheClick(cacheKey, el);
  }

  if (!description) return null;

  // 2. Scored matching across all clickable elements
  const clickables = document.querySelectorAll(INTERACTIVE_SELECTOR);

  interface ScoredClickCandidate {
    el: HTMLElement;
    score: number;
    visible: boolean;
  }

  const candidates: ScoredClickCandidate[] = [];

  for (const el of clickables) {
    const htmlEl = el as HTMLElement;

    // Score across multiple text sources, take best
    const textScore = scoreText(el.textContent?.trim(), description);
    const ariaScore = scoreText(el.getAttribute('aria-label'), description);
    const titleScore = scoreText(htmlEl.title, description);

    // Check nearby label for label-less controls
    let nearbyScore = 0;
    const role = el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    const isLabellessControl = role === 'switch' || role === 'checkbox' || role === 'slider'
      || (tag === 'input' && ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio'));
    if (isLabellessControl) {
      const nearbyText = getNearbyLabelText(htmlEl);
      nearbyScore = scoreText(nearbyText, description);
    }

    const bestScore = Math.max(textScore, ariaScore, titleScore, nearbyScore);
    if (bestScore > 0) {
      candidates.push({
        el: htmlEl,
        score: bestScore,
        visible: htmlEl.offsetParent !== null,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Sort by score descending, prefer visible on tie
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.visible && !b.visible) return -1;
    if (!a.visible && b.visible) return 1;
    return 0;
  });

  return cacheClick(cacheKey, candidates[0].el);
}

function cacheClick(key: string, el: HTMLElement): HTMLElement {
  clickCache.set(key, el);
  return el;
}

// ── Exported action handlers ──

export async function fillField(args: Record<string, unknown>): Promise<{ result: string }> {
  const fieldId = String(args.fieldId || '');
  const value = String(args.value || '');
  const index = typeof args.index === 'number' ? args.index : undefined;

  if (!fieldId && index === undefined) return { result: JSON.stringify({ error: 'No fieldId or index provided' }) };

  // Try index-based resolution first
  let el: EditableElement | null = null;
  if (index !== undefined && indexResolver) {
    const resolved = indexResolver(index);
    if (resolved && isEditableElement(resolved)) {
      el = resolved;
    }
  }

  // Fall through to fieldId-based resolution
  if (!el && fieldId) {
    el = resolveField(fieldId);
    if (!el) {
      el = await waitForElement(() => resolveField(fieldId));
    }

    // Self-healing retry: re-scan and try again
    if (!el && rescanCallback) {
      invalidateElementCache();
      await rescanCallback();
      el = resolveField(fieldId);
    }
  }

  if (!el) return { result: JSON.stringify({ error: `Could not find field "${fieldId || `index:${index}`}"` }) };

  if ((el as HTMLInputElement).type === 'password') {
    return { result: JSON.stringify({ error: 'Cannot fill password fields' }) };
  }

  if ((el as HTMLInputElement).disabled) {
    return { result: JSON.stringify({ error: `Field "${fieldId || `index:${index}`}" is disabled` }) };
  }

  // Check if this is a combobox
  if (el.getAttribute('role') === 'combobox' || el.closest('[role="combobox"]')) {
    const comboEl = el.getAttribute('role') === 'combobox' ? el : el.closest('[role="combobox"]')!;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const filled = await fillCombobox(comboEl as HTMLElement, value);
    if (filled) {
      return { result: JSON.stringify({ success: true, field: fieldId || `index:${index}`, value }) };
    }
    return { result: JSON.stringify({ error: `Could not select "${value}" from combobox "${fieldId || `index:${index}`}".` }) };
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  el.focus();
  setFieldValue(el, value);

  return { result: JSON.stringify({ success: true, field: fieldId || `index:${index}`, value }) };
}

export async function clickElement(args: Record<string, unknown>): Promise<{ result: string }> {
  const description = String(args.description || '');
  const selector = args.selector ? String(args.selector) : undefined;
  const index = typeof args.index === 'number' ? args.index : undefined;

  if (!description && !selector && index === undefined) {
    return { result: JSON.stringify({ error: 'No description, selector, or index provided' }) };
  }

  const urlBefore = window.location.href;

  // Try index-based resolution first
  if (index !== undefined && indexResolver) {
    const el = indexResolver(index);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      dispatchClickSequence(el);
      notifyIfUrlChanged(urlBefore);
      // Include element text so the AI (and admin) can verify what was clicked
      const elText = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 80) || '';
      const clickedLabel = description || elText || `index:${index}`;
      return { result: JSON.stringify({ success: true, clicked: clickedLabel, index }) };
    }
  }

  // Fall through to description/selector resolution
  let el = resolveClickTarget(description, selector);
  if (!el) {
    el = await waitForElement(() => resolveClickTarget(description, selector));
  }

  // Self-healing retry: re-scan and try again
  if (!el && rescanCallback) {
    invalidateElementCache();
    await rescanCallback();
    el = resolveClickTarget(description, selector);
  }

  if (!el) return { result: JSON.stringify({ error: `Could not find element "${description}"` }) };

  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  dispatchClickSequence(el);
  notifyIfUrlChanged(urlBefore);

  return { result: JSON.stringify({ success: true, clicked: description || selector }) };
}

/**
 * Check if URL changed after a click (SPA navigation) and notify the SDK.
 * Uses a microtask delay to let pushState/replaceState fire first.
 */
function notifyIfUrlChanged(urlBefore: string): void {
  if (!postClickCallback) return;
  // Check immediately (synchronous pushState)
  if (window.location.href !== urlBefore) {
    postClickCallback();
    return;
  }
  // Check after microtask (async navigation)
  Promise.resolve().then(() => {
    if (window.location.href !== urlBefore) {
      postClickCallback?.();
    }
  });
}

export async function readContent(args: Record<string, unknown>): Promise<{ result: string }> {
  const selector = String(args.selector || 'main');

  const el = document.querySelector(selector);
  if (!el) return { result: JSON.stringify({ error: `No element found for selector "${selector}"` }) };

  const text = el.textContent?.trim() || '';
  // Truncate to 2000 chars
  return { result: JSON.stringify({ content: text.slice(0, 2000) }) };
}

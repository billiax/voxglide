/**
 * Built-in DOM manipulation actions the AI can call.
 */

import { waitForElement } from './ElementWaiter';
import { INTERACTIVE_SELECTOR } from '../constants';

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
  const lower = fieldId.toLowerCase();

  interface ScoredCandidate {
    el: EditableElement;
    score: number;
    visible: boolean;
    enabled: boolean;
  }

  function scoreText(text: string | null | undefined): number {
    if (!text) return 0;
    const t = text.trim().toLowerCase();
    if (!t) return 0;
    if (t === lower) return 100;
    if (t.startsWith(lower)) return 80;
    // Word boundary: check if fieldId appears after a word boundary
    const wordBoundaryPattern = new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (wordBoundaryPattern.test(t)) return 60;
    if (t.includes(lower)) return 40;
    return 0;
  }

  const candidates: ScoredCandidate[] = [];

  // Score label-associated fields
  const labels = document.querySelectorAll('label');
  for (const label of labels) {
    const labelScore = scoreText(label.textContent);
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

    const placeholderScore = scoreText((el as HTMLInputElement).placeholder);
    const ariaScore = scoreText(el.getAttribute('aria-label'));
    const nameScore = scoreText(el.getAttribute('name'));
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

  // Dispatch events to notify frameworks
  el.dispatchEvent(new Event('focus', { bubbles: true }));
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
 * Resolve a clickable element by text content → aria-label → title → nearby label → CSS selector
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

  const lower = description.toLowerCase();

  // 2. By text content (using full interactive selector)
  const clickables = document.querySelectorAll(INTERACTIVE_SELECTOR);
  for (const el of clickables) {
    const text = el.textContent?.trim().toLowerCase();
    if (text === lower) return cacheClick(cacheKey, el as HTMLElement);
  }

  // 3. Partial text match
  for (const el of clickables) {
    const text = el.textContent?.trim().toLowerCase();
    if (text && text.includes(lower)) return cacheClick(cacheKey, el as HTMLElement);
  }

  // 4. By aria-label
  for (const el of clickables) {
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase();
    if (ariaLabel && (ariaLabel === lower || ariaLabel.includes(lower))) return cacheClick(cacheKey, el as HTMLElement);
  }

  // 5. By title
  for (const el of clickables) {
    const title = (el as HTMLElement).title?.toLowerCase();
    if (title && (title === lower || title.includes(lower))) return cacheClick(cacheKey, el as HTMLElement);
  }

  // 6. By nearby label text — for label-less controls (switches, toggles, checkboxes)
  //    Search sibling/parent text that matches the description
  for (const el of clickables) {
    const role = el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    const isLabellessControl = role === 'switch' || role === 'checkbox' || role === 'slider'
      || (tag === 'input' && ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio'));
    if (!isLabellessControl) continue;

    const nearbyText = getNearbyLabelText(el as HTMLElement);
    if (nearbyText && nearbyText.includes(lower)) {
      return cacheClick(cacheKey, el as HTMLElement);
    }
  }

  return null;
}

/**
 * Find label text from sibling/parent elements for controls without their own text.
 * Searches both preceding and following siblings.
 */
function getNearbyLabelText(el: HTMLElement): string {
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

function cacheClick(key: string, el: HTMLElement): HTMLElement {
  clickCache.set(key, el);
  return el;
}

// ── Exported action handlers ──

export async function fillField(args: Record<string, unknown>): Promise<{ result: string }> {
  const fieldId = String(args.fieldId || '');
  const value = String(args.value || '');

  if (!fieldId) return { result: JSON.stringify({ error: 'No fieldId provided' }) };

  // Try immediate resolve, then wait for element
  let el = resolveField(fieldId);
  if (!el) {
    el = await waitForElement(() => resolveField(fieldId));
  }
  if (!el) return { result: JSON.stringify({ error: `Could not find field "${fieldId}"` }) };

  if ((el as HTMLInputElement).type === 'password') {
    return { result: JSON.stringify({ error: 'Cannot fill password fields' }) };
  }

  if ((el as HTMLInputElement).disabled) {
    return { result: JSON.stringify({ error: `Field "${fieldId}" is disabled` }) };
  }

  // Check if this is a combobox
  if (el.getAttribute('role') === 'combobox' || el.closest('[role="combobox"]')) {
    const comboEl = el.getAttribute('role') === 'combobox' ? el : el.closest('[role="combobox"]')!;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const filled = await fillCombobox(comboEl as HTMLElement, value);
    if (filled) {
      return { result: JSON.stringify({ success: true, field: fieldId, value }) };
    }
    return { result: JSON.stringify({ error: `Could not select "${value}" from combobox "${fieldId}".` }) };
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  el.focus();
  setFieldValue(el, value);

  return { result: JSON.stringify({ success: true, field: fieldId, value }) };
}

export async function clickElement(args: Record<string, unknown>): Promise<{ result: string }> {
  const description = String(args.description || '');
  const selector = args.selector ? String(args.selector) : undefined;

  if (!description && !selector) return { result: JSON.stringify({ error: 'No description or selector provided' }) };

  // Try immediate resolve, then wait for element
  let el = resolveClickTarget(description, selector);
  if (!el) {
    el = await waitForElement(() => resolveClickTarget(description, selector));
  }
  if (!el) return { result: JSON.stringify({ error: `Could not find element "${description}"` }) };

  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  el.click();

  return { result: JSON.stringify({ success: true, clicked: description }) };
}

export async function readContent(args: Record<string, unknown>): Promise<{ result: string }> {
  const selector = String(args.selector || 'main');

  const el = document.querySelector(selector);
  if (!el) return { result: JSON.stringify({ error: `No element found for selector "${selector}"` }) };

  const text = el.textContent?.trim() || '';
  // Truncate to 2000 chars
  return { result: JSON.stringify({ content: text.slice(0, 2000) }) };
}

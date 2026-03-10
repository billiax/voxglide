/**
 * Built-in DOM manipulation actions the AI can call.
 */

import { waitForElement } from './ElementWaiter';
import { INTERACTIVE_SELECTOR } from '../constants';

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

// ── Element caches ──

const fieldCache = new Map<string, HTMLElement>();
const clickCache = new Map<string, HTMLElement>();

function getCachedField(fieldId: string): FieldElement | null {
  const cached = fieldCache.get(fieldId);
  if (cached?.isConnected) return cached as FieldElement;
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
 * Resolve a form field by cascading through: id → name → label text → placeholder → aria-label → combobox
 */
function resolveField(fieldId: string): FieldElement | null {
  // Check cache first
  const cached = getCachedField(fieldId);
  if (cached) return cached;

  // 1. By ID
  const byId = document.getElementById(fieldId) as FieldElement | null;
  if (byId && isFieldElement(byId)) return cacheField(fieldId, byId);

  // 2. By name
  const byName = document.querySelector(`[name="${fieldId}"]`) as FieldElement | null;
  if (byName && isFieldElement(byName)) return cacheField(fieldId, byName);

  // 3. By label text (case-insensitive)
  const labels = document.querySelectorAll('label');
  for (const label of labels) {
    if (label.textContent?.trim().toLowerCase() === fieldId.toLowerCase()) {
      const forAttr = label.getAttribute('for');
      if (forAttr) {
        const el = document.getElementById(forAttr) as FieldElement | null;
        if (el && isFieldElement(el)) return cacheField(fieldId, el);
      }
      // Check nested field
      const nested = label.querySelector('input, select, textarea') as FieldElement | null;
      if (nested) return cacheField(fieldId, nested);
    }
  }

  // 4. By placeholder (case-insensitive)
  const allFields = document.querySelectorAll('input, select, textarea');
  for (const el of allFields) {
    const placeholder = (el as HTMLInputElement).placeholder;
    if (placeholder && placeholder.toLowerCase() === fieldId.toLowerCase()) {
      return cacheField(fieldId, el as FieldElement);
    }
  }

  // 5. By aria-label (case-insensitive)
  for (const el of allFields) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.toLowerCase() === fieldId.toLowerCase()) {
      return cacheField(fieldId, el as FieldElement);
    }
  }

  // 6. By combobox role with aria-label/label match
  const comboboxes = document.querySelectorAll('[role="combobox"]');
  for (const el of comboboxes) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.toLowerCase() === fieldId.toLowerCase()) {
      return cacheField(fieldId, el as FieldElement);
    }
  }

  // 7. Fuzzy: partial match on label, placeholder, or aria-label
  const lower = fieldId.toLowerCase();
  for (const label of labels) {
    if (label.textContent?.trim().toLowerCase().includes(lower)) {
      const forAttr = label.getAttribute('for');
      if (forAttr) {
        const el = document.getElementById(forAttr) as FieldElement | null;
        if (el && isFieldElement(el)) return cacheField(fieldId, el);
      }
      const nested = label.querySelector('input, select, textarea') as FieldElement | null;
      if (nested) return cacheField(fieldId, nested);
    }
  }

  return null;
}

function cacheField(fieldId: string, el: FieldElement): FieldElement {
  fieldCache.set(fieldId, el);
  return el;
}

function isFieldElement(el: Element): el is FieldElement {
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

/**
 * Set a field value and dispatch change events so frameworks detect the update.
 */
function setFieldValue(el: FieldElement, value: string): void {
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
      el.value = value;
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
 */
function getNearbyLabelText(el: HTMLElement): string {
  // Check preceding siblings
  let sibling = el.previousElementSibling;
  while (sibling) {
    const text = sibling.textContent?.trim().toLowerCase();
    if (text && text.length < 100) return text;
    sibling = sibling.previousElementSibling;
  }

  // Walk up to parent containers and check their text/siblings
  let parent = el.parentElement;
  for (let depth = 0; parent && depth < 3; depth++) {
    const prevSibling = parent.previousElementSibling;
    if (prevSibling) {
      const text = prevSibling.textContent?.trim().toLowerCase();
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

  if (el.disabled) {
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
    // Fall through to regular fill if combobox selection failed
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

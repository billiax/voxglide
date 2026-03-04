/**
 * Built-in DOM manipulation actions the AI can call.
 */

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * Resolve a form field by cascading through: id → name → label text → placeholder → aria-label
 */
function resolveField(fieldId: string): FieldElement | null {
  // 1. By ID
  const byId = document.getElementById(fieldId) as FieldElement | null;
  if (byId && isFieldElement(byId)) return byId;

  // 2. By name
  const byName = document.querySelector(`[name="${fieldId}"]`) as FieldElement | null;
  if (byName && isFieldElement(byName)) return byName;

  // 3. By label text (case-insensitive)
  const labels = document.querySelectorAll('label');
  for (const label of labels) {
    if (label.textContent?.trim().toLowerCase() === fieldId.toLowerCase()) {
      const forAttr = label.getAttribute('for');
      if (forAttr) {
        const el = document.getElementById(forAttr) as FieldElement | null;
        if (el && isFieldElement(el)) return el;
      }
      // Check nested field
      const nested = label.querySelector('input, select, textarea') as FieldElement | null;
      if (nested) return nested;
    }
  }

  // 4. By placeholder (case-insensitive)
  const allFields = document.querySelectorAll('input, select, textarea');
  for (const el of allFields) {
    const placeholder = (el as HTMLInputElement).placeholder;
    if (placeholder && placeholder.toLowerCase() === fieldId.toLowerCase()) {
      return el as FieldElement;
    }
  }

  // 5. By aria-label (case-insensitive)
  for (const el of allFields) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.toLowerCase() === fieldId.toLowerCase()) {
      return el as FieldElement;
    }
  }

  // 6. Fuzzy: partial match on label, placeholder, or aria-label
  const lower = fieldId.toLowerCase();
  for (const label of labels) {
    if (label.textContent?.trim().toLowerCase().includes(lower)) {
      const forAttr = label.getAttribute('for');
      if (forAttr) {
        const el = document.getElementById(forAttr) as FieldElement | null;
        if (el && isFieldElement(el)) return el;
      }
      const nested = label.querySelector('input, select, textarea') as FieldElement | null;
      if (nested) return nested;
    }
  }

  return null;
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
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Resolve a clickable element by text content → aria-label → title → CSS selector
 */
function resolveClickTarget(description: string, selector?: string): HTMLElement | null {
  // 1. Exact CSS selector if provided
  if (selector) {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el) return el;
  }

  const lower = description.toLowerCase();

  // 2. By text content (buttons, links)
  const clickables = document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]');
  for (const el of clickables) {
    const text = el.textContent?.trim().toLowerCase();
    if (text === lower) return el as HTMLElement;
  }

  // 3. Partial text match
  for (const el of clickables) {
    const text = el.textContent?.trim().toLowerCase();
    if (text && text.includes(lower)) return el as HTMLElement;
  }

  // 4. By aria-label
  for (const el of clickables) {
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase();
    if (ariaLabel && (ariaLabel === lower || ariaLabel.includes(lower))) return el as HTMLElement;
  }

  // 5. By title
  for (const el of clickables) {
    const title = (el as HTMLElement).title?.toLowerCase();
    if (title && (title === lower || title.includes(lower))) return el as HTMLElement;
  }

  return null;
}

// ── Exported action handlers ──

export async function fillField(args: Record<string, unknown>): Promise<{ result: string }> {
  const fieldId = String(args.fieldId || '');
  const value = String(args.value || '');

  if (!fieldId) return { result: JSON.stringify({ error: 'No fieldId provided' }) };

  const el = resolveField(fieldId);
  if (!el) return { result: JSON.stringify({ error: `Could not find field "${fieldId}"` }) };

  if ((el as HTMLInputElement).type === 'password') {
    return { result: JSON.stringify({ error: 'Cannot fill password fields' }) };
  }

  if (el.disabled) {
    return { result: JSON.stringify({ error: `Field "${fieldId}" is disabled` }) };
  }

  el.focus();
  setFieldValue(el, value);

  return { result: JSON.stringify({ success: true, field: fieldId, value }) };
}

export async function clickElement(args: Record<string, unknown>): Promise<{ result: string }> {
  const description = String(args.description || '');
  const selector = args.selector ? String(args.selector) : undefined;

  if (!description && !selector) return { result: JSON.stringify({ error: 'No description or selector provided' }) };

  const el = resolveClickTarget(description, selector);
  if (!el) return { result: JSON.stringify({ error: `Could not find element "${description}"` }) };

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

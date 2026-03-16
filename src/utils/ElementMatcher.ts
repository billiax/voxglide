/**
 * Find the label text for an HTML element.
 * Checks: label[for] → parent <label> (clone-and-strip) → aria-label → placeholder → name/id fallback.
 */
export function findLabelText(el: HTMLElement): string {
  // 1. Explicit <label for="...">
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  // 2. Wrapping <label>
  const parentLabel = el.closest('label');
  if (parentLabel?.textContent?.trim()) {
    // Remove the input's own value text from the label
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea').forEach((c) => c.remove());
    if (clone.textContent?.trim()) return clone.textContent.trim();
  }

  // 3. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // 4. Placeholder
  const placeholder = (el as HTMLInputElement).placeholder;
  if (placeholder) return placeholder;

  // 5. Name/id as fallback
  return (el as HTMLInputElement).name || el.id || '';
}

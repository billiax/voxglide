/**
 * Waits for a DOM element to appear using MutationObserver.
 * Returns the element if already present, or watches for it up to timeoutMs.
 */
export function waitForElement<T extends HTMLElement>(
  resolver: () => T | null,
  timeoutMs = 3000,
): Promise<T | null> {
  const existing = resolver();
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;

    const observer = new MutationObserver(() => {
      const el = resolver();
      if (el && !settled) {
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        observer.disconnect();
        resolve(null);
      }
    }, timeoutMs);
  });
}

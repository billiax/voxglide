import type { PageContextProvider } from '../../context/PageContextProvider';

/**
 * Take a page snapshot using the existing PageContextProvider pipeline.
 * Forces a fresh scan, then returns the formatted context string
 * (forms, interactive elements, headings, nav, content — all with TokenBudget allocation).
 */
export async function takePageSnapshot(
  provider: PageContextProvider,
): Promise<string> {
  // Force fresh scan (invalidate fingerprint cache)
  provider.markDirty();

  const { content } = await provider.getContext();

  const header = [
    `URL: ${window.location.href}`,
    `Title: ${document.title}`,
    `Viewport: ${window.innerWidth}x${window.innerHeight}`,
  ].join('\n');

  return `${header}\n\n${content}`;
}

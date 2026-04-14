export interface ScreenshotOptions {
  /** JPEG quality 0–1 (default 0.6) */
  quality?: number;
  /** Max capture width in px (default 1440) */
  maxWidth?: number;
  /** Max capture height in px (default 900) */
  maxHeight?: number;
}

/**
 * Capture a screenshot of the current page using html2canvas.
 * Returns base64-encoded JPEG string (no `data:` prefix), or null on failure.
 * The library is dynamically loaded from CDN and cached on `window.html2canvas`.
 */
export async function captureScreenshot(opts?: ScreenshotOptions): Promise<string | null> {
  try {
    const html2canvas = await loadHtml2Canvas();
    if (!html2canvas) return null;

    const quality = opts?.quality ?? 0.6;
    const maxWidth = opts?.maxWidth ?? 1440;
    const maxHeight = opts?.maxHeight ?? 900;

    const canvas = await html2canvas(document.body, {
      logging: false,
      useCORS: true,
      allowTaint: true,
      scale: window.devicePixelRatio > 1 ? 0.5 : 0.75,
      windowWidth: Math.min(document.documentElement.clientWidth, maxWidth),
      windowHeight: Math.min(document.documentElement.clientHeight, maxHeight),
    });

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return dataUrl.split(',')[1];
  } catch {
    return null;
  }
}

const SCRIPT_LOAD_TIMEOUT_MS = 5000;

async function loadHtml2Canvas(): Promise<any> {
  if ((window as any).html2canvas) return (window as any).html2canvas;

  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

    let settled = false;
    const settle = (value: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      settle(null);
      // Remove the script tag if it never loaded — prevent orphaned element
      script.remove();
    }, SCRIPT_LOAD_TIMEOUT_MS);

    script.onload = () => settle((window as any).html2canvas);
    script.onerror = () => settle(null);
    document.head.appendChild(script);
  });
}

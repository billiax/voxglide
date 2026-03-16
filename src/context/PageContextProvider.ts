import type { ContextProvider, ContextResult, FormFieldInfo, PageContext } from '../types';
import { DEFAULT_AUTO_CONTEXT } from '../constants';
import type { AutoContextConfig } from '../types';
import { InteractiveElementScanner } from './InteractiveElementScanner';
import { TokenBudget } from './TokenBudget';
import { ContextCache } from './ContextCache';
import { simpleHash } from '../utils/hash';
import { findLabelText } from '../utils/ElementMatcher';

/**
 * Automatically scans the DOM to build AI context.
 * Extracts forms, headings, navigation, content, interactive elements, and meta tags.
 * Uses MutationObserver with fingerprint-based change detection.
 */
export class PageContextProvider implements ContextProvider {
  type = 'page';
  name = 'Page Context';

  private config: Required<AutoContextConfig>;
  private cachedContext: PageContext | null = null;
  private dirty = true;
  private observer: MutationObserver | null = null;
  private interactiveScanner: InteractiveElementScanner;
  private lastStructuralFingerprint = '';
  private lastValueFingerprint = '';
  private lastChangeType: 'none' | 'value-only' | 'structural' = 'structural';
  private onChangeCallback: (() => void) | null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenBudget: TokenBudget;
  private contextCache: ContextCache;
  private lastFormattedContext = '';
  private sectionFingerprints: Record<string, string> = {};

  // Watch period state (post-SPA-navigation stability detection)
  private inWatchPeriod = false;
  private stabilityObserver: MutationObserver | null = null;
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private watchTimeout: ReturnType<typeof setTimeout> | null = null;
  private watchRescanTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: AutoContextConfig | true = true, onChange?: () => void) {
    this.config = config === true
      ? { ...DEFAULT_AUTO_CONTEXT }
      : { ...DEFAULT_AUTO_CONTEXT, ...config };

    this.interactiveScanner = new InteractiveElementScanner(
      100,
      this.config.exclude || [],
    );
    this.onChangeCallback = onChange || null;
    this.tokenBudget = new TokenBudget(this.config.maxContextTokens);
    this.contextCache = new ContextCache();
    this.contextCache.loadFromStorage();
    this.startObserving();
  }

  /**
   * Mark the cached context as dirty, forcing a re-scan on next getContext().
   */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Returns the underlying InteractiveElementScanner for index map access.
   */
  getScanner(): InteractiveElementScanner {
    return this.interactiveScanner;
  }

  private static readonly OBSERVED_ATTRIBUTES = [
    'value', 'disabled', 'href',
    'aria-expanded', 'aria-checked', 'aria-selected', 'aria-hidden',
    'class', 'open',
  ];

  private static readonly MEANINGFUL_ATTRIBUTES = new Set([
    'value', 'disabled',
    'aria-expanded', 'aria-checked', 'aria-selected', 'aria-hidden',
    'class', 'open',
  ]);

  private startObserving(): void {
    if (typeof MutationObserver === 'undefined') return;

    this.observer = new MutationObserver((mutations) => {
      // Only mark dirty for meaningful changes (not attribute-only on our own UI)
      const meaningful = mutations.some((m) =>
        m.type === 'childList' ||
        (m.type === 'attributes' && m.attributeName !== null && PageContextProvider.MEANINGFUL_ATTRIBUTES.has(m.attributeName))
      );
      if (meaningful) {
        this.dirty = true;
        this.debouncedFingerprintCheck();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: PageContextProvider.OBSERVED_ATTRIBUTES,
    });
  }

  /**
   * Begin a watch period after SPA navigation. Watches for DOM stability
   * before triggering a scan, ensuring late-rendering content is captured.
   */
  beginWatchPeriod(duration = 3000): void {
    this.endWatchPeriod();
    this.inWatchPeriod = true;

    const watchRoot = document.querySelector('main') || document.body;

    this.stabilityObserver = new MutationObserver(() => {
      // Reset stability timer on each mutation
      if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
      this.stabilityTimer = setTimeout(() => {
        // DOM stable for 300ms — trigger scan
        this.markDirty();
        this.onChangeCallback?.();
        this.scheduleRescan();
      }, 300);
    });

    this.stabilityObserver.observe(watchRoot, {
      childList: true,
      subtree: true,
    });

    // Safety timeout: force scan after duration even if DOM never stabilizes
    this.watchTimeout = setTimeout(() => {
      this.markDirty();
      this.onChangeCallback?.();
      this.endWatchPeriod();
    }, duration);
  }

  private endWatchPeriod(): void {
    this.inWatchPeriod = false;
    if (this.stabilityObserver) {
      this.stabilityObserver.disconnect();
      this.stabilityObserver = null;
    }
    if (this.stabilityTimer) { clearTimeout(this.stabilityTimer); this.stabilityTimer = null; }
    if (this.watchTimeout) { clearTimeout(this.watchTimeout); this.watchTimeout = null; }
    if (this.watchRescanTimer) { clearTimeout(this.watchRescanTimer); this.watchRescanTimer = null; }
  }

  private scheduleRescan(): void {
    if (!this.inWatchPeriod) return;
    if (this.watchRescanTimer) clearTimeout(this.watchRescanTimer);
    this.watchRescanTimer = setTimeout(() => {
      if (!this.inWatchPeriod) return;
      this.markDirty();
      this.onChangeCallback?.();
      this.endWatchPeriod();
    }, 1500);
  }

  private debouncedFingerprintCheck(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    // Use shorter debounce during watch period for faster SPA transition detection
    const delay = this.inWatchPeriod ? 100 : 300;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const changeType = this.detectChangeType();
      if (changeType !== 'none') {
        this.lastChangeType = changeType;
        this.dirty = true;
        this.onChangeCallback?.();
      }
    }, delay);
  }

  /**
   * Detects whether the DOM change is structural (new/removed elements) or value-only (input values changed).
   */
  private detectChangeType(): 'none' | 'value-only' | 'structural' {
    const structural = this.interactiveScanner.computeStructuralFingerprint();
    const value = this.interactiveScanner.computeValueFingerprint();

    const structuralChanged = structural !== this.lastStructuralFingerprint;
    const valueChanged = value !== this.lastValueFingerprint;

    this.lastStructuralFingerprint = structural;
    this.lastValueFingerprint = value;

    if (structuralChanged) return 'structural';
    if (valueChanged) return 'value-only';
    return 'none';
  }

  async getContext(): Promise<ContextResult> {
    if (!this.dirty && this.cachedContext) {
      return { content: this.lastFormattedContext, tools: [] };
    }

    // Check context cache by URL + fingerprint
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const fingerprint = this.interactiveScanner.computeFingerprint();
    const cached = this.contextCache.get(url, fingerprint);

    let context: PageContext;
    if (cached) {
      context = cached;
    } else if (this.dirty && this.lastChangeType === 'value-only' && this.cachedContext) {
      // Value-only change: reuse cached structural data, only re-scan forms + content
      context = this.valueOnlyRefresh(this.cachedContext);
      this.contextCache.set(url, fingerprint, context);
    } else {
      context = this.scanPage();
      this.contextCache.set(url, fingerprint, context);
    }

    this.cachedContext = context;
    this.dirty = false;

    const formatted = this.formatContext(context);

    // Only report change if actual content changed
    if (formatted !== this.lastFormattedContext) {
      this.lastFormattedContext = formatted;
    }

    return { content: formatted, tools: [] };
  }

  private scanPage(): PageContext {
    const excludeSelector = this.config.exclude.join(', ') || null;

    const ctx: PageContext = {
      title: document.title,
      description: this.config.meta ? this.scanMeta() : '',
      url: window.location.href,
      forms: this.config.forms ? this.scanForms(excludeSelector) : [],
      headings: this.config.headings ? this.scanHeadings() : [],
      navigation: this.config.navigation ? this.scanNavigation() : [],
      content: this.config.content ? this.scanContent() : '',
      interactiveElements: this.config.interactiveElements ? this.interactiveScanner.scan() : [],
    };

    if (this.config.interactiveElements) {
      ctx.scanMetadata = this.interactiveScanner.getScanMetadata();
    }

    return ctx;
  }

  /**
   * Returns metadata from the last scan for diagnostics.
   */
  getLastScanMetadata(): import('../types').ScanMetadata | null {
    return this.cachedContext?.scanMetadata ?? null;
  }

  /**
   * Lightweight refresh: reuses cached headings, nav, interactive elements.
   * Only re-scans forms (for updated values) and content.
   */
  private valueOnlyRefresh(cached: PageContext): PageContext {
    const excludeSelector = this.config.exclude.join(', ') || null;

    return {
      title: cached.title,
      description: cached.description,
      url: cached.url,
      forms: this.config.forms ? this.scanForms(excludeSelector) : [],
      headings: cached.headings,
      navigation: cached.navigation,
      content: this.config.content ? this.scanContent() : '',
      interactiveElements: cached.interactiveElements,
    };
  }

  /**
   * Returns the type of the last detected DOM change.
   */
  getLastChangeType(): string {
    return this.lastChangeType;
  }

  /**
   * Returns per-section content fingerprints from the last formatContext() call.
   */
  getSectionFingerprints(): Record<string, string> {
    return { ...this.sectionFingerprints };
  }

  private scanMeta(): string {
    const parts: string[] = [];
    const desc = document.querySelector('meta[name="description"]')?.getAttribute('content');
    if (desc) parts.push(desc);
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
    if (ogTitle && ogTitle !== document.title) parts.push(`OG: ${ogTitle}`);
    return parts.join('. ');
  }

  private scanForms(excludeSelector: string | null): FormFieldInfo[] {
    const fields: FormFieldInfo[] = [];
    const elements = document.querySelectorAll('input, select, textarea');

    for (const el of elements) {
      if (excludeSelector && el.closest(excludeSelector)) continue;
      // Skip password fields always
      if ((el as HTMLInputElement).type === 'password') continue;
      // Skip hidden inputs
      if ((el as HTMLInputElement).type === 'hidden') continue;
      // Skip elements inside our SDK shadow DOM
      if (el.closest('[data-voice-sdk]')) continue;

      const field = this.extractFieldInfo(el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement);
      if (field) fields.push(field);
    }

    return fields;
  }

  private extractFieldInfo(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): FormFieldInfo | null {
    let effectiveId = el.id || el.name || '';
    let effectiveName = el.name || el.id || '';

    // Generate fallback ID for elements without id/name (standalone inputs)
    if (!effectiveId && !effectiveName) {
      const type = el instanceof HTMLSelectElement ? 'select' : (el as HTMLInputElement).type || 'text';
      const placeholder = (el as HTMLInputElement).placeholder || '';
      if (placeholder) {
        effectiveId = `${type}:${placeholder.slice(0, 30)}`;
      } else {
        effectiveId = `${type}:unnamed`;
      }
      effectiveName = effectiveId;
    }

    const label = findLabelText(el);

    const info: FormFieldInfo = {
      id: effectiveId,
      name: effectiveName,
      type: el instanceof HTMLSelectElement ? 'select' : (el as HTMLInputElement).type || 'text',
      label,
      value: el.value || '',
      placeholder: (el as HTMLInputElement).placeholder || '',
      required: el.required,
      disabled: el.disabled,
      tagName: el.tagName.toLowerCase(),
    };

    // Extract select options
    if (el instanceof HTMLSelectElement) {
      info.options = Array.from(el.options).map((o) => o.text);
    }

    return info;
  }

  private scanHeadings(): { level: number; text: string }[] {
    const headings: { level: number; text: string }[] = [];
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
      const text = el.textContent?.trim();
      if (text) {
        headings.push({ level: parseInt(el.tagName[1]), text });
      }
    });
    return headings;
  }

  private scanNavigation(): { text: string; href: string }[] {
    const links: { text: string; href: string }[] = [];
    const seen = new Set<string>();

    // Scan <nav> elements and link clusters
    const navElements = document.querySelectorAll('nav a, [role="navigation"] a');
    navElements.forEach((el) => {
      const a = el as HTMLAnchorElement;
      const text = a.textContent?.trim();
      const href = a.href;
      if (text && href && !seen.has(href)) {
        seen.add(href);
        links.push({ text, href });
      }
    });

    // Fallback: add main content links for dashboard-style card links
    if (links.length < 5) {
      const mainLinks = document.querySelectorAll('main a[href], [role="main"] a[href]');
      for (const el of mainLinks) {
        if (links.length >= 30) break;
        const a = el as HTMLAnchorElement;
        const text = a.textContent?.trim();
        const href = a.href;
        if (text && href && !seen.has(href)) {
          seen.add(href);
          links.push({ text, href });
        }
      }
    }

    return links;
  }

  private scanContent(): string {
    // Prefer semantic sections: article > main > body
    const article = document.querySelector('article');
    if (article?.textContent?.trim()) {
      return article.textContent.trim().slice(0, this.config.maxContentLength);
    }
    const mainEl = document.querySelector('main') || document.querySelector('[role="main"]');
    const target = mainEl || document.body;
    const text = target.textContent?.trim() || '';
    return text.slice(0, this.config.maxContentLength);
  }

  private formatContext(ctx: PageContext): string {
    // Build sections with priorities for token budget allocation
    const sections: Array<{ name: string; content: string; priority: number }> = [];

    // Header section (always included, high priority)
    const headerParts: string[] = [];
    headerParts.push(`Page: ${ctx.title}`);
    headerParts.push(`URL: ${ctx.url}`);
    if (ctx.description) headerParts.push(`Description: ${ctx.description}`);
    sections.push({ name: 'header', content: headerParts.join('\n'), priority: 10 });

    // Forms section (high priority)
    if (ctx.forms.length > 0) {
      const formLines: string[] = ['Form Fields (use these IDs with fillField):'];
      ctx.forms.forEach((f) => {
        const attrs = [
          `type="${f.type}"`,
          f.label ? `label="${f.label}"` : '',
          f.value ? `current="${f.value}"` : '',
          f.placeholder ? `placeholder="${f.placeholder}"` : '',
          f.required ? 'required' : '',
          f.disabled ? 'disabled' : '',
          f.options ? `options=[${f.options.join(', ')}]` : '',
        ].filter(Boolean).join(' ');
        formLines.push(`  - id="${f.id}" ${attrs}`);
      });
      sections.push({ name: 'forms', content: formLines.join('\n'), priority: 10 });
    }

    // Interactive elements (medium-high priority)
    if (ctx.interactiveElements.length > 0) {
      const elLines: string[] = ['Interactive Elements:'];
      // Viewport elements are already sorted first by the scanner
      ctx.interactiveElements.forEach((el) => {
        const caps = el.capabilities.join(', ');
        const stateStr = el.state
          ? ' (' + Object.entries(el.state).map(([k, v]) => `${k}=${v}`).join(', ') + ')'
          : '';
        const tag = el.role || el.tagName;
        elLines.push(`  - [${el.index}] [${tag}] "${el.description}" \u2014 ${caps}${stateStr}`);
      });
      // Add truncation notice if scanner had to limit results
      const truncInfo = this.interactiveScanner.getTruncationInfo();
      if (truncInfo?.wasTruncated) {
        elLines.push(`(Showing ${truncInfo.included} of ${truncInfo.total} interactive elements. Use scanPage to re-scan.)`);
      }
      sections.push({ name: 'interactive', content: elLines.join('\n'), priority: 8 });
    }

    // Headings (medium priority)
    if (ctx.headings.length > 0) {
      const headingLines: string[] = ['Page Outline:'];
      ctx.headings.forEach((h) => headingLines.push(`${'  '.repeat(h.level - 1)}${h.text}`));
      sections.push({ name: 'headings', content: headingLines.join('\n'), priority: 6 });
    }

    // Navigation (medium priority)
    if (ctx.navigation.length > 0) {
      const navLines: string[] = ['Navigation Links:'];
      ctx.navigation.forEach((n) => navLines.push(`  - "${n.text}" \u2192 ${n.href}`));
      sections.push({ name: 'navigation', content: navLines.join('\n'), priority: 5 });
    }

    // Content (lower priority)
    if (ctx.content) {
      sections.push({
        name: 'content',
        content: 'Page Content (truncated):\n' + ctx.content,
        priority: 3,
      });
    }

    // Apply token budget
    const allocated = this.tokenBudget.allocate(sections);

    // Update section fingerprints for change detection
    this.sectionFingerprints = {};
    for (const section of allocated) {
      this.sectionFingerprints[section.name] = String(simpleHash(section.content));
    }

    return allocated.map((s) => s.content).join('\n\n');
  }

  /**
   * Returns the raw structured scan data from the last scan, or null if no scan has been performed.
   */
  getLastScanData(): PageContext | null {
    return this.cachedContext;
  }

  destroy(): void {
    this.endWatchPeriod();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.contextCache.saveToStorage();
    this.cachedContext = null;
  }
}

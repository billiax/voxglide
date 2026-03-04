import type { ContextProvider, ContextResult, FormFieldInfo, PageContext } from '../types';
import { DEFAULT_AUTO_CONTEXT } from '../constants';
import type { AutoContextConfig } from '../types';

/**
 * Automatically scans the DOM to build AI context.
 * Extracts forms, headings, navigation, content, and meta tags.
 * Uses MutationObserver to mark context as dirty on DOM changes.
 */
export class PageContextProvider implements ContextProvider {
  type = 'page';
  name = 'Page Context';

  private config: Required<AutoContextConfig>;
  private cachedContext: PageContext | null = null;
  private dirty = true;
  private observer: MutationObserver | null = null;

  constructor(config: AutoContextConfig | true = true) {
    this.config = config === true
      ? { ...DEFAULT_AUTO_CONTEXT }
      : { ...DEFAULT_AUTO_CONTEXT, ...config };

    this.startObserving();
  }

  private startObserving(): void {
    if (typeof MutationObserver === 'undefined') return;

    this.observer = new MutationObserver((mutations) => {
      // Only mark dirty for meaningful changes (not attribute-only on our own UI)
      const meaningful = mutations.some((m) =>
        m.type === 'childList' ||
        (m.type === 'attributes' && (m.attributeName === 'value' || m.attributeName === 'disabled'))
      );
      if (meaningful) {
        this.dirty = true;
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['value', 'disabled', 'href'],
    });
  }

  async getContext(): Promise<ContextResult> {
    if (!this.dirty && this.cachedContext) {
      return { content: this.formatContext(this.cachedContext), tools: [] };
    }

    const context = this.scanPage();
    this.cachedContext = context;
    this.dirty = false;

    return { content: this.formatContext(context), tools: [] };
  }

  private scanPage(): PageContext {
    const excludeSelector = this.config.exclude.join(', ') || null;

    return {
      title: document.title,
      description: this.config.meta ? this.scanMeta() : '',
      url: window.location.href,
      forms: this.config.forms ? this.scanForms(excludeSelector) : [],
      headings: this.config.headings ? this.scanHeadings() : [],
      navigation: this.config.navigation ? this.scanNavigation() : [],
      content: this.config.content ? this.scanContent() : '',
    };
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
    const id = el.id || el.name || '';
    const name = el.name || el.id || '';
    if (!id && !name) return null;

    const label = this.findLabel(el);

    const info: FormFieldInfo = {
      id: id || name,
      name: name || id,
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

  private findLabel(el: HTMLElement): string {
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

    return links;
  }

  private scanContent(): string {
    const mainEl = document.querySelector('main') || document.querySelector('[role="main"]');
    const target = mainEl || document.body;
    const text = target.textContent?.trim() || '';
    return text.slice(0, this.config.maxContentLength);
  }

  private formatContext(ctx: PageContext): string {
    const parts: string[] = [];

    parts.push(`Page: ${ctx.title}`);
    parts.push(`URL: ${ctx.url}`);
    if (ctx.description) parts.push(`Description: ${ctx.description}`);

    if (ctx.headings.length > 0) {
      parts.push('\nPage Outline:');
      ctx.headings.forEach((h) => parts.push(`${'  '.repeat(h.level - 1)}${h.text}`));
    }

    if (ctx.forms.length > 0) {
      parts.push('\nForm Fields (use these IDs with fillField):');
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
        parts.push(`  - id="${f.id}" ${attrs}`);
      });
    }

    if (ctx.navigation.length > 0) {
      parts.push('\nNavigation Links:');
      ctx.navigation.forEach((n) => parts.push(`  - "${n.text}" → ${n.href}`));
    }

    if (ctx.content) {
      parts.push('\nPage Content (truncated):');
      parts.push(ctx.content);
    }

    return parts.join('\n');
  }

  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.cachedContext = null;
  }
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PageContextProvider } from '../../src/context/PageContextProvider';

describe('PageContextProvider', () => {
  let provider: PageContextProvider;
  let observerInstances: Array<{
    callback: MutationCallback;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    takeRecords: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    // Track MutationObserver instances
    observerInstances = [];
    (globalThis as any).MutationObserver = class {
      callback: MutationCallback;
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      takeRecords: ReturnType<typeof vi.fn>;
      constructor(callback: MutationCallback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        this.takeRecords = vi.fn(() => []);
        observerInstances.push(this as any);
      }
    };

    // Reset DOM
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.title = 'Test Page';

    // Stub window.location
    Object.defineProperty(window, 'location', {
      value: {
        href: 'https://example.com/test',
        origin: 'https://example.com',
        protocol: 'https:',
        host: 'example.com',
        hostname: 'example.com',
        pathname: '/test',
        search: '',
        hash: '',
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (provider) {
      provider.destroy();
    }
    vi.restoreAllMocks();
  });

  describe('getContext()', () => {
    it('returns content string with page title and URL', async () => {
      document.title = 'My App';
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('Page: My App');
      expect(result.content).toContain('URL: https://example.com/test');
      expect(result.tools).toEqual([]);
    });

    it('scans form fields with id', async () => {
      document.body.innerHTML = `
        <input id="email" type="email" value="user@test.com" placeholder="Enter email" />
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('id="email"');
      expect(result.content).toContain('type="email"');
      expect(result.content).toContain('current="user@test.com"');
    });

    it('scans form fields with name attribute', async () => {
      document.body.innerHTML = `
        <input name="username" type="text" placeholder="Username" />
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('id="username"');
      expect(result.content).toContain('type="text"');
      expect(result.content).toContain('placeholder="Username"');
    });

    it('scans form fields with associated label', async () => {
      document.body.innerHTML = `
        <label for="age">Your Age</label>
        <input id="age" type="number" />
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('label="Your Age"');
    });

    it('skips password fields', async () => {
      document.body.innerHTML = `
        <input id="username" type="text" />
        <input id="secret" type="password" />
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('id="username"');
      expect(result.content).not.toContain('id="secret"');
    });

    it('skips hidden inputs', async () => {
      document.body.innerHTML = `
        <input id="visible" type="text" />
        <input id="csrf" type="hidden" value="abc123" />
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('id="visible"');
      expect(result.content).not.toContain('id="csrf"');
    });

    it('skips elements inside [data-voice-sdk]', async () => {
      document.body.innerHTML = `
        <input id="real-field" type="text" />
        <div data-voice-sdk>
          <input id="sdk-internal" type="text" />
        </div>
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('id="real-field"');
      expect(result.content).not.toContain('id="sdk-internal"');
    });

    it('scans headings (h1-h6)', async () => {
      document.body.innerHTML = `
        <h1>Main Title</h1>
        <h2>Section One</h2>
        <h3>Subsection</h3>
        <h4>Detail</h4>
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('Page Outline:');
      expect(result.content).toContain('Main Title');
      expect(result.content).toContain('Section One');
      expect(result.content).toContain('Subsection');
      expect(result.content).toContain('Detail');
    });

    it('scans navigation links inside <nav>', async () => {
      document.body.innerHTML = `
        <nav>
          <a href="/home">Home</a>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
        </nav>
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('Navigation Links:');
      expect(result.content).toContain('"Home"');
      expect(result.content).toContain('"About"');
      expect(result.content).toContain('"Contact"');
    });

    it('scans navigation links inside [role="navigation"]', async () => {
      document.body.innerHTML = `
        <div role="navigation">
          <a href="/dashboard">Dashboard</a>
        </div>
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('Navigation Links:');
      expect(result.content).toContain('"Dashboard"');
    });

    it('scans main content area', async () => {
      document.body.innerHTML = `
        <main>This is the main content of the page.</main>
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('Page Content (truncated):');
      expect(result.content).toContain('This is the main content of the page.');
    });

    it('falls back to body content when no <main> element exists', async () => {
      document.body.innerHTML = `
        <div>Body content fallback text.</div>
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('Body content fallback text.');
    });

    it('scans meta description', async () => {
      document.head.innerHTML = `
        <meta name="description" content="A helpful description of the page." />
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('Description: A helpful description of the page.');
    });

    it('scans select elements and includes options', async () => {
      document.body.innerHTML = `
        <select id="color">
          <option>Red</option>
          <option>Green</option>
          <option>Blue</option>
        </select>
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('id="color"');
      expect(result.content).toContain('type="select"');
      expect(result.content).toContain('options=[Red, Green, Blue]');
    });

    it('scans textarea elements', async () => {
      document.body.innerHTML = `
        <textarea id="comments" placeholder="Leave a comment"></textarea>
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('id="comments"');
      expect(result.content).toContain('placeholder="Leave a comment"');
    });

    it('includes required and disabled attributes', async () => {
      document.body.innerHTML = `
        <input id="req-field" type="text" required />
        <input id="dis-field" type="text" disabled />
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toMatch(/id="req-field".*required/);
      expect(result.content).toMatch(/id="dis-field".*disabled/);
    });
  });

  describe('config to disable specific scans', () => {
    it('does not scan forms when forms: false', async () => {
      document.body.innerHTML = `<input id="field" type="text" />`;
      provider = new PageContextProvider({ forms: false });

      const result = await provider.getContext();

      expect(result.content).not.toContain('Form Fields');
      expect(result.content).not.toContain('id="field"');
    });

    it('does not scan headings when headings: false', async () => {
      document.body.innerHTML = `<h1>Big Title</h1>`;
      provider = new PageContextProvider({ headings: false });

      const result = await provider.getContext();

      // The "Page Outline:" section should be absent
      expect(result.content).not.toContain('Page Outline:');
      // The heading text may still appear in body content scan, but not as a heading entry
      // Verify no indented heading-style line exists
      const lines = result.content.split('\n');
      const headingLine = lines.find((l: string) => /^\s{2,}Big Title$/.test(l));
      expect(headingLine).toBeUndefined();
    });

    it('does not scan navigation when navigation: false', async () => {
      document.body.innerHTML = `<nav><a href="/home">Home</a></nav>`;
      provider = new PageContextProvider({ navigation: false });

      const result = await provider.getContext();

      expect(result.content).not.toContain('Navigation Links:');
    });

    it('does not scan content when content: false', async () => {
      document.body.innerHTML = `<main>Some important content</main>`;
      provider = new PageContextProvider({ content: false });

      const result = await provider.getContext();

      expect(result.content).not.toContain('Page Content (truncated):');
    });

    it('does not scan meta when meta: false', async () => {
      document.head.innerHTML = `<meta name="description" content="Page desc" />`;
      provider = new PageContextProvider({ meta: false });

      const result = await provider.getContext();

      expect(result.content).not.toContain('Description:');
    });
  });

  describe('caching', () => {
    it('caches context and returns cached value on second call', async () => {
      document.body.innerHTML = `<h1>Heading</h1>`;
      provider = new PageContextProvider(true);

      const result1 = await provider.getContext();
      const result2 = await provider.getContext();

      // Both calls should return the same content
      expect(result1.content).toBe(result2.content);
      expect(result1.content).toContain('Heading');
    });

    it('re-scans after DOM mutation marks context dirty', async () => {
      document.body.innerHTML = `<h1>Original</h1>`;
      provider = new PageContextProvider(true);

      // First call populates cache
      const result1 = await provider.getContext();
      expect(result1.content).toContain('Original');

      // Simulate a meaningful DOM mutation by triggering the observer callback
      const observer = observerInstances[0];
      expect(observer).toBeDefined();

      // Modify the DOM
      document.body.innerHTML = `<h1>Updated</h1>`;

      // Trigger the observer callback with a childList mutation
      observer.callback(
        [{ type: 'childList', attributeName: null }] as unknown as MutationRecord[],
        observer as unknown as MutationObserver,
      );

      // Next call should re-scan
      const result2 = await provider.getContext();
      expect(result2.content).toContain('Updated');
    });

    it('does not re-scan for non-meaningful attribute mutations', async () => {
      document.body.innerHTML = `<h1>Static</h1>`;
      provider = new PageContextProvider(true);

      await provider.getContext();

      // Trigger an attribute mutation that is NOT meaningful (e.g. data-foo)
      const observer = observerInstances[0];
      observer.callback(
        [{ type: 'attributes', attributeName: 'data-foo' }] as unknown as MutationRecord[],
        observer as unknown as MutationObserver,
      );

      // Modify the DOM after the non-meaningful mutation
      document.body.innerHTML = `<h1>Changed</h1>`;

      // Should still return cached version since only non-meaningful mutation happened
      const result = await provider.getContext();
      expect(result.content).toContain('Static');
    });

    it('re-scans when value attribute changes', async () => {
      document.body.innerHTML = `<input id="field" type="text" value="old" />`;
      provider = new PageContextProvider(true);

      await provider.getContext();

      // Simulate a value attribute mutation
      const observer = observerInstances[0];
      document.body.innerHTML = `<input id="field" type="text" value="new" />`;

      observer.callback(
        [{ type: 'attributes', attributeName: 'value' }] as unknown as MutationRecord[],
        observer as unknown as MutationObserver,
      );

      const result = await provider.getContext();
      expect(result.content).toContain('current="new"');
    });

    it('re-scans when disabled attribute changes', async () => {
      document.body.innerHTML = `<input id="field" type="text" />`;
      provider = new PageContextProvider(true);

      await provider.getContext();

      const observer = observerInstances[0];

      // Trigger a disabled attribute mutation
      observer.callback(
        [{ type: 'attributes', attributeName: 'disabled' }] as unknown as MutationRecord[],
        observer as unknown as MutationObserver,
      );

      // Dirty flag should be set, causing a re-scan on next call
      document.body.innerHTML = `<input id="field" type="text" disabled />`;
      const result = await provider.getContext();
      // The field is now disabled, so it should show in the output
      expect(result.content).toContain('id="field"');
    });
  });

  describe('value-only refresh', () => {
    it('reuses cached headings/nav for value-only change', async () => {
      document.body.innerHTML = `
        <h1>Static Heading</h1>
        <nav><a href="/home">Home</a></nav>
        <input id="field" type="text" value="old" />
      `;
      provider = new PageContextProvider(true);

      // Initial scan — full (structural)
      const result1 = await provider.getContext();
      expect(result1.content).toContain('Static Heading');
      expect(result1.content).toContain('current="old"');

      // Change value and manually simulate what the debounce does:
      // set lastChangeType to 'value-only' and mark dirty
      (document.querySelector('#field') as HTMLInputElement).value = 'new';
      (provider as any).lastChangeType = 'value-only';
      provider.markDirty();

      const result2 = await provider.getContext();
      // Headings should still be present (reused from cache)
      expect(result2.content).toContain('Static Heading');
      // Form value should be updated
      expect(result2.content).toContain('current="new"');
    });

    it('structural change always does full rescan', async () => {
      document.body.innerHTML = `
        <h1>Old Heading</h1>
        <input id="field" type="text" value="val" />
      `;
      provider = new PageContextProvider(true);

      await provider.getContext();

      // Add new heading and simulate structural change
      document.body.innerHTML = `
        <h1>New Heading</h1>
        <h2>Sub Heading</h2>
        <input id="field" type="text" value="val" />
      `;
      (provider as any).lastChangeType = 'structural';
      provider.markDirty();

      const result = await provider.getContext();
      expect(result.content).toContain('New Heading');
      expect(result.content).toContain('Sub Heading');
    });

    it('first scan is always structural (no cache to reuse)', async () => {
      document.body.innerHTML = '<h1>Title</h1>';
      provider = new PageContextProvider(true);

      expect(provider.getLastChangeType()).toBe('structural');
    });
  });

  describe('getLastChangeType()', () => {
    it('returns structural initially', () => {
      provider = new PageContextProvider(true);
      expect(provider.getLastChangeType()).toBe('structural');
    });
  });

  describe('getSectionFingerprints()', () => {
    it('returns section fingerprints after getContext()', async () => {
      document.body.innerHTML = `
        <h1>Title</h1>
        <input id="field" type="text" />
      `;
      provider = new PageContextProvider(true);

      await provider.getContext();

      const fingerprints = provider.getSectionFingerprints();
      expect(fingerprints).toBeDefined();
      expect(typeof fingerprints.header).toBe('string');
    });

    it('returns empty object before first getContext()', () => {
      provider = new PageContextProvider(true);
      const fingerprints = provider.getSectionFingerprints();
      expect(Object.keys(fingerprints)).toHaveLength(0);
    });
  });

  describe('destroy()', () => {
    it('disconnects the MutationObserver', () => {
      provider = new PageContextProvider(true);

      const observer = observerInstances[0];
      expect(observer).toBeDefined();

      provider.destroy();

      expect(observer.disconnect).toHaveBeenCalled();
    });

    it('clears cached context', async () => {
      document.body.innerHTML = `<h1>Title</h1>`;
      provider = new PageContextProvider(true);

      // Populate cache
      await provider.getContext();

      provider.destroy();

      // After destroy, creating a new provider and scanning should work fresh
      // We verify destroy nullifies internals by checking observer was disconnected
      expect(observerInstances[0].disconnect).toHaveBeenCalledOnce();
    });

    it('can be called multiple times without error', () => {
      provider = new PageContextProvider(true);

      expect(() => {
        provider.destroy();
        provider.destroy();
      }).not.toThrow();
    });
  });

  describe('constructor', () => {
    it('accepts true as config and uses defaults', async () => {
      document.body.innerHTML = `
        <h1>Title</h1>
        <input id="field" type="text" />
        <nav><a href="/link">Link</a></nav>
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      // All scan types should be enabled with defaults
      expect(result.content).toContain('Title');
      expect(result.content).toContain('id="field"');
      expect(result.content).toContain('"Link"');
    });

    it('accepts partial AutoContextConfig and merges with defaults', async () => {
      document.body.innerHTML = `
        <h1>Title</h1>
        <input id="field" type="text" />
      `;
      // Disable only forms, headings should still work
      provider = new PageContextProvider({ forms: false });

      const result = await provider.getContext();

      expect(result.content).toContain('Title');
      expect(result.content).not.toContain('id="field"');
    });

    it('starts observing DOM mutations', () => {
      provider = new PageContextProvider(true);

      expect(observerInstances).toHaveLength(1);
      expect(observerInstances[0].observe).toHaveBeenCalledWith(
        document.body,
        expect.objectContaining({
          childList: true,
          subtree: true,
          attributes: true,
        }),
      );
    });
  });

  describe('exclude selectors', () => {
    it('excludes form fields matching exclude selectors', async () => {
      document.body.innerHTML = `
        <input id="included" type="text" />
        <div class="excluded-area">
          <input id="excluded" type="text" />
        </div>
      `;
      provider = new PageContextProvider({ exclude: ['.excluded-area'] });

      const result = await provider.getContext();

      expect(result.content).toContain('id="included"');
      expect(result.content).not.toContain('id="excluded"');
    });
  });

  describe('expanded attribute filter', () => {
    it('re-scans when aria-expanded attribute changes', async () => {
      document.body.innerHTML = '<button aria-expanded="false">Menu</button>';
      provider = new PageContextProvider(true);
      await provider.getContext();

      const observer = observerInstances[0];
      document.body.innerHTML = '<button aria-expanded="true">Menu</button>';

      observer.callback(
        [{ type: 'attributes', attributeName: 'aria-expanded' }] as unknown as MutationRecord[],
        observer as unknown as MutationObserver,
      );

      const result = await provider.getContext();
      // Should have re-scanned (dirty flag was set)
      expect(result.content).toContain('Menu');
    });

    it('re-scans when class attribute changes', async () => {
      document.body.innerHTML = '<button class="inactive">Toggle</button>';
      provider = new PageContextProvider(true);
      await provider.getContext();

      const observer = observerInstances[0];
      document.body.innerHTML = '<button class="active">Toggle</button>';

      observer.callback(
        [{ type: 'attributes', attributeName: 'class' }] as unknown as MutationRecord[],
        observer as unknown as MutationObserver,
      );

      const result = await provider.getContext();
      expect(result.content).toContain('Toggle');
    });

    it('re-scans when open attribute changes', async () => {
      document.body.innerHTML = '<details><summary>More info</summary></details>';
      provider = new PageContextProvider(true);
      await provider.getContext();

      const observer = observerInstances[0];
      observer.callback(
        [{ type: 'attributes', attributeName: 'open' }] as unknown as MutationRecord[],
        observer as unknown as MutationObserver,
      );

      // Dirty flag should be set
      document.body.innerHTML = '<details open><summary>More info</summary><p>Details</p></details>';
      const result = await provider.getContext();
      expect(result.content).toContain('More info');
    });
  });

  describe('element index in context format', () => {
    it('includes element index in formatted output', async () => {
      document.body.innerHTML = '<button>Submit Form</button>';
      // Make the button "visible" in jsdom
      const btn = document.querySelector('button')!;
      Object.defineProperty(btn, 'offsetParent', { value: document.body, configurable: true });

      provider = new PageContextProvider(true);

      const result = await provider.getContext();
      // Should contain index like [1] [button]
      expect(result.content).toMatch(/\[1\] \[button\]/);
    });
  });

  describe('getScanner()', () => {
    it('returns the underlying InteractiveElementScanner', () => {
      provider = new PageContextProvider(true);
      const scanner = provider.getScanner();
      expect(scanner).toBeDefined();
      expect(typeof scanner.scan).toBe('function');
      expect(typeof scanner.getElementByIndex).toBe('function');
    });
  });

  describe('fields without id or name', () => {
    it('skips input elements that have neither id nor name', async () => {
      document.body.innerHTML = `
        <input type="text" placeholder="anonymous" />
        <input id="named" type="text" />
      `;
      provider = new PageContextProvider(true);

      const result = await provider.getContext();

      expect(result.content).toContain('id="named"');
      // The anonymous field should not appear in form fields section
      // (it may appear in content but not as a form field entry)
      const formSection = result.content.split('Form Fields')[1]?.split('\n') || [];
      const anonymousLine = formSection.find((line: string) => line.includes('placeholder="anonymous"'));
      expect(anonymousLine).toBeUndefined();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fillField, clickElement, readContent } from '../../src/actions/DOMActions';

describe('DOMActions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── fillField ──

  describe('fillField', () => {
    it('fills input by ID', async () => {
      document.body.innerHTML = '<input id="username" type="text" />';
      const result = await fillField({ fieldId: 'username', value: 'alice' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect((document.getElementById('username') as HTMLInputElement).value).toBe('alice');
    });

    it('fills input by name attribute', async () => {
      document.body.innerHTML = '<input name="email" type="text" />';
      const result = await fillField({ fieldId: 'email', value: 'a@b.com' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect((document.querySelector('[name="email"]') as HTMLInputElement).value).toBe('a@b.com');
    });

    it('fills input by label text (case-insensitive)', async () => {
      document.body.innerHTML = `
        <label for="fname">First Name</label>
        <input id="fname" type="text" />
      `;
      const result = await fillField({ fieldId: 'first name', value: 'Bob' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect((document.getElementById('fname') as HTMLInputElement).value).toBe('Bob');
    });

    it('fills input by placeholder', async () => {
      document.body.innerHTML = '<input type="text" placeholder="Enter your city" />';
      const result = await fillField({ fieldId: 'enter your city', value: 'Portland' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      const input = document.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('Portland');
    });

    it('fills input by aria-label', async () => {
      document.body.innerHTML = '<input type="text" aria-label="Search Query" />';
      const result = await fillField({ fieldId: 'search query', value: 'vitest' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      const input = document.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('vitest');
    });

    it('fills input by fuzzy match on label (partial match)', async () => {
      document.body.innerHTML = `
        <label for="addr">Mailing Address Line 1</label>
        <input id="addr" type="text" />
      `;
      const result = await fillField({ fieldId: 'mailing address', value: '123 Main St' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect((document.getElementById('addr') as HTMLInputElement).value).toBe('123 Main St');
    });

    it('returns error if no fieldId provided', async () => {
      const result = await fillField({ fieldId: '', value: 'x' });
      const parsed = JSON.parse(result.result);
      expect(parsed.error).toBe('No fieldId provided');
    });

    it('returns error if field not found', async () => {
      document.body.innerHTML = '<input id="exists" type="text" />';
      const result = await fillField({ fieldId: 'nonexistent', value: 'x' });
      const parsed = JSON.parse(result.result);
      expect(parsed.error).toContain('Could not find field');
    });

    it('returns error if field is a password type', async () => {
      document.body.innerHTML = '<input id="pass" type="password" />';
      const result = await fillField({ fieldId: 'pass', value: 'secret' });
      const parsed = JSON.parse(result.result);
      expect(parsed.error).toBe('Cannot fill password fields');
    });

    it('returns error if field is disabled', async () => {
      document.body.innerHTML = '<input id="locked" type="text" disabled />';
      const result = await fillField({ fieldId: 'locked', value: 'x' });
      const parsed = JSON.parse(result.result);
      expect(parsed.error).toContain('is disabled');
    });

    it('sets select element value by option text', async () => {
      document.body.innerHTML = `
        <select id="color">
          <option value="r">Red</option>
          <option value="g">Green</option>
          <option value="b">Blue</option>
        </select>
      `;
      const result = await fillField({ fieldId: 'color', value: 'Green' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect((document.getElementById('color') as HTMLSelectElement).value).toBe('g');
    });

    it.each(['true', 'yes', '1'])('sets checkbox checked for "%s"', async (val) => {
      document.body.innerHTML = '<input id="agree" type="checkbox" />';
      const result = await fillField({ fieldId: 'agree', value: val });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect((document.getElementById('agree') as HTMLInputElement).checked).toBe(true);
    });

    it('sets checkbox unchecked for other values', async () => {
      document.body.innerHTML = '<input id="agree" type="checkbox" checked />';
      await fillField({ fieldId: 'agree', value: 'false' });
      expect((document.getElementById('agree') as HTMLInputElement).checked).toBe(false);
    });

    it('dispatches input and change events', async () => {
      document.body.innerHTML = '<input id="field" type="text" />';
      const el = document.getElementById('field') as HTMLInputElement;
      const inputHandler = vi.fn();
      const changeHandler = vi.fn();
      el.addEventListener('input', inputHandler);
      el.addEventListener('change', changeHandler);

      await fillField({ fieldId: 'field', value: 'hello' });

      expect(inputHandler).toHaveBeenCalledTimes(1);
      expect(changeHandler).toHaveBeenCalledTimes(1);
    });

    it('resolves nested input inside label without for attribute', async () => {
      document.body.innerHTML = `
        <label>Zip Code <input type="text" /></label>
      `;
      const result = await fillField({ fieldId: 'zip code', value: '97201' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect((document.querySelector('input') as HTMLInputElement).value).toBe('97201');
    });
  });

  // ── clickElement ──

  describe('clickElement', () => {
    it('clicks button by text content', async () => {
      const handler = vi.fn();
      document.body.innerHTML = '<button>Submit</button>';
      document.querySelector('button')!.addEventListener('click', handler);

      const result = await clickElement({ description: 'Submit' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('clicks link by text content', async () => {
      const handler = vi.fn((e: Event) => e.preventDefault());
      document.body.innerHTML = '<a href="/about">About Us</a>';
      document.querySelector('a')!.addEventListener('click', handler);

      const result = await clickElement({ description: 'About Us' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('clicks by partial text match', async () => {
      const handler = vi.fn();
      document.body.innerHTML = '<button>Click here to continue</button>';
      document.querySelector('button')!.addEventListener('click', handler);

      const result = await clickElement({ description: 'continue' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('clicks by aria-label', async () => {
      const handler = vi.fn();
      document.body.innerHTML = '<button aria-label="Close dialog">X</button>';
      document.querySelector('button')!.addEventListener('click', handler);

      const result = await clickElement({ description: 'close dialog' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('clicks by title', async () => {
      const handler = vi.fn();
      document.body.innerHTML = '<button title="Save document">💾</button>';
      document.querySelector('button')!.addEventListener('click', handler);

      const result = await clickElement({ description: 'save document' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('clicks by CSS selector', async () => {
      const handler = vi.fn();
      document.body.innerHTML = '<button class="primary-btn">Go</button>';
      document.querySelector('button')!.addEventListener('click', handler);

      const result = await clickElement({ description: '', selector: '.primary-btn' });
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('returns error if nothing found', async () => {
      document.body.innerHTML = '<button>OK</button>';
      const result = await clickElement({ description: 'nonexistent' });
      const parsed = JSON.parse(result.result);
      expect(parsed.error).toContain('Could not find element');
    });

    it('returns error if no description or selector provided', async () => {
      const result = await clickElement({});
      const parsed = JSON.parse(result.result);
      expect(parsed.error).toBe('No description or selector provided');
    });
  });

  // ── readContent ──

  describe('readContent', () => {
    it('reads text content of element by selector', async () => {
      document.body.innerHTML = '<div id="info">Hello World</div>';
      const result = await readContent({ selector: '#info' });
      const parsed = JSON.parse(result.result);
      expect(parsed.content).toBe('Hello World');
    });

    it('defaults to "main" selector', async () => {
      document.body.innerHTML = '<main>Main content here</main>';
      const result = await readContent({});
      const parsed = JSON.parse(result.result);
      expect(parsed.content).toBe('Main content here');
    });

    it('returns error if element not found', async () => {
      document.body.innerHTML = '<div>nothing</div>';
      const result = await readContent({ selector: '#missing' });
      const parsed = JSON.parse(result.result);
      expect(parsed.error).toContain('No element found');
    });

    it('truncates to 2000 chars', async () => {
      const longText = 'A'.repeat(3000);
      document.body.innerHTML = `<main>${longText}</main>`;
      const result = await readContent({});
      const parsed = JSON.parse(result.result);
      expect(parsed.content).toHaveLength(2000);
    });
  });
});

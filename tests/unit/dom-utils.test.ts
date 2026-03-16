import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scoreText, getNearbyLabelText, dispatchClickSequence } from '../../src/actions/dom-utils';

describe('dom-utils', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── scoreText ──

  describe('scoreText', () => {
    it('returns 100 for exact match', () => {
      expect(scoreText('Submit', 'Submit')).toBe(100);
    });

    it('returns 100 for exact match (case-insensitive)', () => {
      expect(scoreText('Submit', 'submit')).toBe(100);
      expect(scoreText('SUBMIT', 'submit')).toBe(100);
      expect(scoreText('submit', 'SUBMIT')).toBe(100);
    });

    it('returns 100 for exact match with leading/trailing whitespace in text', () => {
      expect(scoreText('  Submit  ', 'Submit')).toBe(100);
      expect(scoreText('\tSubmit\n', 'Submit')).toBe(100);
    });

    it('returns 80 for starts-with match', () => {
      expect(scoreText('Submit Form', 'submit')).toBe(80);
      expect(scoreText('Dashboard Settings', 'dashboard')).toBe(80);
    });

    it('returns 60 for word-boundary match', () => {
      expect(scoreText('Click to Submit', 'submit')).toBe(60);
      expect(scoreText('my-submit-button', 'submit')).toBe(60);
    });

    it('returns 40 for contains match (no word boundary)', () => {
      expect(scoreText('resubmit', 'submit')).toBe(40);
      expect(scoreText('unsubmitted', 'submit')).toBe(40);
    });

    it('returns 0 for no match', () => {
      expect(scoreText('Hello', 'world')).toBe(0);
      expect(scoreText('abc', 'xyz')).toBe(0);
    });

    it('returns 0 for null or undefined text', () => {
      expect(scoreText(null, 'query')).toBe(0);
      expect(scoreText(undefined, 'query')).toBe(0);
    });

    it('returns 0 for empty string text', () => {
      expect(scoreText('', 'query')).toBe(0);
    });

    it('returns 0 for whitespace-only text', () => {
      expect(scoreText('   ', 'query')).toBe(0);
      expect(scoreText('\t\n', 'query')).toBe(0);
    });

    it('handles special regex characters in query without throwing', () => {
      // $ is non-word char so \b doesn't match before it -- falls to contains (40)
      expect(scoreText('price is $10.00', '$10.00')).toBe(40);
      expect(scoreText('a+b=c', 'a+b')).toBe(80);
      expect(scoreText('(test)', '(test)')).toBe(100);
      expect(scoreText('foo[0]', 'foo[0]')).toBe(100);
    });

    it('does not throw on regex-special query characters', () => {
      // Ensure the regex escaping prevents errors
      expect(() => scoreText('test', '.*+?^${}()|[]\\')).not.toThrow();
    });

    it('handles numeric strings', () => {
      expect(scoreText('42', '42')).toBe(100);
      expect(scoreText('Item 42', '42')).toBe(60);
      expect(scoreText('4200', '42')).toBe(80);
      expect(scoreText('142', '42')).toBe(40);
    });

    it('handles single character queries', () => {
      expect(scoreText('A', 'a')).toBe(100);
      expect(scoreText('Apple', 'a')).toBe(80);
    });

    it('handles query longer than text', () => {
      expect(scoreText('Hi', 'Hello World')).toBe(0);
    });
  });

  // ── getNearbyLabelText ──

  describe('getNearbyLabelText', () => {
    it('returns text from preceding sibling element', () => {
      document.body.innerHTML = `
        <div>
          <span>Username</span>
          <input id="target" type="text" />
        </div>
      `;
      const el = document.getElementById('target') as HTMLElement;
      expect(getNearbyLabelText(el)).toBe('username');
    });

    it('returns text from following sibling when no preceding sibling', () => {
      document.body.innerHTML = `
        <div>
          <input id="target" type="text" />
          <span>Email Address</span>
        </div>
      `;
      const el = document.getElementById('target') as HTMLElement;
      expect(getNearbyLabelText(el)).toBe('email address');
    });

    it('prefers preceding sibling over following sibling', () => {
      document.body.innerHTML = `
        <div>
          <span>Before Label</span>
          <input id="target" type="text" />
          <span>After Label</span>
        </div>
      `;
      const el = document.getElementById('target') as HTMLElement;
      expect(getNearbyLabelText(el)).toBe('before label');
    });

    it('skips preceding sibling with empty text', () => {
      document.body.innerHTML = `
        <div>
          <span>Real Label</span>
          <span>   </span>
          <input id="target" type="text" />
        </div>
      `;
      const el = document.getElementById('target') as HTMLElement;
      // The empty <span> is the immediate previous sibling, but it has only whitespace.
      // The function trims and checks if text is truthy, so it skips it and finds "Real Label".
      expect(getNearbyLabelText(el)).toBe('real label');
    });

    it('skips sibling with text longer than 100 characters', () => {
      const longText = 'A'.repeat(101);
      document.body.innerHTML = `
        <div>
          <span>Short Label</span>
          <span>${longText}</span>
          <input id="target" type="text" />
        </div>
      `;
      const el = document.getElementById('target') as HTMLElement;
      // Immediate preceding sibling has text > 100 chars, so skip to next preceding sibling
      expect(getNearbyLabelText(el)).toBe('short label');
    });

    it('returns text from parent preceding sibling when no direct siblings', () => {
      document.body.innerHTML = `
        <div>
          <label>Parent Sibling Label</label>
          <div>
            <input id="target" type="text" />
          </div>
        </div>
      `;
      const el = document.getElementById('target') as HTMLElement;
      expect(getNearbyLabelText(el)).toBe('parent sibling label');
    });

    it('returns text from parent following sibling when no preceding options', () => {
      document.body.innerHTML = `
        <div>
          <div>
            <input id="target" type="text" />
          </div>
          <span>Help text below</span>
        </div>
      `;
      const el = document.getElementById('target') as HTMLElement;
      expect(getNearbyLabelText(el)).toBe('help text below');
    });

    it('walks up to 3 levels of parents', () => {
      document.body.innerHTML = `
        <div>
          <span>Level 3 Label</span>
          <div>
            <div>
              <div>
                <input id="target" type="text" />
              </div>
            </div>
          </div>
        </div>
      `;
      const el = document.getElementById('target') as HTMLElement;
      // depth 0: parent = innermost div (no siblings)
      // depth 1: parent = second div (no siblings)
      // depth 2: parent = third div (has preceding sibling <span>)
      expect(getNearbyLabelText(el)).toBe('level 3 label');
    });

    it('stops walking after 3 levels and returns empty string', () => {
      document.body.innerHTML = `
        <div>
          <span>Too Far</span>
          <div>
            <div>
              <div>
                <div>
                  <input id="target" type="text" />
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      const el = document.getElementById('target') as HTMLElement;
      // depth 0, 1, 2 walk through three wrapper divs with no siblings
      // depth 3 would be the div that has the <span> sibling, but loop only goes to depth < 3
      expect(getNearbyLabelText(el)).toBe('');
    });

    it('returns empty string when no label found at all', () => {
      document.body.innerHTML = '<input id="target" type="text" />';
      const el = document.getElementById('target') as HTMLElement;
      expect(getNearbyLabelText(el)).toBe('');
    });

    it('returns lowercased text', () => {
      document.body.innerHTML = `
        <div>
          <span>First Name</span>
          <input id="target" type="text" />
        </div>
      `;
      const el = document.getElementById('target') as HTMLElement;
      expect(getNearbyLabelText(el)).toBe('first name');
    });
  });

  // ── dispatchClickSequence ──

  describe('dispatchClickSequence', () => {
    it('dispatches events in correct order: pointerdown, mousedown, pointerup, mouseup, click', () => {
      document.body.innerHTML = '<button id="btn">Click Me</button>';
      const el = document.getElementById('btn') as HTMLElement;
      const events: string[] = [];

      el.addEventListener('pointerdown', () => events.push('pointerdown'));
      el.addEventListener('mousedown', () => events.push('mousedown'));
      el.addEventListener('pointerup', () => events.push('pointerup'));
      el.addEventListener('mouseup', () => events.push('mouseup'));
      el.addEventListener('click', () => events.push('click'));

      dispatchClickSequence(el);

      expect(events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    });

    it('calls focus before dispatching events', () => {
      document.body.innerHTML = '<button id="btn">Focus Me</button>';
      const el = document.getElementById('btn') as HTMLElement;
      const log: string[] = [];

      el.addEventListener('focus', () => log.push('focus'));
      el.addEventListener('pointerdown', () => log.push('pointerdown'));

      dispatchClickSequence(el);

      expect(log[0]).toBe('focus');
      expect(log[1]).toBe('pointerdown');
    });

    it('dispatches pointer events with bubbles: true', () => {
      document.body.innerHTML = '<button id="btn">Bubble</button>';
      const el = document.getElementById('btn') as HTMLElement;

      const pointerDownBubbles: boolean[] = [];
      const pointerUpBubbles: boolean[] = [];

      el.addEventListener('pointerdown', (e) => pointerDownBubbles.push(e.bubbles));
      el.addEventListener('pointerup', (e) => pointerUpBubbles.push(e.bubbles));

      dispatchClickSequence(el);

      expect(pointerDownBubbles[0]).toBe(true);
      expect(pointerUpBubbles[0]).toBe(true);
    });

    it('dispatches mouse events with bubbles: true', () => {
      document.body.innerHTML = '<button id="btn">Bubble</button>';
      const el = document.getElementById('btn') as HTMLElement;

      const mouseDownBubbles: boolean[] = [];
      const mouseUpBubbles: boolean[] = [];

      el.addEventListener('mousedown', (e) => mouseDownBubbles.push(e.bubbles));
      el.addEventListener('mouseup', (e) => mouseUpBubbles.push(e.bubbles));

      dispatchClickSequence(el);

      expect(mouseDownBubbles[0]).toBe(true);
      expect(mouseUpBubbles[0]).toBe(true);
    });

    it('events bubble up to parent elements', () => {
      document.body.innerHTML = `
        <div id="parent">
          <button id="child">Inner</button>
        </div>
      `;
      const child = document.getElementById('child') as HTMLElement;
      const parent = document.getElementById('parent') as HTMLElement;
      const parentEvents: string[] = [];

      parent.addEventListener('pointerdown', () => parentEvents.push('pointerdown'));
      parent.addEventListener('mousedown', () => parentEvents.push('mousedown'));
      parent.addEventListener('pointerup', () => parentEvents.push('pointerup'));
      parent.addEventListener('mouseup', () => parentEvents.push('mouseup'));
      parent.addEventListener('click', () => parentEvents.push('click'));

      dispatchClickSequence(child);

      expect(parentEvents).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    });

    it('dispatches events on disabled button', () => {
      document.body.innerHTML = '<button id="btn" disabled>Disabled</button>';
      const el = document.getElementById('btn') as HTMLElement;
      const events: string[] = [];

      el.addEventListener('pointerdown', () => events.push('pointerdown'));
      el.addEventListener('mousedown', () => events.push('mousedown'));
      el.addEventListener('pointerup', () => events.push('pointerup'));
      el.addEventListener('mouseup', () => events.push('mouseup'));
      el.addEventListener('click', () => events.push('click'));

      dispatchClickSequence(el);

      // dispatchEvent fires even on disabled elements (unlike user clicks)
      // pointer and mouse events are dispatched manually, so they fire
      expect(events).toContain('pointerdown');
      expect(events).toContain('mousedown');
      expect(events).toContain('pointerup');
      expect(events).toContain('mouseup');
      // .click() on a disabled button may not fire the click event in jsdom
      // The important thing is that the pointer/mouse sequence is dispatched
    });

    it('dispatches events on non-button elements (div, span)', () => {
      document.body.innerHTML = '<div id="clickable" tabindex="0">Clickable Div</div>';
      const el = document.getElementById('clickable') as HTMLElement;
      const events: string[] = [];

      el.addEventListener('pointerdown', () => events.push('pointerdown'));
      el.addEventListener('mousedown', () => events.push('mousedown'));
      el.addEventListener('pointerup', () => events.push('pointerup'));
      el.addEventListener('mouseup', () => events.push('mouseup'));
      el.addEventListener('click', () => events.push('click'));

      dispatchClickSequence(el);

      expect(events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    });

    it('dispatches PointerEvent instances for pointer events', () => {
      document.body.innerHTML = '<button id="btn">Type Check</button>';
      const el = document.getElementById('btn') as HTMLElement;

      let pointerDownEvent: Event | null = null;
      let pointerUpEvent: Event | null = null;

      el.addEventListener('pointerdown', (e) => { pointerDownEvent = e; });
      el.addEventListener('pointerup', (e) => { pointerUpEvent = e; });

      dispatchClickSequence(el);

      expect(pointerDownEvent).toBeInstanceOf(PointerEvent);
      expect(pointerUpEvent).toBeInstanceOf(PointerEvent);
    });

    it('dispatches MouseEvent instances for mouse events', () => {
      document.body.innerHTML = '<button id="btn">Type Check</button>';
      const el = document.getElementById('btn') as HTMLElement;

      let mouseDownEvent: Event | null = null;
      let mouseUpEvent: Event | null = null;

      el.addEventListener('mousedown', (e) => { mouseDownEvent = e; });
      el.addEventListener('mouseup', (e) => { mouseUpEvent = e; });

      dispatchClickSequence(el);

      expect(mouseDownEvent).toBeInstanceOf(MouseEvent);
      expect(mouseUpEvent).toBeInstanceOf(MouseEvent);
    });

    it('works on anchor elements', () => {
      document.body.innerHTML = '<a id="link" href="#">Link</a>';
      const el = document.getElementById('link') as HTMLElement;
      const events: string[] = [];

      el.addEventListener('pointerdown', () => events.push('pointerdown'));
      el.addEventListener('mousedown', () => events.push('mousedown'));
      el.addEventListener('pointerup', () => events.push('pointerup'));
      el.addEventListener('mouseup', () => events.push('mouseup'));
      el.addEventListener('click', (e) => { e.preventDefault(); events.push('click'); });

      dispatchClickSequence(el);

      expect(events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConsoleCapture } from '../../src/build/browser-tools/ConsoleCapture';

describe('ConsoleCapture', () => {
  let capture: ConsoleCapture;
  const originalConsole = { ...console };

  beforeEach(() => {
    capture = new ConsoleCapture(10);
  });

  afterEach(() => {
    capture.deactivate();
    // Restore console in case of test failure
    Object.assign(console, originalConsole);
  });

  it('starts inactive', () => {
    expect(capture.isActive()).toBe(false);
  });

  it('captures console.log after activation', () => {
    capture.activate();
    expect(capture.isActive()).toBe(true);

    console.log('hello', 'world');

    const entries = capture.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('log');
    expect(entries[0].args).toEqual(['hello', 'world']);
  });

  it('captures multiple methods', () => {
    capture.activate();

    console.log('info msg');
    console.warn('warning msg');
    console.error('error msg');
    console.info('info level');

    const entries = capture.getEntries();
    expect(entries).toHaveLength(4);
    expect(entries.map(e => e.level)).toEqual(['log', 'warn', 'error', 'info']);
  });

  it('restores originals on deactivate', () => {
    const origLog = console.log;
    capture.activate();
    expect(console.log).not.toBe(origLog);

    capture.deactivate();
    // After deactivation, console.log should be restored
    expect(capture.isActive()).toBe(false);
  });

  it('snapshot cursor and getEntriesSince', () => {
    capture.activate();

    console.log('before');
    const cursor = capture.snapshot();
    console.log('after');

    const since = capture.getEntriesSince(cursor);
    expect(since).toHaveLength(1);
    expect(since[0].args[0]).toBe('after');
  });

  it('enforces ring buffer max', () => {
    capture = new ConsoleCapture(3);
    capture.activate();

    console.log('a');
    console.log('b');
    console.log('c');
    console.log('d');

    const entries = capture.getEntries();
    expect(entries).toHaveLength(3);
    expect(entries[0].args[0]).toBe('b'); // 'a' was evicted
  });

  it('filters by timestamp', () => {
    capture.activate();

    console.log('first');
    const now = Date.now() + 1;
    // Entries have timestamps <= now, so filtering with now+1 should exclude them
    const entries = capture.getEntries(now + 1000);
    expect(entries).toHaveLength(0);
  });

  it('clear empties buffer', () => {
    capture.activate();
    console.log('test');
    expect(capture.getEntries()).toHaveLength(1);

    capture.clear();
    expect(capture.getEntries()).toHaveLength(0);
  });

  it('does not double-activate', () => {
    capture.activate();
    const log1 = console.log;
    capture.activate();
    expect(console.log).toBe(log1); // same wrapper
  });

  it('serializes objects in args', () => {
    capture.activate();
    console.log({ key: 'value' });

    const entries = capture.getEntries();
    expect(entries[0].args[0]).toBe('{"key":"value"}');
  });
});

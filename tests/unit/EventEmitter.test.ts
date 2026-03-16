import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../src/events';

interface TestEvents {
  message: { text: string };
  count: number;
  ping: void;
  pong: void;
}

describe('EventEmitter', () => {
  it('on() registers a handler that gets called on emit', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();

    emitter.on('message', handler);
    emitter.emit('message', { text: 'hello' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ text: 'hello' });
  });

  it('off() removes a handler so it is no longer called', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();

    emitter.on('message', handler);
    emitter.off('message', handler);
    emitter.emit('message', { text: 'hello' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('off() on a handler that was never registered does not throw', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();

    expect(() => emitter.off('message', handler)).not.toThrow();
  });

  it('emit() returns false when there are no listeners', () => {
    const emitter = new EventEmitter<TestEvents>();

    const result = emitter.emit('message', { text: 'nobody home' });

    expect(result).toBe(false);
  });

  it('emit() returns true when there are listeners', () => {
    const emitter = new EventEmitter<TestEvents>();
    emitter.on('message', vi.fn());

    const result = emitter.emit('message', { text: 'hello' });

    expect(result).toBe(true);
  });

  it('emit() passes data to the handler', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();

    emitter.on('count', handler);
    emitter.emit('count', 42);

    expect(handler).toHaveBeenCalledWith(42);
  });

  it('emit() works with void events (no data argument)', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();

    emitter.on('ping', handler);
    emitter.emit('ping');

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith();
  });

  it('supports multiple handlers for the same event', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    emitter.on('message', handler1);
    emitter.on('message', handler2);
    emitter.on('message', handler3);

    emitter.emit('message', { text: 'broadcast' });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
    expect(handler3).toHaveBeenCalledOnce();

    // All receive the same data
    const expectedData = { text: 'broadcast' };
    expect(handler1).toHaveBeenCalledWith(expectedData);
    expect(handler2).toHaveBeenCalledWith(expectedData);
    expect(handler3).toHaveBeenCalledWith(expectedData);
  });

  it('error in one handler does not prevent other handlers from running', () => {
    const emitter = new EventEmitter<TestEvents>();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler1 = vi.fn();
    const throwingHandler = vi.fn(() => {
      throw new Error('handler exploded');
    });
    const handler3 = vi.fn();

    emitter.on('message', handler1);
    emitter.on('message', throwingHandler);
    emitter.on('message', handler3);

    const result = emitter.emit('message', { text: 'test' });

    expect(result).toBe(true);
    expect(handler1).toHaveBeenCalledOnce();
    expect(throwingHandler).toHaveBeenCalledOnce();
    expect(handler3).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message"'),
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it('removeAllListeners() with no argument clears all events', () => {
    const emitter = new EventEmitter<TestEvents>();
    const messageHandler = vi.fn();
    const pingHandler = vi.fn();

    emitter.on('message', messageHandler);
    emitter.on('ping', pingHandler);

    emitter.removeAllListeners();

    expect(emitter.emit('message', { text: 'hello' })).toBe(false);
    expect(emitter.emit('ping')).toBe(false);
    expect(messageHandler).not.toHaveBeenCalled();
    expect(pingHandler).not.toHaveBeenCalled();
  });

  it('removeAllListeners(event) clears only that specific event', () => {
    const emitter = new EventEmitter<TestEvents>();
    const messageHandler = vi.fn();
    const pingHandler = vi.fn();

    emitter.on('message', messageHandler);
    emitter.on('ping', pingHandler);

    emitter.removeAllListeners('message');

    expect(emitter.emit('message', { text: 'hello' })).toBe(false);
    expect(messageHandler).not.toHaveBeenCalled();

    // ping should still work
    expect(emitter.emit('ping')).toBe(true);
    expect(pingHandler).toHaveBeenCalledOnce();
  });

  it('on() returns this for chaining', () => {
    const emitter = new EventEmitter<TestEvents>();

    const result = emitter.on('message', vi.fn());

    expect(result).toBe(emitter);
  });

  it('off() returns this for chaining', () => {
    const emitter = new EventEmitter<TestEvents>();

    const result = emitter.off('message', vi.fn());

    expect(result).toBe(emitter);
  });

  it('removeAllListeners() returns this for chaining', () => {
    const emitter = new EventEmitter<TestEvents>();

    const result = emitter.removeAllListeners();

    expect(result).toBe(emitter);
  });

  it('supports fluent chaining of on/off/removeAllListeners', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();

    // Should not throw and should return the emitter at each step
    const result = emitter
      .on('message', handler)
      .on('ping', vi.fn())
      .off('message', handler)
      .removeAllListeners('ping');

    expect(result).toBe(emitter);
  });

  it('adding the same handler reference twice only registers it once (Set behavior)', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();

    emitter.on('message', handler);
    emitter.on('message', handler);

    emitter.emit('message', { text: 'dedup' });

    // Set ensures uniqueness, so handler should only be called once
    expect(handler).toHaveBeenCalledOnce();
  });

  it('emit returns false after all listeners for an event are removed via off()', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();

    emitter.on('ping', handler);
    emitter.off('ping', handler);

    // The Set exists but is empty
    expect(emitter.emit('ping')).toBe(false);
  });
});

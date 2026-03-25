import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BuildSpeechCapture } from '../../src/build/BuildSpeechCapture';
import type { BuildSpeechCallbacks } from '../../src/build/BuildSpeechCapture';

// Mock SpeechCapture — we don't test the browser API here, just the debounce logic
let capturedOnResult: ((text: string, isFinal: boolean) => void) | null = null;
let capturedOnStatus: ((active: boolean) => void) | null = null;

vi.mock('../../src/ai/SpeechCapture', () => ({
  SpeechCapture: class {
    start(onResult: any, onStatus: any) {
      capturedOnResult = onResult;
      capturedOnStatus = onStatus;
    }
    stop() { /* noop */ }
  },
}));

describe('BuildSpeechCapture', () => {
  let capture: BuildSpeechCapture;
  let callbacks: BuildSpeechCallbacks;

  beforeEach(() => {
    vi.useFakeTimers();
    capturedOnResult = null;
    capturedOnStatus = null;

    callbacks = {
      onInterimResult: vi.fn(),
      onFinalMessage: vi.fn(),
      onStatusChange: vi.fn(),
    };

    capture = new BuildSpeechCapture('en-US', callbacks);
  });

  afterEach(() => {
    capture.stop();
    vi.useRealTimers();
  });

  it('starts and reports running', () => {
    expect(capture.isRunning()).toBe(false);
    capture.start();
    expect(capture.isRunning()).toBe(true);
  });

  it('does not double-start', () => {
    capture.start();
    capture.start();
    // SpeechCapture constructor called only once
    expect(capture.isRunning()).toBe(true);
  });

  it('forwards interim results', () => {
    capture.start();
    capturedOnResult!('hello wor', false);
    expect(callbacks.onInterimResult).toHaveBeenCalledWith('hello wor');
    expect(callbacks.onFinalMessage).not.toHaveBeenCalled();
  });

  it('flushes after silence timeout', () => {
    capture.start();
    capturedOnResult!('create a search tool', true);

    // Before silence timeout
    vi.advanceTimersByTime(1000);
    expect(callbacks.onFinalMessage).not.toHaveBeenCalled();

    // After 1500ms silence
    vi.advanceTimersByTime(500);
    expect(callbacks.onFinalMessage).toHaveBeenCalledWith('create a search tool');
  });

  it('accumulates multiple final results before flush', () => {
    capture.start();
    capturedOnResult!('create a', true);

    vi.advanceTimersByTime(800); // still within silence window
    capturedOnResult!('search tool', true);

    vi.advanceTimersByTime(1500); // silence after second result
    expect(callbacks.onFinalMessage).toHaveBeenCalledWith('create a search tool');
    expect(callbacks.onFinalMessage).toHaveBeenCalledTimes(1);
  });

  it('flushes at max hold time even if speech continues', () => {
    capture.start();
    capturedOnResult!('word one', true);

    // Keep speaking every second for 5+ seconds
    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(1000);
      capturedOnResult!(`word ${i + 1}`, true);
    }

    // Max hold (5s) should have triggered a flush by now
    expect(callbacks.onFinalMessage).toHaveBeenCalled();
  });

  it('extends silence timer on interim results while buffer has content', () => {
    capture.start();
    capturedOnResult!('hello', true);

    vi.advanceTimersByTime(1200); // Almost at silence timeout
    capturedOnResult!('still talking', false); // interim — extends timer

    vi.advanceTimersByTime(300); // Would have been past 1500 from first result
    expect(callbacks.onFinalMessage).not.toHaveBeenCalled(); // Timer was reset

    vi.advanceTimersByTime(1200); // Now silence fires
    expect(callbacks.onFinalMessage).toHaveBeenCalledWith('hello');
  });

  it('flushes remaining buffer on stop', () => {
    capture.start();
    capturedOnResult!('unfinished thought', true);

    capture.stop();
    expect(callbacks.onFinalMessage).toHaveBeenCalledWith('unfinished thought');
    expect(capture.isRunning()).toBe(false);
  });

  it('does not fire onFinalMessage for empty buffer on stop', () => {
    capture.start();
    capture.stop();
    expect(callbacks.onFinalMessage).not.toHaveBeenCalled();
  });

  it('forwards status changes', () => {
    capture.start();
    capturedOnStatus!(true);
    expect(callbacks.onStatusChange).toHaveBeenCalledWith(true);
    capturedOnStatus!(false);
    expect(callbacks.onStatusChange).toHaveBeenCalledWith(false);
  });
});

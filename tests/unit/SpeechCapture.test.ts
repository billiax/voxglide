import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SpeechCapture } from '../../src/ai/SpeechCapture';

// Controllable mock SpeechRecognition
class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onresult: ((event: any) => void) | null = null;

  // No auto-fire — tests explicitly call simulateStart() / simulateError()
  start = vi.fn();
  stop = vi.fn();

  // Test helpers
  simulateError(error: string) {
    this.onerror?.({ error });
    // Chrome fires onend after onerror
    this.onend?.();
  }
  simulateStart() {
    this.onstart?.();
  }
}

let mockInstance: MockSpeechRecognition;

beforeEach(() => {
  mockInstance = new MockSpeechRecognition();
  // Must use a regular function (not arrow) so it works with `new`
  (window as any).SpeechRecognition = function () { return mockInstance; };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as any).SpeechRecognition;
});

describe('SpeechCapture', () => {
  describe('not-allowed recovery', () => {
    it('retries with backoff on not-allowed instead of giving up immediately', () => {
      const capture = new SpeechCapture();
      const onStatus = vi.fn();
      capture.start(vi.fn(), onStatus);

      // First not-allowed error
      mockInstance.simulateError('not-allowed');

      // Should still be running
      expect(capture.isRunning()).toBe(true);
      // But speech is reported as inactive
      expect(onStatus).toHaveBeenCalledWith(false);

      // Recovery timer should fire after base delay (3s)
      vi.advanceTimersByTime(3000);
      // Should have attempted to restart
      expect(mockInstance.start).toHaveBeenCalledTimes(2); // initial + recovery

      capture.stop();
    });

    it('gives up after MAX_NOT_ALLOWED_RETRIES', () => {
      const capture = new SpeechCapture();
      const onStatus = vi.fn();
      capture.start(vi.fn(), onStatus);

      // Simulate 6 consecutive not-allowed errors (max is 5)
      for (let i = 0; i < 6; i++) {
        mockInstance.simulateError('not-allowed');
        if (capture.isRunning()) {
          // Advance past recovery delay
          vi.advanceTimersByTime(30000);
        }
      }

      // Should have given up
      expect(capture.isRunning()).toBe(false);
    });

    it('resets retry count on successful start', () => {
      const capture = new SpeechCapture();
      capture.start(vi.fn(), vi.fn());

      // 4 not-allowed errors
      for (let i = 0; i < 4; i++) {
        mockInstance.simulateError('not-allowed');
        vi.advanceTimersByTime(30000);
      }

      expect(capture.isRunning()).toBe(true);

      // Now it succeeds
      mockInstance.simulateStart();

      // After success, retry count resets — can handle 4 more errors
      for (let i = 0; i < 4; i++) {
        mockInstance.simulateError('not-allowed');
        vi.advanceTimersByTime(30000);
      }

      expect(capture.isRunning()).toBe(true);

      capture.stop();
    });

    it('uses exponential backoff for recovery delays', () => {
      const capture = new SpeechCapture();
      capture.start(vi.fn(), vi.fn());

      const startCalls = () => mockInstance.start.mock.calls.length;

      // First not-allowed → schedules retry at 3s
      mockInstance.simulateError('not-allowed');
      const after1 = startCalls();

      vi.advanceTimersByTime(2999);
      expect(startCalls()).toBe(after1); // Not yet

      vi.advanceTimersByTime(1);
      expect(startCalls()).toBe(after1 + 1); // 3s: retry fires

      // Second not-allowed → schedules retry at 6s
      mockInstance.simulateError('not-allowed');
      const after2 = startCalls();

      vi.advanceTimersByTime(5999);
      expect(startCalls()).toBe(after2); // Not yet

      vi.advanceTimersByTime(1);
      expect(startCalls()).toBe(after2 + 1); // 6s: retry fires

      capture.stop();
    });

    it('does not auto-restart via onend when recovery timer is active', () => {
      const capture = new SpeechCapture();
      capture.start(vi.fn(), vi.fn());

      const startCalls = () => mockInstance.start.mock.calls.length;
      const initialCalls = startCalls();

      // not-allowed sets recovery timer, then onend fires
      mockInstance.simulateError('not-allowed');

      // onend should NOT trigger doStart since recovery timer is managing restarts
      const afterError = startCalls();
      expect(afterError).toBe(initialCalls); // No extra start calls from onend

      capture.stop();
    });

    it('stop() cleans up recovery timer', () => {
      const capture = new SpeechCapture();
      capture.start(vi.fn(), vi.fn());

      mockInstance.simulateError('not-allowed');
      // Recovery timer is scheduled

      capture.stop();
      expect(capture.isRunning()).toBe(false);

      // Advance past recovery delay — should not attempt restart
      const startCalls = mockInstance.start.mock.calls.length;
      vi.advanceTimersByTime(30000);
      expect(mockInstance.start.mock.calls.length).toBe(startCalls);
    });

    it('recovers when mic becomes available after not-allowed', () => {
      const capture = new SpeechCapture();
      const onStatus = vi.fn();
      capture.start(vi.fn(), onStatus);

      // Mic busy
      mockInstance.simulateError('not-allowed');
      expect(onStatus).toHaveBeenCalledWith(false);

      // Recovery timer fires, tries again
      vi.advanceTimersByTime(3000);

      // This time mic is available
      mockInstance.simulateStart();
      expect(onStatus).toHaveBeenCalledWith(true);
      expect(capture.isRunning()).toBe(true);

      capture.stop();
    });

    it('retrySpeech() resets recovery and retries immediately', () => {
      const capture = new SpeechCapture();
      const onStatus = vi.fn();
      capture.start(vi.fn(), onStatus);

      // Exhaust 4 of 5 retries
      for (let i = 0; i < 4; i++) {
        mockInstance.simulateError('not-allowed');
        vi.advanceTimersByTime(30000);
      }
      expect(capture.isRunning()).toBe(true);

      // User clicks the button → retrySpeech()
      const callsBefore = mockInstance.start.mock.calls.length;
      capture.retrySpeech();

      // Should have retried immediately
      expect(mockInstance.start.mock.calls.length).toBe(callsBefore + 1);

      // And counter is reset — can handle 5 more failures
      for (let i = 0; i < 4; i++) {
        mockInstance.simulateError('not-allowed');
        vi.advanceTimersByTime(30000);
      }
      expect(capture.isRunning()).toBe(true);

      capture.stop();
    });

    it('retrySpeech() restores running state even after give-up', () => {
      const capture = new SpeechCapture();
      capture.start(vi.fn(), vi.fn());

      // Exhaust all retries
      for (let i = 0; i < 6; i++) {
        mockInstance.simulateError('not-allowed');
        if (capture.isRunning()) {
          vi.advanceTimersByTime(30000);
        }
      }
      expect(capture.isRunning()).toBe(false);

      // User clicks → retrySpeech() brings it back
      capture.retrySpeech();
      expect(capture.isRunning()).toBe(true);
      expect(mockInstance.start).toHaveBeenCalled();

      capture.stop();
    });

    it('handles service-not-allowed the same as not-allowed', () => {
      const capture = new SpeechCapture();
      capture.start(vi.fn(), vi.fn());

      mockInstance.simulateError('service-not-allowed');
      expect(capture.isRunning()).toBe(true); // Not fatal, retrying

      vi.advanceTimersByTime(3000);
      expect(mockInstance.start).toHaveBeenCalledTimes(2); // initial + recovery

      capture.stop();
    });
  });
});

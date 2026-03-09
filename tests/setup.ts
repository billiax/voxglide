import { vi } from 'vitest';

// Mock AudioContext for jsdom (not natively available)
class MockAudioContext {
  state = 'running';
  sampleRate = 16000;
  destination = {};

  createMediaStreamSource() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createScriptProcessor() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null as any,
    };
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

// Mock MediaDevices
const mockMediaStream = {
  getTracks: () => [{ stop: vi.fn() }],
};

Object.defineProperty(window, 'AudioContext', { value: MockAudioContext });
Object.defineProperty(window, 'webkitAudioContext', { value: MockAudioContext });

Object.defineProperty(navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn().mockResolvedValue(mockMediaStream),
  },
  writable: true,
});

// Mock MutationObserver (jsdom has limited support)
if (typeof MutationObserver === 'undefined') {
  (globalThis as any).MutationObserver = class {
    callback: any;
    constructor(callback: any) { this.callback = callback; }
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}

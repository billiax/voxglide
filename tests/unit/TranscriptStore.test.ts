import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscriptStore } from '../../src/ui/TranscriptStore';
import type { StoredTranscriptLine } from '../../src/ui/TranscriptStore';

describe('TranscriptStore', () => {
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    const sessionStorageMock = {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    };

    Object.defineProperty(window, 'sessionStorage', {
      value: sessionStorageMock,
      writable: true,
      configurable: true,
    });
  });

  describe('save()', () => {
    it('saves lines to sessionStorage', () => {
      const lines: StoredTranscriptLine[] = [
        { speaker: 'user', text: 'Hello' },
        { speaker: 'ai', text: 'Hi there' },
      ];
      TranscriptStore.save(lines);

      expect(sessionStorage.setItem).toHaveBeenCalled();
      const saved = JSON.parse((sessionStorage.setItem as any).mock.calls[0][1]);
      expect(saved).toHaveLength(2);
      expect(saved[0].speaker).toBe('user');
    });

    it('keeps only last 20 lines', () => {
      const lines: StoredTranscriptLine[] = [];
      for (let i = 0; i < 30; i++) {
        lines.push({ speaker: 'user', text: `Message ${i}` });
      }
      TranscriptStore.save(lines);

      const saved = JSON.parse((sessionStorage.setItem as any).mock.calls[0][1]);
      expect(saved).toHaveLength(20);
      expect(saved[0].text).toBe('Message 10'); // kept last 20
    });
  });

  describe('load()', () => {
    it('returns empty array when nothing stored', () => {
      const result = TranscriptStore.load();
      expect(result).toEqual([]);
    });

    it('returns parsed lines from storage', () => {
      const lines = [{ speaker: 'user', text: 'Test' }];
      mockStorage['voice-sdk-transcript'] = JSON.stringify(lines);

      const result = TranscriptStore.load();
      expect(result).toEqual(lines);
    });

    it('returns empty array on invalid JSON', () => {
      mockStorage['voice-sdk-transcript'] = 'not-json{{{';
      const result = TranscriptStore.load();
      expect(result).toEqual([]);
    });
  });

  describe('clear()', () => {
    it('removes from sessionStorage', () => {
      TranscriptStore.clear();
      expect(sessionStorage.removeItem).toHaveBeenCalled();
    });
  });
});

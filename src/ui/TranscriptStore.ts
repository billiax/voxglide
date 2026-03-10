const STORAGE_KEY = 'voice-sdk-transcript';
const MAX_LINES = 20;

export interface StoredTranscriptLine {
  speaker: 'user' | 'ai';
  text: string;
}

export class TranscriptStore {
  static save(lines: StoredTranscriptLine[]): void {
    try {
      const trimmed = lines.slice(-MAX_LINES);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // sessionStorage may be full or disabled
    }
  }

  static load(): StoredTranscriptLine[] {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  }

  static clear(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

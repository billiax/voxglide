import { SpeechCapture } from '../ai/SpeechCapture';

export interface BuildSpeechCallbacks {
  /** Called with interim (live) speech results for display */
  onInterimResult: (text: string) => void;
  /** Called when silence debounce fires — the full accumulated utterance */
  onFinalMessage: (text: string) => void;
  /** Mic on/off */
  onStatusChange: (active: boolean) => void;
}

/**
 * Speech capture for build mode with silence-based debounce.
 * Accumulates final SpeechRecognition results and flushes them as a single
 * message after 1.5 s of silence (or 5 s max hold).
 *
 * Extracted from VoiceSDK to keep it focused on the main voice flow.
 */
export class BuildSpeechCapture {
  private static readonly SILENCE_MS = 1500;
  private static readonly MAX_HOLD_MS = 5000;

  private speech: SpeechCapture | null = null;
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startTime: number | null = null;
  private callbacks: BuildSpeechCallbacks;
  private language: string;

  constructor(language: string, callbacks: BuildSpeechCallbacks) {
    this.language = language;
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.speech) return;

    this.speech = new SpeechCapture(this.language);
    this.speech.start(
      (text: string, isFinal: boolean) => {
        if (!isFinal) {
          this.callbacks.onInterimResult(text);
        }

        if (isFinal && text.trim()) {
          this.debounce(text.trim());
        } else if (!isFinal && this.buffer) {
          // User still speaking — extend silence timer
          this.resetSilenceTimer();
        }
      },
      (active: boolean) => {
        this.callbacks.onStatusChange(active);
      },
      () => { /* handled by SpeechCapture auto-retry */ },
    );
  }

  stop(): void {
    this.flush();
    this.speech?.stop();
    this.speech = null;
  }

  isRunning(): boolean {
    return this.speech !== null;
  }

  private debounce(text: string): void {
    this.buffer = this.buffer ? this.buffer + ' ' + text : text;
    if (!this.startTime) {
      this.startTime = Date.now();
    }
    this.resetSilenceTimer();
  }

  private resetSilenceTimer(): void {
    if (this.timer) clearTimeout(this.timer);

    const elapsed = this.startTime ? Date.now() - this.startTime : 0;
    if (elapsed >= BuildSpeechCapture.MAX_HOLD_MS) {
      this.flush();
      return;
    }

    const remaining = BuildSpeechCapture.MAX_HOLD_MS - elapsed;
    const delay = Math.min(BuildSpeechCapture.SILENCE_MS, remaining);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.startTime = null;
    const text = this.buffer;
    this.buffer = '';
    if (text) {
      this.callbacks.onFinalMessage(text);
    }
  }
}

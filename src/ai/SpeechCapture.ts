/**
 * Browser-native speech recognition using the Web Speech API.
 * Captures speech, transcribes locally, emits text results.
 */
export class SpeechCapture {
  private recognition: any = null;
  private onResult: ((text: string, isFinal: boolean) => void) | null = null;
  private onStatusChange: ((listening: boolean) => void) | null = null;
  private running = false;
  private paused = false;
  private language: string;

  constructor(language = 'en-US') {
    this.language = language;
  }

  start(
    onResult: (text: string, isFinal: boolean) => void,
    onStatusChange?: (listening: boolean) => void,
  ): void {
    this.onResult = onResult;
    this.onStatusChange = onStatusChange || null;

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      throw new Error('SpeechRecognition API not supported in this browser');
    }

    this.recognition = new SpeechRecognitionCtor();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.language;

    this.recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        this.onResult?.(text, result.isFinal);
      }
    };

    this.recognition.onstart = () => {
      this.running = true;
      this.onStatusChange?.(true);
    };

    this.recognition.onend = () => {
      // Auto-restart if we're still supposed to be running (and not paused for TTS)
      if (this.running && !this.paused && this.recognition) {
        try {
          this.recognition.start();
        } catch {
          // Already started or destroyed
        }
      } else if (!this.running) {
        this.onStatusChange?.(false);
      }
    };

    this.recognition.onerror = (event: any) => {
      // 'no-speech' and 'aborted' are non-fatal — recognition auto-restarts
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error('[VoiceSDK:SpeechCapture]', event.error);
      }
    };

    this.running = true;
    this.recognition.start();
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      try {
        this.recognition.stop();
      } catch {
        // Already stopped
      }
      this.recognition = null;
    }
    this.onResult = null;
    this.onStatusChange?.(false);
    this.onStatusChange = null;
  }

  /**
   * Pause recognition (e.g. while TTS is playing to avoid feedback loop).
   * The recognition instance is kept alive — it just stops listening.
   */
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Already stopped
      }
    }
  }

  /**
   * Resume recognition after a pause.
   */
  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    if (this.recognition) {
      try {
        this.recognition.start();
      } catch {
        // Already started
      }
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  isPaused(): boolean {
    return this.paused;
  }
}

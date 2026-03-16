/**
 * Browser-native speech recognition using the Web Speech API.
 * Captures speech, transcribes locally, emits text results.
 *
 * Handles the Web Speech API's known reliability issues:
 *  - Silent restart failures after idle / no-speech errors
 *  - Browser throttling recognition after background/inactive tabs
 *  - Watchdog timer to detect and recover from stale state
 */
export class SpeechCapture {
  private recognition: any = null;
  private onResult: ((text: string, isFinal: boolean) => void) | null = null;
  private onStatusChange: ((listening: boolean) => void) | null = null;
  private running = false;
  private paused = false;
  private language: string;

  /** True only between onstart and onend — reflects actual browser state */
  private actuallyListening = false;

  /** Watchdog: verifies recognition.start() actually worked */
  private startWatchdog: ReturnType<typeof setTimeout> | null = null;
  private static readonly START_WATCHDOG_MS = 4000;

  /** Consecutive restart failures before recreating the instance */
  private restartFailures = 0;
  private static readonly MAX_RESTART_FAILURES = 3;

  /** Delay before auto-restart to avoid Chrome "already started" race */
  private static readonly RESTART_DELAY_MS = 150;

  /** Tracked timer for restart-failure retry (so stop() can cancel it) */
  private restartRetryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Recovery from not-allowed errors (mic busy, temporary device issues) */
  private notAllowedRetries = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_NOT_ALLOWED_RETRIES = 5;
  private static readonly NOT_ALLOWED_BASE_DELAY_MS = 3000;
  private static readonly NOT_ALLOWED_MAX_DELAY_MS = 30000;

  constructor(language = 'en-US') {
    this.language = language;
  }

  start(
    onResult: (text: string, isFinal: boolean) => void,
    onStatusChange?: (listening: boolean) => void,
  ): void {
    this.onResult = onResult;
    this.onStatusChange = onStatusChange || null;

    this.running = true;
    this.createRecognition();
    this.doStart();
  }

  private createRecognition(): void {
    // Clean up old instance if any
    if (this.recognition) {
      this.recognition.onstart = null;
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      try { this.recognition.stop(); } catch { /* ignore */ }
    }

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
      this.actuallyListening = true;
      this.restartFailures = 0;
      this.notAllowedRetries = 0;
      this.clearRecoveryTimer();
      this.clearWatchdog();
      this.onStatusChange?.(true);
    };

    this.recognition.onend = () => {
      this.actuallyListening = false;
      this.onStatusChange?.(false);
      // Auto-restart if we're still supposed to be running (and not paused for TTS).
      // Skip if recovery timer is active — it manages its own restart schedule.
      // Small delay avoids Chrome "already started" race condition where the
      // internal session hasn't fully torn down before the next start() call.
      if (this.running && !this.paused && !this.recoveryTimer) {
        this.restartRetryTimer = setTimeout(() => {
          this.restartRetryTimer = null;
          if (this.running && !this.paused && !this.actuallyListening) {
            this.doStart();
          }
        }, SpeechCapture.RESTART_DELAY_MS);
      }
    };

    this.recognition.onerror = (event: any) => {
      // 'no-speech' and 'aborted' are non-fatal — recognition auto-restarts via onend
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      // not-allowed / service-not-allowed: mic may be temporarily busy
      // (another SpeechRecognition active, device grabbed by another app).
      // Retry with exponential backoff; give up after MAX_NOT_ALLOWED_RETRIES.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.actuallyListening = false;
        this.clearWatchdog();
        this.notAllowedRetries++;

        if (this.notAllowedRetries > SpeechCapture.MAX_NOT_ALLOWED_RETRIES) {
          console.error('[VoiceSDK:SpeechCapture]', event.error, '— giving up after retries');
          this.running = false;
          this.clearRecoveryTimer();
          this.onStatusChange?.(false);
          return;
        }

        console.warn(
          `[VoiceSDK:SpeechCapture] ${event.error} — retry ${this.notAllowedRetries}/${SpeechCapture.MAX_NOT_ALLOWED_RETRIES}`,
        );
        this.onStatusChange?.(false);
        this.scheduleRecovery();
        return;
      }

      console.error('[VoiceSDK:SpeechCapture]', event.error);
    };
  }

  /**
   * Attempt to start recognition with a watchdog timer.
   * If onstart doesn't fire within the timeout, recognition is considered dead
   * and recovery is attempted (recreate the instance after enough failures).
   */
  private doStart(): void {
    if (!this.running || !this.recognition) return;

    this.clearWatchdog();

    try {
      this.recognition.start();
    } catch {
      // start() threw — count as a restart failure
      this.handleRestartFailure();
      return;
    }

    // Watchdog: if onstart doesn't fire, recognition silently failed
    this.startWatchdog = setTimeout(() => {
      this.startWatchdog = null;
      if (!this.actuallyListening && this.running && !this.paused) {
        this.handleRestartFailure();
      }
    }, SpeechCapture.START_WATCHDOG_MS);
  }

  /**
   * Handle a restart failure. After enough consecutive failures,
   * recreate the SpeechRecognition instance from scratch.
   */
  private handleRestartFailure(): void {
    this.restartFailures++;

    if (this.restartFailures >= SpeechCapture.MAX_RESTART_FAILURES) {
      // Recreate the entire recognition instance
      this.restartFailures = 0;
      this.createRecognition();
    }

    // Retry after a backoff delay
    if (this.running && !this.paused) {
      const delay = Math.min(1000 * this.restartFailures, 3000);
      this.clearRestartRetryTimer();
      this.restartRetryTimer = setTimeout(() => {
        this.restartRetryTimer = null;
        if (this.running && !this.paused && !this.actuallyListening) {
          this.doStart();
        }
      }, delay);
    }
  }

  private clearWatchdog(): void {
    if (this.startWatchdog) {
      clearTimeout(this.startWatchdog);
      this.startWatchdog = null;
    }
  }

  /**
   * Schedule a recovery attempt after a not-allowed error.
   * Uses exponential backoff: 3s, 6s, 12s, 24s, 30s (capped).
   */
  private scheduleRecovery(): void {
    this.clearRecoveryTimer();
    if (!this.running || this.paused) return;

    const delay = Math.min(
      SpeechCapture.NOT_ALLOWED_BASE_DELAY_MS * Math.pow(2, this.notAllowedRetries - 1),
      SpeechCapture.NOT_ALLOWED_MAX_DELAY_MS,
    );

    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      if (this.running && !this.paused && !this.actuallyListening) {
        this.doStart();
      }
    }, delay);
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  private clearRestartRetryTimer(): void {
    if (this.restartRetryTimer) {
      clearTimeout(this.restartRetryTimer);
      this.restartRetryTimer = null;
    }
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    this.actuallyListening = false;
    this.clearWatchdog();
    this.clearRecoveryTimer();
    this.clearRestartRetryTimer();
    this.notAllowedRetries = 0;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onstart = null;
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
    this.clearWatchdog();
    this.clearRestartRetryTimer();
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
      this.doStart();
    }
  }

  /**
   * Retry speech recognition immediately (e.g. from a user gesture).
   * Resets recovery state so the user click gets a fresh set of attempts.
   * If speech is already running, this is a no-op.
   */
  retrySpeech(): void {
    if (this.actuallyListening) return;

    this.notAllowedRetries = 0;
    this.clearRecoveryTimer();
    this.running = true;
    this.paused = false;

    if (!this.recognition) {
      this.createRecognition();
    }
    this.doStart();
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * True only when the browser is actually capturing audio.
   * Unlike isRunning() (user intent), this reflects the real browser state —
   * false during restart gaps, watchdog recovery, and silent Chrome failures.
   */
  isActuallyListening(): boolean {
    return this.actuallyListening;
  }

  isPaused(): boolean {
    return this.paused;
  }
}

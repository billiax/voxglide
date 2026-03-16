import { DEFAULT_LANGUAGE } from '../constants';
import type { TTSManagerDeps } from './types';

/**
 * Manages browser TTS (Text-to-Speech) with speech pause/resume
 * to prevent feedback loops with speech recognition.
 */
export class TTSManager {
  private deps: TTSManagerDeps;

  constructor(deps: TTSManagerDeps) {
    this.deps = deps;
  }

  /**
   * Speak text using browser TTS.
   * Pauses speech recognition during playback to prevent feedback loop.
   */
  speak(text: string): void {
    if (typeof speechSynthesis === 'undefined') return;

    // Pause mic to prevent TTS audio being picked up as user speech
    this.deps.getSession()?.pauseSpeech();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.deps.config.language || DEFAULT_LANGUAGE;
    const ttsRate = this.deps.getA11yTtsRate();
    if (ttsRate !== null) {
      utterance.rate = ttsRate;
    }

    utterance.onend = () => {
      this.deps.getSession()?.resumeSpeech();
    };

    utterance.onerror = () => {
      this.deps.getSession()?.resumeSpeech();
    };

    speechSynthesis.speak(utterance);
  }

  /**
   * Cancel any in-progress or queued TTS playback.
   */
  cancel(): void {
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }
  }
}

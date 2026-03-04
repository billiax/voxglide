import { INPUT_SAMPLE_RATE, BUFFER_SIZE } from '../constants';

/**
 * Encodes Float32 audio data into base64 PCM 16-bit for Gemini.
 */
function createPcmBlob(data: Float32Array, sampleRate: number) {
  const len = data.length;
  const int16 = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const uint8 = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < uint8.byteLength; i++) {
    binary += String.fromCharCode(uint8[i]);
  }

  return {
    data: btoa(binary),
    mimeType: `audio/pcm;rate=${sampleRate}`,
  };
}

export class AudioCapture {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private onAudioData: ((blob: { data: string; mimeType: string }) => void) | null = null;

  async start(onAudioData: (blob: { data: string; mimeType: string }) => void): Promise<void> {
    this.onAudioData = onAudioData;

    await this.ensureAudioContext();

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: INPUT_SAMPLE_RATE,
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: true,
      },
    });

    await this.ensureAudioContext();
    this.startStreaming();
  }

  private async ensureAudioContext(): Promise<void> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: INPUT_SAMPLE_RATE,
      });
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  private startStreaming(): void {
    if (!this.audioContext || !this.mediaStream) return;

    this.cleanupNodes();

    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmBlob = createPcmBlob(inputData, INPUT_SAMPLE_RATE);
      this.onAudioData?.(pcmBlob);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  private cleanupNodes(): void {
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
  }

  async stop(): Promise<void> {
    this.onAudioData = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.cleanupNodes();

    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        // Ignore close errors
      }
      this.audioContext = null;
    }
  }
}

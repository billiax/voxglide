import { useRef, useState, useEffect, useCallback } from 'react';
import { VoiceSDK, ConnectionState } from 'voxglide';
import type { VoiceState, TranscriptEntry, UseVoiceSDKOptions } from './types';

const INITIAL_STATE: VoiceState = {
  isConnected: false,
  isListening: false,
  isConnecting: false,
  error: null,
};

/**
 * Core hook for VoiceSDK. Creates and manages a VoiceSDK instance.
 *
 * Defaults `ui` to `false` (React developers build their own UI).
 * Pass `ui: {}` or a UIConfig object to use the built-in overlay UI.
 */
export function useVoiceSDK(options: UseVoiceSDKOptions) {
  const sdkRef = useRef<VoiceSDK | null>(null);
  const [state, setState] = useState<VoiceState>(INITIAL_STATE);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  useEffect(() => {
    const config = { ...options, ui: options.ui ?? false };
    const sdk = new VoiceSDK(config);
    sdkRef.current = sdk;

    sdk.on('stateChange', ({ to }) => {
      setState({
        isConnected: to === ConnectionState.CONNECTED,
        isConnecting: to === ConnectionState.CONNECTING,
        isListening: to === ConnectionState.CONNECTED,
        error: to === ConnectionState.ERROR ? 'Connection error' : null,
      });
    });

    sdk.on('error', ({ message }) => {
      setState(prev => ({ ...prev, error: message }));
    });

    sdk.on('transcript', (event) => {
      setTranscript(prev => {
        // Replace last non-final entry from same speaker with final version
        if (event.isFinal && prev.length > 0) {
          const last = prev[prev.length - 1];
          if (last.speaker === event.speaker && !last.isFinal) {
            return [...prev.slice(0, -1), { ...event, timestamp: last.timestamp }];
          }
        }
        return [...prev, { ...event, timestamp: Date.now() }];
      });
    });

    return () => {
      sdk.destroy();
      sdkRef.current = null;
    };
    // SDK is created once per mount. Config changes require remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    await sdkRef.current?.start();
  }, []);

  const stop = useCallback(async () => {
    await sdkRef.current?.stop();
  }, []);

  const toggle = useCallback(async () => {
    await sdkRef.current?.toggle();
  }, []);

  const sendText = useCallback((text: string) => {
    sdkRef.current?.sendText(text);
  }, []);

  return {
    sdk: sdkRef.current,
    state,
    transcript,
    start,
    stop,
    toggle,
    sendText,
    isConnected: state.isConnected,
    isListening: state.isListening,
    error: state.error,
  };
}

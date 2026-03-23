import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadVoiceSDK } from './script-loader';
import type {
  VoiceSDKInstance,
  VoiceState,
  TranscriptEntry,
  VoxGlideContextValue,
  VoxGlideProviderProps,
} from './types';

const CONNECTED = 'connected';
const CONNECTING = 'connecting';
const ERROR = 'error';

const INITIAL_STATE: VoiceState = {
  isConnected: false,
  isListening: false,
  isConnecting: false,
  error: null,
};

export const VoxGlideContext = createContext<VoxGlideContextValue | undefined>(undefined);

/**
 * Loads the VoiceSDK from the proxy server and provides it via React context.
 *
 * All props except serverUrl, sdkUrl, autoStart, and children are passed
 * straight through to the VoiceSDK constructor. The wrapper has no knowledge
 * of the SDK's config shape — install `voxglide` for TypeScript autocomplete.
 */
export function VoxGlideProvider({
  children,
  sdkUrl,
  autoStart = false,
  serverUrl,
  ...sdkConfig
}: VoxGlideProviderProps) {
  const sdkRef = useRef<VoiceSDKInstance | null>(null);
  const configRef = useRef(sdkConfig);
  configRef.current = sdkConfig;
  const autoStartRef = useRef(autoStart);
  autoStartRef.current = autoStart;

  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<VoiceState>(INITIAL_STATE);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    let instance: VoiceSDKInstance | null = null;

    loadVoiceSDK(serverUrl, sdkUrl)
      .then((VoiceSDKClass) => {
        if (cancelled) return;

        instance = new VoiceSDKClass({ serverUrl, ...configRef.current });
        sdkRef.current = instance;

        instance.on('stateChange', ({ to }: { to: string }) => {
          if (cancelled) return;
          setState({
            isConnected: to === CONNECTED,
            isConnecting: to === CONNECTING,
            isListening: to === CONNECTED,
            error: to === ERROR ? 'Connection error' : null,
          });
        });

        instance.on('error', ({ message }: { message: string }) => {
          if (cancelled) return;
          setState((prev) => ({ ...prev, error: message }));
        });

        instance.on('transcript', (event: { speaker: 'user' | 'ai'; text: string; isFinal: boolean }) => {
          if (cancelled) return;
          setTranscript((prev) => {
            if (event.isFinal && prev.length > 0) {
              const last = prev[prev.length - 1];
              if (last.speaker === event.speaker && !last.isFinal) {
                return [...prev.slice(0, -1), { ...event, timestamp: last.timestamp }];
              }
            }
            return [...prev, { ...event, timestamp: Date.now() }];
          });
        });

        setIsReady(true);

        if (autoStartRef.current) {
          instance.start();
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message);
      });

    return () => {
      cancelled = true;
      instance?.destroy();
      sdkRef.current = null;
      setIsReady(false);
      setState(INITIAL_STATE);
      setTranscript([]);
      setLoadError(null);
    };
  }, [serverUrl, sdkUrl]);

  const start = useCallback(async () => { await sdkRef.current?.start(); }, []);
  const stop = useCallback(async () => { await sdkRef.current?.stop(); }, []);
  const toggle = useCallback(async () => { await sdkRef.current?.toggle(); }, []);
  const sendText = useCallback((text: string) => { sdkRef.current?.sendText(text); }, []);

  const value = useMemo<VoxGlideContextValue>(() => ({
    sdk: sdkRef.current,
    state,
    transcript,
    start,
    stop,
    toggle,
    sendText,
    isReady,
    error: loadError ?? state.error,
  }), [state, transcript, start, stop, toggle, sendText, isReady, loadError]);

  return (
    <VoxGlideContext.Provider value={value}>
      {children}
    </VoxGlideContext.Provider>
  );
}

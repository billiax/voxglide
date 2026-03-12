import React, { useRef, useEffect } from 'react';
import { VoiceSDK } from 'voxglide';
import type { VoiceAssistantProps } from './types';

/**
 * Drop-in voice assistant component that renders the built-in VoiceSDK UI.
 *
 * Unlike useVoiceSDK (which defaults ui to false), this component keeps the
 * built-in floating button and transcript overlay. Use this when you want
 * VoiceSDK's default UI inside a React app with zero custom UI work.
 */
export function VoiceAssistant({ config }: VoiceAssistantProps) {
  const sdkRef = useRef<VoiceSDK | null>(null);

  useEffect(() => {
    // Keep built-in UI enabled (default behavior)
    const sdk = new VoiceSDK(config);
    sdkRef.current = sdk;

    return () => {
      sdk.destroy();
      sdkRef.current = null;
    };
    // SDK is created once. Config changes require remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The SDK manages its own DOM (Shadow DOM). No React rendering needed.
  return null;
}

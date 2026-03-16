import React, { useRef, useEffect } from 'react';
import { VoiceSDK } from 'voxglide';
import type { VoiceSDKConfig } from 'voxglide';
import type { VoiceAssistantProps } from './types';

/**
 * Drop-in voice assistant component that renders the built-in VoiceSDK UI.
 *
 * Accepts config either as a `config` prop or as flat props:
 *   <VoiceAssistant config={{ serverUrl: '...' }} />
 *   <VoiceAssistant serverUrl="..." />
 */
export function VoiceAssistant({ config, ...rest }: VoiceAssistantProps) {
  const sdkRef = useRef<VoiceSDK | null>(null);

  useEffect(() => {
    const resolved: VoiceSDKConfig = config ?? rest as VoiceSDKConfig;
    const sdk = new VoiceSDK(resolved);
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

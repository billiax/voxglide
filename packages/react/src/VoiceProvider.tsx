import React from 'react';
import { VoiceContext } from './context';
import { useVoiceSDK } from './useVoiceSDK';
import type { VoiceProviderProps } from './types';
import type { VoiceSDKConfig } from 'voxglide';

/**
 * Context provider that creates a VoiceSDK instance and makes it
 * available to child components via useVoiceAction, useVoiceTranscript,
 * and direct context access.
 *
 * Accepts config either as a `config` prop or as flat props:
 *   <VoiceProvider config={{ serverUrl: '...' }}>
 *   <VoiceProvider serverUrl="...">
 */
export function VoiceProvider({ config, children, ...rest }: VoiceProviderProps) {
  const resolved: VoiceSDKConfig = config ?? rest as VoiceSDKConfig;
  const value = useVoiceSDK(resolved);

  return (
    <VoiceContext.Provider value={value}>
      {children}
    </VoiceContext.Provider>
  );
}

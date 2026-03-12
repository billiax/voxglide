import React from 'react';
import { VoiceContext } from './context';
import { useVoiceSDK } from './useVoiceSDK';
import type { VoiceProviderProps } from './types';

/**
 * Context provider that creates a VoiceSDK instance and makes it
 * available to child components via useVoiceAction, useVoiceTranscript,
 * and direct context access.
 *
 * Place at the root of your app (or the subtree that needs voice).
 * The built-in UI is disabled by default — use VoiceAssistant for that.
 */
export function VoiceProvider({ config, children }: VoiceProviderProps) {
  const value = useVoiceSDK(config);

  return (
    <VoiceContext.Provider value={value}>
      {children}
    </VoiceContext.Provider>
  );
}

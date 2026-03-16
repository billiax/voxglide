import { useContext } from 'react';
import { VoiceContext } from './context';
import type { TranscriptEntry } from './types';

/**
 * Subscribe to the voice transcript from VoiceProvider context.
 *
 * Must be used inside a VoiceProvider.
 */
export function useVoiceTranscript(): TranscriptEntry[] {
  const { transcript } = useContext(VoiceContext);
  return transcript;
}

import { createContext } from 'react';
import type { VoiceContextValue } from './types';

const noop = async () => {};

export const VoiceContext = createContext<VoiceContextValue>({
  sdk: null,
  state: { isConnected: false, isListening: false, isConnecting: false, error: null },
  transcript: [],
  start: noop,
  stop: noop,
  toggle: noop,
  sendText: () => {},
});

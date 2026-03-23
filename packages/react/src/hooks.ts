import { useContext, useEffect, useRef } from 'react';
import { VoxGlideContext } from './provider';
import type { VoxGlideContextValue } from './types';

/**
 * Access the VoiceSDK instance and controls from context.
 * Must be used inside a <VoxGlideProvider>.
 */
export function useVoxGlide(): VoxGlideContextValue {
  const ctx = useContext(VoxGlideContext);
  if (ctx === undefined) {
    throw new Error('useVoxGlide must be used within a <VoxGlideProvider>');
  }
  return ctx;
}

/**
 * Subscribe to a VoiceSDK event. Automatically unsubscribes on unmount.
 *
 * Uses a ref for the handler so inline arrow functions don't cause
 * re-subscriptions on every render.
 *
 * For typed events, install `voxglide` and use its event types:
 * @example
 * useVoxGlideEvent('transcript', (event) => {
 *   console.log(event.speaker, event.text);
 * });
 *
 * useVoxGlideEvent('connected', () => {
 *   console.log('Connected!');
 * });
 */
export function useVoxGlideEvent(
  event: string,
  handler: (...args: any[]) => void,
): void {
  const { sdk } = useVoxGlide();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!sdk) return;

    const wrapped = (...args: any[]) => handlerRef.current(...args);

    sdk.on(event, wrapped);
    return () => { sdk.off(event, wrapped); };
  }, [sdk, event]);
}

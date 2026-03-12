import { useContext, useEffect } from 'react';
import type { CustomAction } from 'voxglide';
import { VoiceContext } from './context';

/**
 * Register a custom action on the VoiceSDK instance from context.
 * Automatically unregisters on unmount.
 *
 * Must be used inside a VoiceProvider.
 */
export function useVoiceAction(name: string, action: CustomAction): void {
  const { sdk } = useContext(VoiceContext);

  useEffect(() => {
    if (!sdk) return;
    sdk.registerAction(name, action);
    return () => {
      sdk.removeAction(name);
    };
    // Re-register if name or action identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, name, action]);
}

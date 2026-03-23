import type { VoiceSDKConstructor } from './types';

const loadCache = new Map<string, Promise<VoiceSDKConstructor>>();

/**
 * Derive the SDK script URL from a WebSocket server URL.
 * ws://host:port → http://host:port/sdk/voice-sdk.iife.js
 * wss://host:port → https://host:port/sdk/voice-sdk.iife.js
 */
export function deriveScriptUrl(serverUrl: string): string {
  return serverUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/+$/, '') + '/sdk/voice-sdk.iife.js';
}

/**
 * Load the VoiceSDK IIFE script from the proxy server.
 * Idempotent: deduplicates concurrent calls and caches resolved loads.
 * Returns the VoiceSDK constructor from window.VoiceSDK.
 */
export function loadVoiceSDK(serverUrl: string, sdkUrl?: string): Promise<VoiceSDKConstructor> {
  const url = sdkUrl ?? deriveScriptUrl(serverUrl);

  // Already loaded (manual script tag or previous load)
  const existing = (window as any).VoiceSDK as VoiceSDKConstructor | undefined;
  if (existing) return Promise.resolve(existing);

  // Dedup concurrent calls to the same URL
  const cached = loadCache.get(url);
  if (cached) return cached;

  const promise = new Promise<VoiceSDKConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      const ctor = (window as any).VoiceSDK as VoiceSDKConstructor | undefined;
      if (ctor) {
        resolve(ctor);
      } else {
        loadCache.delete(url);
        reject(new Error('VoiceSDK script loaded but window.VoiceSDK not found'));
      }
    };
    script.onerror = () => {
      loadCache.delete(url);
      reject(new Error(`Failed to load VoiceSDK from ${url}`));
    };
    document.head.appendChild(script);
  });

  loadCache.set(url, promise);
  return promise;
}

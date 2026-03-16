import crypto from 'crypto';
import type { InternalTool } from './providers/types.js';
import type { Session, TrackedSession } from './types.js';
import { CACHE_TTL, provider } from './config.js';
import { logSessionEvent } from './state.js';

export function hashForCaching(systemInstruction: string, tools: InternalTool[]): string {
  const payload = systemInstruction + JSON.stringify(tools);
  return crypto.createHash('md5').update(payload).digest('hex');
}

export function estimateCacheableTokens(systemInstruction: string, tools: InternalTool[]): number {
  const chars = systemInstruction.length + JSON.stringify(tools).length;
  return Math.ceil(chars / 4);
}

export async function createOrUpdateProviderCache(session: Session, tracked: TrackedSession): Promise<void> {
  if (!provider.supportsCaching || !provider.createCache) return;

  const hash = hashForCaching(session.systemInstruction, session.tools);

  // Cache already matches — nothing to do
  if (session.cachedContentHash === hash && session.cachedContentName) return;

  const estimatedTokens = estimateCacheableTokens(session.systemInstruction, session.tools);

  if (estimatedTokens < provider.cacheMinTokens) {
    session.cacheEligible = false;
    // Clean up stale cache if we dropped below threshold (e.g. context got smaller)
    if (session.cachedContentName) {
      await cleanupProviderCache(session);
    }
    return;
  }

  // Clean up old cache before creating new one
  if (session.cachedContentName) {
    await cleanupProviderCache(session);
  }

  try {
    const cache = await provider.createCache({
      systemInstruction: session.systemInstruction,
      tools: session.tools,
      ttl: CACHE_TTL,
    });

    session.cachedContentName = cache.name || null;
    session.cachedContentHash = hash;
    session.cacheEligible = true;

    logSessionEvent(tracked, 'cache.created', {
      cacheName: session.cachedContentName,
      estimatedTokens,
    });
  } catch (err: any) {
    console.warn('[voxglide] Cache creation failed:', err.message);
    logSessionEvent(tracked, 'cache.error', { message: err.message });
    session.cachedContentName = null;
    session.cachedContentHash = null;
    session.cacheEligible = false;
  }
}

export async function cleanupProviderCache(session: Session): Promise<void> {
  if (!session.cachedContentName) return;
  const name = session.cachedContentName;
  session.cachedContentName = null;
  session.cachedContentHash = null;
  if (provider.deleteCache) {
    try {
      await provider.deleteCache(name);
    } catch {
      // Fire-and-forget: cache may already be expired
    }
  }
}

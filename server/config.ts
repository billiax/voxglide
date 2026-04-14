import { createProvider } from './providers/factory.js';
import type { LLMProvider } from './providers/types.js';

export const PORT = parseInt(process.env.PORT || '3100', 10);
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

export const provider: LLMProvider = createProvider();

export const SUMMARIZATION_THRESHOLD = 25_000;
export const KEEP_RECENT_TURNS = 6;
export const SESSION_CLEANUP_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_TOOL_DEPTH = 10;
export const MAX_HISTORY_ENTRIES = 200;
export const MAX_LLM_CONTEXT_ENTRIES = 20; // Max history entries sent to LLM per call
export const CACHE_TTL = '600s'; // 10 min
export const TURN_SETTLING_MS = 500; // Delay before processing a new turn to allow text merging

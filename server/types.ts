import type { WebSocket } from 'ws';
import type { InternalContent, InternalTool } from './providers/types.js';

export interface SessionEvent {
  type: string;
  timestamp: number;
  data: any;
  seq: number;
}

export interface Session {
  history: InternalContent[];
  systemInstruction: string;
  pageContext: string;
  tools: InternalTool[];
  lastPromptTokenCount: number;
  lastOutputTokenCount: number;
  conversationSummary: string | null;
  cachedContentName: string | null;
  cachedContentHash: string | null;
  cacheEligible: boolean | null;
}

export interface PendingToolTurn {
  resolve: (results: any[]) => void;
  reject: (error: Error) => void;
  results: any[];
  expectedCount: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

export interface QueuedTurn {
  turnId: string;
  text: string;
  historyIndex: number;  // index into session.history for the user message
  status: 'queued' | 'processing' | 'executing-tools';
  abortController: AbortController | null;
}

export interface TrackedSession {
  session: Session | null;
  id: string;
  pageUrl: string;
  connectedAt: number;
  disconnectedAt: number | null;
  events: SessionEvent[];
  messageCount: number;
  disconnected: boolean;
  clientWs: WebSocket | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  pendingToolResultsByTurn: Map<string, PendingToolTurn>;
  turnQueue: QueuedTurn[];
  turnProcessing: boolean;
  activeTurn: QueuedTurn | null;
  lastScanData: any | null;
  screenshots: Map<string, string>; // url -> base64 image (latest per URL)
}

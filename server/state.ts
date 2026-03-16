import { WebSocket } from 'ws';
import crypto from 'crypto';
import type { TrackedSession, SessionEvent, PendingToolTurn } from './types.js';
import { provider } from './config.js';
import { sendToClient } from './utils.js';

// ── Session & Admin State ──

export const trackedSessions = new Map<string, TrackedSession>();
export const wsToSessionId = new Map<WebSocket, string>();
export const adminClients = new Set<WebSocket>();

export function generateSessionId(): string {
  return crypto.randomUUID();
}

export function getTrackedByWs(ws: WebSocket): TrackedSession | null {
  const sessionId = wsToSessionId.get(ws);
  return sessionId ? trackedSessions.get(sessionId) || null : null;
}

export function logSessionEvent(tracked: TrackedSession, type: string, data: any): void {
  const event: SessionEvent = { type, timestamp: Date.now(), data, seq: tracked.events.length };
  tracked.events.push(event);
  broadcastToAdmins({
    type: 'session.event',
    sessionId: tracked.id,
    event,
  });
}

export function broadcastToAdmins(data: any): void {
  const msg = JSON.stringify(data);
  for (const admin of adminClients) {
    if (admin.readyState === WebSocket.OPEN) {
      admin.send(msg);
    }
  }
}

export function getSessionSummary(tracked: TrackedSession) {
  return {
    id: tracked.id,
    pageUrl: tracked.pageUrl,
    connectedAt: tracked.connectedAt,
    messageCount: tracked.messageCount,
    disconnected: tracked.disconnected,
    lastScanData: tracked.lastScanData,
    screenshots: Object.fromEntries(tracked.screenshots),
    provider: provider.name,
    model: provider.model,
  };
}

// ── Queue State Broadcasting ──

export function broadcastQueueState(tracked: TrackedSession): void {
  const active = tracked.activeTurn ? {
    turnId: tracked.activeTurn.turnId,
    text: tracked.activeTurn.text,
    status: tracked.activeTurn.status,
  } : null;
  const queued = tracked.turnQueue
    .filter(t => t.status === 'queued')
    .map(t => ({ turnId: t.turnId, text: t.text, status: t.status }));

  // Notify SDK client
  if (tracked.clientWs) {
    sendToClient(tracked.clientWs, { type: 'queue.update', active, queued });
  }
  // Notify admin clients
  broadcastToAdmins({
    type: 'session.queue',
    sessionId: tracked.id,
    active,
    queued,
  });
}

// ── Pending Tool Results Management ──

export function rejectAllPendingToolResults(tracked: TrackedSession, reason: string): void {
  for (const [turnId, pending] of tracked.pendingToolResultsByTurn) {
    clearTimeout(pending.timeoutId);
    pending.reject(new Error(reason));
  }
  tracked.pendingToolResultsByTurn.clear();
}

// ── Helper: create waitForToolResults for a tracked session (turn-scoped) ──

export function waitForToolResults(tracked: TrackedSession, expectedCount: number, turnId: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (tracked.pendingToolResultsByTurn.has(turnId)) {
        tracked.pendingToolResultsByTurn.delete(turnId);
        reject(new Error('Tool result timeout'));
      }
    }, 30000);

    tracked.pendingToolResultsByTurn.set(turnId, {
      resolve,
      reject,
      results: [],
      expectedCount,
      timeoutId,
    });
  });
}

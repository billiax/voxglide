import { WebSocket } from 'ws';
import crypto from 'crypto';
import type { TrackedSession } from './types.js';
import { MAX_HISTORY_ENTRIES, KEEP_RECENT_TURNS, SESSION_CLEANUP_MS, TURN_SETTLING_MS, provider } from './config.js';
import {
  trackedSessions, wsToSessionId, generateSessionId, getTrackedByWs,
  logSessionEvent, broadcastToAdmins, getSessionSummary, broadcastQueueState,
  rejectAllPendingToolResults,
} from './state.js';
import { processTurnQueue } from './turn-queue.js';
import { cleanupProviderCache } from './caching.js';
import { sendToClient } from './utils.js';

// ── SDK Message Handlers ──

export function handleSessionStart(clientWs: WebSocket, msg: any): void {
  const requestedId = msg.sessionId;

  // ── Reconnection path ──
  if (requestedId && trackedSessions.has(requestedId)) {
    const existing = trackedSessions.get(requestedId)!;

    // Remove old WS listeners to prevent stale onclose from wiping active session
    const oldWs = existing.clientWs;
    if (oldWs) {
      oldWs.removeAllListeners();
      if (oldWs.readyState === WebSocket.OPEN || oldWs.readyState === WebSocket.CONNECTING) {
        oldWs.close(4000, 'Session reconnected from another client');
      }
      wsToSessionId.delete(oldWs);
    }

    // Cancel cleanup timer
    if (existing.cleanupTimer) {
      clearTimeout(existing.cleanupTimer);
      existing.cleanupTimer = null;
    }

    // Abort in-flight streaming
    existing.activeTurn?.abortController?.abort();
    existing.activeTurn = null;

    // Reject pending tool promises
    rejectAllPendingToolResults(existing, 'Client reconnected');

    // Clear stale turn queue and settling timer
    if (existing.settlingTimer) {
      clearTimeout(existing.settlingTimer);
      existing.settlingTimer = null;
    }
    existing.turnQueue.length = 0;
    existing.turnProcessing = false;

    // Swap clientWs and update reverse map
    existing.clientWs = clientWs;
    existing.disconnected = false;
    existing.disconnectedAt = null;
    wsToSessionId.set(clientWs, existing.id);

    // Update session config if provided (page may have changed)
    if (existing.session) {
      if (msg.config?.systemInstruction) {
        existing.session.systemInstruction = msg.config.systemInstruction;
      }
      if (msg.config?.pageContext !== undefined) {
        existing.session.pageContext = msg.config.pageContext;
      }
      if (msg.config?.tools) {
        existing.session.tools = msg.config.tools;
      }
    }

    // Update page URL
    if (msg.config?.pageUrl) {
      existing.pageUrl = msg.config.pageUrl;
    }

    logSessionEvent(existing, 'session.resumed', {
      previousSessionId: requestedId,
      pageUrl: existing.pageUrl,
    });

    sendToClient(clientWs, {
      type: 'session.started',
      sessionId: requestedId,
      resumed: true,
    });

    broadcastToAdmins({
      type: 'session.update',
      session: getSessionSummary(existing),
    });

    return;
  }

  // ── New session path ──
  const sessionId = generateSessionId();
  const tracked: TrackedSession = {
    session: {
      history: [],
      systemInstruction: msg.config?.systemInstruction || '',
      pageContext: msg.config?.pageContext || '',
      tools: msg.config?.tools || [],
      lastPromptTokenCount: 0,
      lastOutputTokenCount: 0,
      conversationSummary: null,
      cachedContentName: null,
      cachedContentHash: null,
      cacheEligible: null,
    },
    id: sessionId,
    pageUrl: msg.config?.pageUrl || '',
    connectedAt: Date.now(),
    disconnectedAt: null,
    events: [],
    messageCount: 0,
    disconnected: false,
    clientWs: clientWs,
    cleanupTimer: null,
    pendingToolResultsByTurn: new Map(),
    turnQueue: [],
    turnProcessing: false,
    activeTurn: null,
    settlingTimer: null,
    lastScanData: null,
    screenshots: new Map(),
  };

  trackedSessions.set(sessionId, tracked);
  wsToSessionId.set(clientWs, sessionId);

  // Notify admins of new session
  broadcastToAdmins({
    type: 'session.new',
    session: getSessionSummary(tracked),
  });

  logSessionEvent(tracked, 'session.start', {
    systemInstruction: tracked.session!.systemInstruction || '',
    toolCount: tracked.session!.tools.length,
    pageUrl: tracked.pageUrl,
    provider: provider.name,
    model: provider.model,
  });

  sendToClient(clientWs, { type: 'session.started', sessionId: tracked.id });

  // Update admins with potentially new pageUrl
  broadcastToAdmins({
    type: 'session.update',
    session: getSessionSummary(tracked),
  });

  console.log(`[voxglide] Client connected: ${sessionId} (active: ${trackedSessions.size})`);
}

export function handleText(tracked: TrackedSession, msg: any): void {
  if (!tracked.session) {
    sendToClient(tracked.clientWs!, { type: 'error', message: 'No active session. Send session.start first.' });
    return;
  }
  const userText = msg.text;
  if (!userText) return;

  tracked.messageCount++;

  // Emergency history cap
  if (tracked.session.history.length > MAX_HISTORY_ENTRIES) {
    const kept = tracked.session.history.slice(-KEEP_RECENT_TURNS);
    tracked.session.history.length = 0;
    tracked.session.history.push(...kept);
  }

  // Merge into last queued turn if it hasn't started processing yet
  const lastQueued = tracked.turnQueue[tracked.turnQueue.length - 1];
  if (lastQueued && lastQueued.status === 'queued') {
    // Merge: append text to existing history entry and queued turn
    const historyEntry = tracked.session.history[lastQueued.historyIndex];
    if (historyEntry && historyEntry.parts?.[0]) {
      (historyEntry.parts[0] as any).text += ' ' + userText;
    }
    lastQueued.text += ' ' + userText;
    logSessionEvent(tracked, 'text.merged', { text: userText, turnId: lastQueued.turnId, mergedText: lastQueued.text });
    broadcastQueueState(tracked);
    return;
  }

  // New turn: push user message to history, create QueuedTurn
  tracked.session.history.push({ role: 'user', parts: [{ text: userText }] });
  const historyIndex = tracked.session.history.length - 1;
  const turnId = crypto.randomUUID();

  const queuedTurn = {
    turnId,
    text: userText,
    historyIndex,
    status: 'queued' as const,
    abortController: null,
  };

  tracked.turnQueue.push(queuedTurn);
  logSessionEvent(tracked, 'text', { text: userText, turnId });
  broadcastQueueState(tracked);

  if (!tracked.turnProcessing) {
    // Settling delay: wait before processing to widen the text-merge window.
    // Speech may arrive as multiple WS messages in quick succession; this delay
    // lets late-arriving fragments merge into the queued turn instead of racing
    // against LLM processing. The merge logic above handles the actual merge.
    if (tracked.settlingTimer) clearTimeout(tracked.settlingTimer);
    tracked.settlingTimer = setTimeout(() => {
      tracked.settlingTimer = null;
      if (!tracked.turnProcessing && tracked.turnQueue.length > 0) {
        processTurnQueue(tracked);
      }
    }, TURN_SETTLING_MS);
  }
}

export function handleToolResult(tracked: TrackedSession, msg: any): void {
  const responses = msg.functionResponses || [];
  logSessionEvent(tracked, 'toolResult', { responses, turnId: msg.turnId });

  if (!msg.turnId) {
    console.warn('[voxglide] Tool result without turnId, ignoring');
    logSessionEvent(tracked, 'warning', { message: 'Tool result without turnId' });
    return;
  }

  const pending = tracked.pendingToolResultsByTurn.get(msg.turnId);
  if (pending) {
    pending.results.push(...responses);
    if (pending.results.length >= pending.expectedCount) {
      clearTimeout(pending.timeoutId);
      pending.resolve(pending.results);
      tracked.pendingToolResultsByTurn.delete(msg.turnId);
    }
  }
}

export function handleToolProgress(tracked: TrackedSession, msg: any): void {
  logSessionEvent(tracked, 'tool.progress', {
    toolName: msg.toolName,
    status: msg.status,
    callId: msg.callId,
  });
}

export function handleScan(tracked: TrackedSession, msg: any): void {
  const scanData = msg.data || {};
  tracked.lastScanData = scanData;

  // Update pageUrl from scan data (tracks current page after SPA navigation)
  if (scanData.url && scanData.url !== tracked.pageUrl) {
    tracked.pageUrl = scanData.url;
    broadcastToAdmins({
      type: 'session.update',
      session: getSessionSummary(tracked),
    });
  }

  logSessionEvent(tracked, 'scan', scanData);
}

export function handleContextUpdate(tracked: TrackedSession, msg: any): void {
  if (!tracked.session) {
    sendToClient(tracked.clientWs!, { type: 'error', message: 'No active session. Send session.start first.' });
    logSessionEvent(tracked, 'error', { message: 'context.update sent without active session' });
    return;
  }
  // Page context updates are dynamic — stored separately, don't invalidate cache
  const newContext = msg.context;
  if (newContext !== undefined) {
    tracked.session.pageContext = newContext;
  }
  if (msg.tools) {
    tracked.session.tools = msg.tools;
    // Only tool changes invalidate cache (tools are part of cached content)
    tracked.session.cachedContentHash = null;
  }
  logSessionEvent(tracked, 'context.update', {
    pageContextLength: tracked.session.pageContext.length,
    toolsChanged: !!msg.tools,
    ...(msg.data || {}),
  });
  sendToClient(tracked.clientWs!, { type: 'context.updated' });
}

export function handleSessionStop(tracked: TrackedSession): void {
  if (tracked.session) {
    cleanupProviderCache(tracked.session);
  }
  tracked.session = null;
  logSessionEvent(tracked, 'session.stop', {});
  sendToClient(tracked.clientWs!, { type: 'session.stopped' });
}

export function handleWsClose(clientWs: WebSocket): void {
  const tracked = getTrackedByWs(clientWs);
  wsToSessionId.delete(clientWs);

  if (!tracked) return;  // WS was superseded by reconnection
  if (tracked.clientWs !== clientWs) return;  // Stale close event, ignore

  tracked.disconnected = true;
  tracked.disconnectedAt = Date.now();
  tracked.clientWs = null;
  tracked.activeTurn?.abortController?.abort();  // Cancel streaming
  tracked.activeTurn = null;
  rejectAllPendingToolResults(tracked, 'Client disconnected');  // Unblock promises
  if (tracked.settlingTimer) {
    clearTimeout(tracked.settlingTimer);
    tracked.settlingTimer = null;
  }
  tracked.turnQueue.length = 0;
  tracked.turnProcessing = false;

  logSessionEvent(tracked, 'session.disconnected', { reason: 'disconnected' });
  broadcastToAdmins({ type: 'session.disconnected', sessionId: tracked.id });
  console.log(`[voxglide] Client disconnected: ${tracked.id} (active: ${Array.from(trackedSessions.values()).filter(s => !s.disconnected).length})`);

  // Clean up after 30 minutes if not reconnected
  tracked.cleanupTimer = setTimeout(() => {
    if (tracked.session) {
      cleanupProviderCache(tracked.session);
    }
    trackedSessions.delete(tracked.id);
    wsToSessionId.delete(clientWs); // safety cleanup
  }, SESSION_CLEANUP_MS);
}

export function handleScreenshot(tracked: TrackedSession, msg: any): void {
  // Auto or on-demand screenshot from SDK client
  const url = msg.url || tracked.lastScanData?.url || tracked.pageUrl || '';
  if (msg.image) {
    // Keep latest per URL, cap at 20 entries
    tracked.screenshots.set(url, msg.image);
    if (tracked.screenshots.size > 20) {
      const firstKey = tracked.screenshots.keys().next().value!;
      tracked.screenshots.delete(firstKey);
    }
  }
  broadcastToAdmins({
    type: 'session.screenshot',
    sessionId: tracked.id,
    url,
    image: msg.image,
    requestId: msg.requestId,
  });
}

export function handleScreenshotError(tracked: TrackedSession, msg: any): void {
  broadcastToAdmins({ ...msg, sessionId: tracked.id });
}

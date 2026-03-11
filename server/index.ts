import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import type { Content, Tool, GenerateContentConfig } from '@google/genai';
import crypto from 'crypto';

// ── Config ──

const PORT = parseInt(process.env.PORT || '3100', 10);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

if (!GEMINI_API_KEY) {
  console.error('[voxglide] GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ── Constants ──

const SUMMARIZATION_THRESHOLD = 100_000;
const KEEP_RECENT_TURNS = 6;
const SESSION_CLEANUP_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TOOL_DEPTH = 10;
const MAX_HISTORY_ENTRIES = 200;

// ── Types ──

interface SessionEvent {
  type: string;
  timestamp: number;
  data: any;
}

interface Session {
  history: Content[];
  systemInstruction: string;
  tools: Tool[];
  lastPromptTokenCount: number;
  lastOutputTokenCount: number;
  conversationSummary: string | null;
}

interface PendingToolTurn {
  resolve: (results: any[]) => void;
  reject: (error: Error) => void;
  results: any[];
  expectedCount: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface TrackedSession {
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
  turnQueue: Array<() => Promise<void>>;
  turnProcessing: boolean;
  abortController: AbortController | null;
  lastScanData: any | null;
  screenshots: Map<string, string>; // url -> base64 image (latest per URL)
}

// ── Session & Admin State ──

const trackedSessions = new Map<string, TrackedSession>();
const wsToSessionId = new Map<WebSocket, string>();
const adminClients = new Set<WebSocket>();

function generateSessionId(): string {
  return crypto.randomUUID();
}

function getTrackedByWs(ws: WebSocket): TrackedSession | null {
  const sessionId = wsToSessionId.get(ws);
  return sessionId ? trackedSessions.get(sessionId) || null : null;
}

function logSessionEvent(tracked: TrackedSession, type: string, data: any): void {
  const event: SessionEvent = { type, timestamp: Date.now(), data };
  tracked.events.push(event);
  broadcastToAdmins({
    type: 'session.event',
    sessionId: tracked.id,
    event,
  });
}

function broadcastToAdmins(data: any): void {
  const msg = JSON.stringify(data);
  for (const admin of adminClients) {
    if (admin.readyState === WebSocket.OPEN) {
      admin.send(msg);
    }
  }
}

function getSessionSummary(tracked: TrackedSession) {
  return {
    id: tracked.id,
    pageUrl: tracked.pageUrl,
    connectedAt: tracked.connectedAt,
    messageCount: tracked.messageCount,
    disconnected: tracked.disconnected,
    lastScanData: tracked.lastScanData,
    screenshots: Object.fromEntries(tracked.screenshots),
  };
}

// ── Pending Tool Results Management ──

function rejectAllPendingToolResults(tracked: TrackedSession, reason: string): void {
  for (const [turnId, pending] of tracked.pendingToolResultsByTurn) {
    clearTimeout(pending.timeoutId);
    pending.reject(new Error(reason));
  }
  tracked.pendingToolResultsByTurn.clear();
}

// ── History Management ──

function estimateTokens(history: Content[]): number {
  let chars = 0;
  for (const entry of history) {
    for (const part of entry.parts || []) {
      if ((part as any).text) chars += (part as any).text.length;
      else chars += JSON.stringify(part).length;
    }
  }
  return Math.ceil(chars / 4);
}

async function maybeSummarizeHistory(session: Session, tracked: TrackedSession): Promise<void> {
  // Estimate next prompt tokens
  let estimatedTokens = session.lastPromptTokenCount + session.lastOutputTokenCount;
  if (estimatedTokens === 0) {
    estimatedTokens = estimateTokens(session.history);
  }

  if (estimatedTokens < SUMMARIZATION_THRESHOLD || session.history.length <= KEEP_RECENT_TURNS) {
    return;
  }

  // Split history into old (to summarize) and recent (to keep)
  const splitPoint = session.history.length - KEEP_RECENT_TURNS;
  const oldHistory = session.history.slice(0, splitPoint);
  const recentHistory = session.history.slice(splitPoint);

  try {
    // Generate summary using a non-streaming call
    const summaryPrompt = `Summarize the following conversation concisely, preserving key facts, user preferences, and any pending context:\n\n${oldHistory.map(h => `${h.role}: ${(h.parts || []).map((p: any) => p.text || JSON.stringify(p)).join(' ')}`).join('\n')}`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
      config: {
        systemInstruction: 'You are a conversation summarizer. Produce a concise summary that preserves all important context.',
      },
    });

    const summaryText = response.candidates?.[0]?.content?.parts
      ?.filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join('') || '';

    if (summaryText) {
      session.conversationSummary = summaryText;

      const summaryEntry: Content = { role: 'user', parts: [{ text: `[Previous conversation summary]: ${summaryText}` }] };
      const ackEntry: Content = { role: 'model', parts: [{ text: 'Understood, I have the context from our previous conversation.' }] };

      session.history.length = 0;
      session.history.push(summaryEntry, ackEntry, ...recentHistory);

      logSessionEvent(tracked, 'history.summarized', {
        oldTurns: oldHistory.length,
        keptTurns: recentHistory.length,
        summaryLength: summaryText.length,
      });
    }
  } catch (err: any) {
    console.error('[voxglide] History summarization failed:', err.message);
    logSessionEvent(tracked, 'error', { message: `History summarization failed: ${err.message}` });

    // Fallback: truncate to last KEEP_RECENT_TURNS entries to prevent oversized history
    if (session.history.length > KEEP_RECENT_TURNS * 2) {
      const kept = session.history.slice(-KEEP_RECENT_TURNS);
      session.history.length = 0;
      session.history.push(...kept);
    }
  }
}

// ── HTTP server ──

// Static file serving for SDK dist
const distDir = path.resolve(import.meta.dirname || __dirname, '..', 'dist');
const adminDir = path.resolve(import.meta.dirname || __dirname, 'admin');

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
  setCorsHeaders(res, req.headers.origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', sessions: trackedSessions.size }));
    return;
  }

  // Serve admin dashboard at /admin and /admin/*
  if (req.url === '/admin') {
    try {
      const html = fs.readFileSync(path.join(adminDir, 'index.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Admin page not found');
    }
    return;
  }

  if (req.url?.startsWith('/admin/')) {
    const relPath = req.url.slice('/admin/'.length);
    const filePath = path.join(adminDir, relPath);
    const ext = path.extname(filePath);

    // Prevent directory traversal and check MIME type
    if (!filePath.startsWith(adminDir) || !MIME_TYPES[ext]) {
      res.writeHead(404);
      res.end();
      return;
    }

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  // Serve SDK files from /sdk/ (no-cache so dev rebuilds are always picked up)
  if (req.url?.startsWith('/sdk/')) {
    const fileName = path.basename(req.url);
    const filePath = path.join(distDir, fileName);
    const ext = path.extname(fileName);

    // Prevent directory traversal
    if (!filePath.startsWith(distDir) || !MIME_TYPES[ext]) {
      res.writeHead(404);
      res.end();
      return;
    }

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext],
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  res.writeHead(404);
  res.end();
};

const httpServer = http.createServer(requestHandler);

// ── WebSocket servers ──

// SDK clients WebSocket server (no auto-attach to httpServer)
const sdkWss = new WebSocketServer({ noServer: true });
// Admin clients WebSocket server
const adminWss = new WebSocketServer({ noServer: true });

// Route upgrade requests based on path
httpServer.on('upgrade', (req, socket, head) => {
  const pathname = req.url || '/';

  if (pathname === '/admin') {
    adminWss.handleUpgrade(req, socket, head, (ws) => {
      adminWss.emit('connection', ws, req);
    });
  } else {
    sdkWss.handleUpgrade(req, socket, head, (ws) => {
      sdkWss.emit('connection', ws, req);
    });
  }
});

// ── Admin WebSocket handling ──

adminWss.on('connection', (adminWs) => {
  console.log('[voxglide] Admin client connected');
  adminClients.add(adminWs);

  // Send current sessions list
  const sessions = Array.from(trackedSessions.values()).map(getSessionSummary);
  sendToClient(adminWs, { type: 'sessions.list', sessions });

  // Send full event history for all active sessions
  for (const tracked of trackedSessions.values()) {
    for (const event of tracked.events) {
      sendToClient(adminWs, {
        type: 'session.event',
        sessionId: tracked.id,
        event,
      });
    }
  }

  adminWs.on('message', async (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'screenshot.request') {
      const sessionId = msg.sessionId;
      if (!sessionId) {
        sendToClient(adminWs, { type: 'screenshot.error', error: 'No sessionId provided', requestId: msg.requestId });
        return;
      }
      const tracked = trackedSessions.get(sessionId);
      if (!tracked || !tracked.clientWs || tracked.clientWs.readyState !== WebSocket.OPEN) {
        sendToClient(adminWs, { type: 'screenshot.error', error: 'Session not connected', requestId: msg.requestId });
        return;
      }
      // Forward request to SDK client
      sendToClient(tracked.clientWs, { type: 'screenshot.request', requestId: msg.requestId });
    }
  });

  adminWs.on('close', () => {
    console.log('[voxglide] Admin client disconnected');
    adminClients.delete(adminWs);
  });

  adminWs.on('error', () => {
    adminClients.delete(adminWs);
  });
});

// ── SDK Message Handlers ──

function handleSessionStart(clientWs: WebSocket, msg: any): void {
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
    existing.abortController?.abort();
    existing.abortController = null;

    // Reject pending tool promises
    rejectAllPendingToolResults(existing, 'Client reconnected');

    // Clear stale turn queue
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
      tools: msg.config?.tools || [],
      lastPromptTokenCount: 0,
      lastOutputTokenCount: 0,
      conversationSummary: null,
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
    abortController: null,
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
  });

  sendToClient(clientWs, { type: 'session.started', sessionId: tracked.id });

  // Update admins with potentially new pageUrl
  broadcastToAdmins({
    type: 'session.update',
    session: getSessionSummary(tracked),
  });

  console.log(`[voxglide] Client connected: ${sessionId} (active: ${trackedSessions.size})`);
}

function handleText(tracked: TrackedSession, msg: any): void {
  if (!tracked.session) {
    sendToClient(tracked.clientWs!, { type: 'error', message: 'No active session. Send session.start first.' });
    return;
  }
  const userText = msg.text;
  if (!userText) return;

  tracked.messageCount++;
  logSessionEvent(tracked, 'text', { text: userText });

  // Emergency history cap
  if (tracked.session.history.length > MAX_HISTORY_ENTRIES) {
    const kept = tracked.session.history.slice(-KEEP_RECENT_TURNS);
    tracked.session.history.length = 0;
    tracked.session.history.push(...kept);
  }

  tracked.session.history.push({ role: 'user', parts: [{ text: userText }] });

  enqueueTurn(tracked, async () => {
    const turnId = crypto.randomUUID();
    const abortController = new AbortController();
    tracked.abortController = abortController;
    try {
      await maybeSummarizeHistory(tracked.session!, tracked);
      await handleTurnStreaming(tracked, turnId, abortController.signal);
    } catch (err: any) {
      if (!abortController.signal.aborted) {
        sendToClient(tracked.clientWs!, { type: 'error', message: err.message });
        logSessionEvent(tracked, 'error', { message: err.message });
      }
    } finally {
      if (tracked.abortController === abortController) {
        tracked.abortController = null;
      }
    }
  });
}

function handleToolResult(tracked: TrackedSession, msg: any): void {
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

function handleToolProgress(tracked: TrackedSession, msg: any): void {
  logSessionEvent(tracked, 'tool.progress', {
    toolName: msg.toolName,
    status: msg.status,
    callId: msg.callId,
  });
}

function handleScan(tracked: TrackedSession, msg: any): void {
  const scanData = msg.data || {};
  tracked.lastScanData = scanData;
  logSessionEvent(tracked, 'scan', scanData);
}

function handleContextUpdate(tracked: TrackedSession, msg: any): void {
  if (!tracked.session) {
    sendToClient(tracked.clientWs!, { type: 'error', message: 'No active session. Send session.start first.' });
    logSessionEvent(tracked, 'error', { message: 'context.update sent without active session' });
    return;
  }
  const newContext = msg.context || msg.systemInstruction;
  if (newContext) {
    tracked.session.systemInstruction = newContext;
  }
  logSessionEvent(tracked, 'context.update', {
    systemInstruction: newContext || '',
    ...(msg.data || {}),
  });
  sendToClient(tracked.clientWs!, { type: 'context.updated' });
}

function handleSessionStop(tracked: TrackedSession): void {
  tracked.session = null;
  logSessionEvent(tracked, 'session.stop', {});
  sendToClient(tracked.clientWs!, { type: 'session.stopped' });
}

function handleWsClose(clientWs: WebSocket): void {
  const tracked = getTrackedByWs(clientWs);
  wsToSessionId.delete(clientWs);

  if (!tracked) return;  // WS was superseded by reconnection
  if (tracked.clientWs !== clientWs) return;  // Stale close event, ignore

  tracked.disconnected = true;
  tracked.disconnectedAt = Date.now();
  tracked.clientWs = null;
  tracked.abortController?.abort();  // Cancel streaming
  rejectAllPendingToolResults(tracked, 'Client disconnected');  // Unblock promises
  tracked.turnQueue.length = 0;
  tracked.turnProcessing = false;

  logSessionEvent(tracked, 'session.disconnected', { reason: 'disconnected' });
  broadcastToAdmins({ type: 'session.disconnected', sessionId: tracked.id });
  console.log(`[voxglide] Client disconnected: ${tracked.id} (active: ${Array.from(trackedSessions.values()).filter(s => !s.disconnected).length})`);

  // Clean up after 30 minutes if not reconnected
  tracked.cleanupTimer = setTimeout(() => {
    trackedSessions.delete(tracked.id);
    wsToSessionId.delete(clientWs); // safety cleanup
  }, SESSION_CLEANUP_MS);
}

// ── SDK WebSocket handling ──

sdkWss.on('connection', (clientWs, req) => {
  const origin = req.headers.origin || '';
  if (!isOriginAllowed(origin)) {
    console.log(`[voxglide] Rejected connection from origin: ${origin}`);
    clientWs.close(4003, 'Origin not allowed');
    return;
  }

  clientWs.on('message', async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendToClient(clientWs, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    if (msg.type === 'session.start') { handleSessionStart(clientWs, msg); return; }

    const tracked = getTrackedByWs(clientWs);
    if (!tracked) { sendToClient(clientWs, { type: 'error', message: 'No active session' }); return; }

    switch (msg.type) {
      case 'text': handleText(tracked, msg); break;
      case 'toolResult': handleToolResult(tracked, msg); break;
      case 'tool.progress': handleToolProgress(tracked, msg); break;
      case 'scan': handleScan(tracked, msg); break;
      case 'context.update': handleContextUpdate(tracked, msg); break;
      case 'session.stop': handleSessionStop(tracked); break;
      case 'screenshot': {
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
        break;
      }
      case 'screenshot.error':
        broadcastToAdmins({ ...msg, sessionId: tracked.id });
        break;
      default: sendToClient(clientWs, { type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  });

  clientWs.on('close', () => handleWsClose(clientWs));

  clientWs.on('error', (err) => {
    console.error('[voxglide] Client WebSocket error:', err.message);
    const tracked = getTrackedByWs(clientWs);
    if (tracked) logSessionEvent(tracked, 'error', { message: err.message });
  });
});

// ── Turn Queue: serial execution of LLM turns per session ──

function enqueueTurn(tracked: TrackedSession, fn: () => Promise<void>): void {
  tracked.turnQueue.push(fn);
  if (!tracked.turnProcessing) {
    processTurnQueue(tracked);
  }
}

async function processTurnQueue(tracked: TrackedSession): Promise<void> {
  tracked.turnProcessing = true;
  while (tracked.turnQueue.length > 0) {
    const fn = tracked.turnQueue.shift()!;
    try {
      await fn();
    } catch (err: any) {
      console.error('[voxglide] Turn queue error:', err.message);
      logSessionEvent(tracked, 'error', { message: `Turn queue error: ${err.message}` });
    }
  }
  tracked.turnProcessing = false;
}

// ── Helper: create waitForToolResults for a tracked session (turn-scoped) ──

function waitForToolResults(tracked: TrackedSession, expectedCount: number, turnId: string): Promise<any[]> {
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

// ── Streaming Gemini turn handling ──

async function handleTurnStreaming(
  tracked: TrackedSession,
  turnId: string,
  signal: AbortSignal,
  depth = 0,
): Promise<void> {
  if (depth >= MAX_TOOL_DEPTH) {
    sendToClient(tracked.clientWs!, { type: 'error', message: 'Maximum tool call depth exceeded' });
    logSessionEvent(tracked, 'error', { message: 'Maximum tool call depth exceeded', depth });
    return;
  }

  if (signal.aborted) return;

  const session = tracked.session;
  if (!session) return;

  const config: GenerateContentConfig = {
    systemInstruction: session.systemInstruction,
    tools: session.tools,
  };

  const stream = await ai.models.generateContentStream({
    model: GEMINI_MODEL,
    contents: session.history,
    config,
  });

  let accumulatedText = '';
  const functionCalls: any[] = [];
  const allParts: any[] = [];
  let usageMetadata: any = null;

  try {
    for await (const chunk of stream) {
      // Check abort signal
      if (signal.aborted) {
        if (allParts.length > 0) {
          tracked.session?.history.push({ role: 'model', parts: allParts });
        }
        return;
      }

      // Check client still connected — always use tracked.clientWs for current reference
      if (!tracked.clientWs || tracked.clientWs.readyState !== WebSocket.OPEN) {
        if (allParts.length > 0) {
          tracked.session?.history.push({ role: 'model', parts: allParts });
        }
        return;
      }

      if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;

      for (const part of chunk.candidates?.[0]?.content?.parts || []) {
        allParts.push(part);
        if (part.text) {
          accumulatedText += part.text;
          sendToClient(tracked.clientWs, { type: 'response.delta', text: part.text });
        }
        if (part.functionCall) {
          functionCalls.push(part);
        }
      }
    }
  } catch (err: any) {
    // Save partial history on stream error
    if (allParts.length > 0) {
      tracked.session?.history.push({ role: 'model', parts: allParts });
    }
    throw err;
  }

  // Send usage — always use tracked.clientWs for current reference
  if (usageMetadata && tracked.session) {
    tracked.session.lastPromptTokenCount = usageMetadata.promptTokenCount || 0;
    tracked.session.lastOutputTokenCount = usageMetadata.candidatesTokenCount || 0;
    if (tracked.clientWs) {
      sendToClient(tracked.clientWs, {
        type: 'usage',
        totalTokens: usageMetadata.totalTokenCount || 0,
        inputTokens: usageMetadata.promptTokenCount || 0,
        outputTokens: usageMetadata.candidatesTokenCount || 0,
      });
    }
  }

  if (functionCalls.length > 0) {
    tracked.session?.history.push({ role: 'model', parts: allParts });

    // Send tool calls to client and wait for results
    const fcs = functionCalls.map((p: any) => ({
      id: crypto.randomUUID(),
      name: p.functionCall.name,
      args: p.functionCall.args || {},
    }));

    if (tracked.clientWs) {
      sendToClient(tracked.clientWs, { type: 'toolCall', functionCalls: fcs, turnId });
    }
    logSessionEvent(tracked, 'toolCall', { functionCalls: fcs, turnId });

    // Wait for tool results from client
    const results = await waitForToolResults(tracked, fcs.length, turnId);

    // Check abort after waiting for tool results
    if (signal.aborted) return;

    // Add tool results to history
    const functionResponseParts = results.map((r: any) => ({
      functionResponse: {
        name: r.name,
        response: r.response,
      },
    }));
    tracked.session?.history.push({ role: 'user', parts: functionResponseParts });

    // Get the model's follow-up response with tool results (increment depth)
    await handleTurnStreaming(tracked, turnId, signal, depth + 1);
  } else {
    tracked.session?.history.push({ role: 'model', parts: allParts });

    // Send final response (backward compatible — old clients see type:'response')
    if (accumulatedText && tracked.clientWs) {
      sendToClient(tracked.clientWs, { type: 'response', text: accumulatedText });
      logSessionEvent(tracked, 'response', { text: accumulatedText });
    }
  }
}

// ── Helpers ──

function sendToClient(ws: WebSocket, data: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function isOriginAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes('*')) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

function setCorsHeaders(res: http.ServerResponse, origin?: string): void {
  const allowedOrigin = origin && isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Start ──

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[voxglide] Listening on ws://0.0.0.0:${PORT}`);
  console.log(`[voxglide] SDK: http://0.0.0.0:${PORT}/sdk/voice-sdk.iife.js`);
  console.log(`[voxglide] Admin: http://0.0.0.0:${PORT}/admin`);
  console.log(`[voxglide] Model: ${GEMINI_MODEL}`);
  console.log(`[voxglide] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});

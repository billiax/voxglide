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
  results: any[];
  expectedCount: number;
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
}

// ── Session & Admin State ──

const trackedSessions = new Map<string, TrackedSession>();
const adminClients = new Set<WebSocket>();

function generateSessionId(): string {
  return crypto.randomUUID();
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
  };
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
      session.history = [
        { role: 'user', parts: [{ text: `[Previous conversation summary]: ${summaryText}` }] },
        { role: 'model', parts: [{ text: 'Understood, I have the context from our previous conversation.' }] },
        ...recentHistory,
      ];

      logSessionEvent(tracked, 'history.summarized', {
        oldTurns: oldHistory.length,
        keptTurns: recentHistory.length,
        summaryLength: summaryText.length,
      });
    }
  } catch (err: any) {
    console.error('[voxglide] History summarization failed:', err.message);
    logSessionEvent(tracked, 'error', { message: `History summarization failed: ${err.message}` });
  }
}

// ── HTTP server ──

// Static file serving for SDK dist
const distDir = path.resolve(import.meta.dirname || __dirname, '..', 'dist');
const adminHtmlPath = path.resolve(import.meta.dirname || __dirname, 'admin.html');

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
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

  // Serve admin dashboard HTML at GET /admin
  if (req.url === '/admin') {
    try {
      const html = fs.readFileSync(adminHtmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Admin page not found');
    }
    return;
  }

  // Serve SDK files from /sdk/
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
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] });
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

  adminWs.on('close', () => {
    console.log('[voxglide] Admin client disconnected');
    adminClients.delete(adminWs);
  });

  adminWs.on('error', () => {
    adminClients.delete(adminWs);
  });
});

// ── SDK WebSocket handling ──

sdkWss.on('connection', (clientWs, req) => {
  const origin = req.headers.origin || '';
  if (!isOriginAllowed(origin)) {
    console.log(`[voxglide] Rejected connection from origin: ${origin}`);
    clientWs.close(4003, 'Origin not allowed');
    return;
  }

  const sessionId = generateSessionId();
  const tracked: TrackedSession = {
    session: null,
    id: sessionId,
    pageUrl: origin,
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
  };
  trackedSessions.set(sessionId, tracked);

  // Notify admins of new session
  broadcastToAdmins({
    type: 'session.new',
    session: getSessionSummary(tracked),
  });

  console.log(`[voxglide] Client connected: ${sessionId} (active: ${trackedSessions.size})`);

  clientWs.on('message', async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendToClient(clientWs, { type: 'error', message: 'Invalid JSON' });
      logSessionEvent(tracked, 'error', { message: 'Invalid JSON from client' });
      return;
    }

    switch (msg.type) {
      case 'session.start': {
        // Check for session reconnection
        const requestedId = msg.sessionId;
        if (requestedId && trackedSessions.has(requestedId) && requestedId !== sessionId) {
          const existingTracked = trackedSessions.get(requestedId)!;

          // Cancel cleanup timer
          if (existingTracked.cleanupTimer) {
            clearTimeout(existingTracked.cleanupTimer);
            existingTracked.cleanupTimer = null;
          }

          // Swap WebSocket
          existingTracked.clientWs = clientWs;
          existingTracked.disconnected = false;
          existingTracked.disconnectedAt = null;

          // Update system instruction and tools (page may have changed)
          if (existingTracked.session) {
            if (msg.config?.systemInstruction) {
              existingTracked.session.systemInstruction = msg.config.systemInstruction;
            }
            if (msg.config?.tools) {
              existingTracked.session.tools = msg.config.tools;
            }
          }

          // Delete the auto-generated new entry
          trackedSessions.delete(sessionId);

          // Update page URL
          if (msg.config?.pageUrl) {
            existingTracked.pageUrl = msg.config.pageUrl;
          }

          logSessionEvent(existingTracked, 'session.resumed', {
            previousSessionId: requestedId,
            pageUrl: existingTracked.pageUrl,
          });

          sendToClient(clientWs, {
            type: 'session.started',
            sessionId: requestedId,
            resumed: true,
          });

          broadcastToAdmins({
            type: 'session.update',
            session: getSessionSummary(existingTracked),
          });

          // Rebind message/close handlers to the existing tracked session
          // (by reassigning the 'tracked' variable would not work in closure,
          //  so we close the existing listener setup)
          // Note: Since we're inside the message handler already, future messages
          // on this WS will still route correctly because we look up by tracked reference.
          break;
        }

        // New session
        tracked.session = {
          history: [],
          systemInstruction: msg.config?.systemInstruction || '',
          tools: msg.config?.tools || [],
          lastPromptTokenCount: 0,
          lastOutputTokenCount: 0,
          conversationSummary: null,
        };
        // Extract page URL from config if available
        if (msg.config?.pageUrl) {
          tracked.pageUrl = msg.config.pageUrl;
        }
        logSessionEvent(tracked, 'session.start', {
          systemInstruction: tracked.session.systemInstruction || '',
          toolCount: tracked.session.tools.length,
          pageUrl: tracked.pageUrl,
        });
        sendToClient(clientWs, { type: 'session.started', sessionId: tracked.id });
        // Update admins with potentially new pageUrl
        broadcastToAdmins({
          type: 'session.update',
          session: getSessionSummary(tracked),
        });
        break;
      }

      case 'text': {
        // Find the correct tracked session for this ws
        const activeTracked = findTrackedByWs(clientWs) || tracked;
        if (!activeTracked.session) {
          sendToClient(clientWs, { type: 'error', message: 'No active session. Send session.start first.' });
          logSessionEvent(activeTracked, 'error', { message: 'Text sent without active session' });
          return;
        }

        const userText = msg.text;
        if (!userText) return;

        activeTracked.messageCount++;
        logSessionEvent(activeTracked, 'text', { text: userText });

        // Push to history immediately to preserve arrival order
        activeTracked.session.history.push({ role: 'user', parts: [{ text: userText }] });

        // Enqueue the LLM turn so concurrent messages are serialized
        const turnSession = activeTracked.session;
        enqueueTurn(activeTracked, async () => {
          const turnId = crypto.randomUUID();
          try {
            await maybeSummarizeHistory(turnSession, activeTracked);
            await handleTurnStreaming(turnSession, clientWs, activeTracked, turnId);
          } catch (err: any) {
            sendToClient(clientWs, { type: 'error', message: err.message });
            logSessionEvent(activeTracked, 'error', { message: err.message });
          }
        });
        break;
      }

      case 'toolResult': {
        const activeTracked = findTrackedByWs(clientWs) || tracked;
        const responses = msg.functionResponses || [];
        logSessionEvent(activeTracked, 'toolResult', { responses, turnId: msg.turnId });

        // Route by turnId, fallback to first pending entry for backward compat
        let pending: PendingToolTurn | undefined;
        if (msg.turnId && activeTracked.pendingToolResultsByTurn.has(msg.turnId)) {
          pending = activeTracked.pendingToolResultsByTurn.get(msg.turnId);
        } else if (activeTracked.pendingToolResultsByTurn.size > 0) {
          // Backward compat: old clients without turnId — use first pending entry
          const firstKey = activeTracked.pendingToolResultsByTurn.keys().next().value as string;
          pending = activeTracked.pendingToolResultsByTurn.get(firstKey);
          // Use the actual key for cleanup
          if (pending) msg.turnId = firstKey;
        }

        if (pending) {
          pending.results.push(...responses);
          if (pending.results.length >= pending.expectedCount) {
            pending.resolve(pending.results);
            activeTracked.pendingToolResultsByTurn.delete(msg.turnId);
          }
        }
        break;
      }

      case 'tool.progress': {
        const activeTracked = findTrackedByWs(clientWs) || tracked;
        logSessionEvent(activeTracked, 'tool.progress', {
          toolName: msg.toolName,
          status: msg.status,
          callId: msg.callId,
        });
        break;
      }

      case 'scan': {
        const activeTracked = findTrackedByWs(clientWs) || tracked;
        logSessionEvent(activeTracked, 'scan', msg.data || {});
        break;
      }

      case 'context.update': {
        const activeTracked = findTrackedByWs(clientWs) || tracked;
        if (!activeTracked.session) {
          sendToClient(clientWs, { type: 'error', message: 'No active session. Send session.start first.' });
          logSessionEvent(activeTracked, 'error', { message: 'context.update sent without active session' });
          return;
        }
        const newContext = msg.context || msg.systemInstruction;
        if (newContext) {
          activeTracked.session.systemInstruction = newContext;
        }
        logSessionEvent(activeTracked, 'context.update', {
          systemInstruction: newContext || '',
          ...(msg.data || {}),
        });
        sendToClient(clientWs, { type: 'context.updated' });
        break;
      }

      case 'session.stop': {
        const activeTracked = findTrackedByWs(clientWs) || tracked;
        activeTracked.session = null;
        logSessionEvent(activeTracked, 'session.stop', {});
        sendToClient(clientWs, { type: 'session.stopped' });
        break;
      }

      default:
        sendToClient(clientWs, { type: 'error', message: `Unknown message type: ${msg.type}` });
        logSessionEvent(tracked, 'error', { message: `Unknown message type: ${msg.type}` });
    }
  });

  clientWs.on('close', () => {
    const activeTracked = findTrackedByWs(clientWs) || tracked;

    // Keep session intact for reconnection (do NOT null it)
    activeTracked.disconnected = true;
    activeTracked.disconnectedAt = Date.now();
    activeTracked.clientWs = null;

    // Clear turn queue and pending tool results to avoid processing stale turns
    activeTracked.turnQueue.length = 0;
    activeTracked.turnProcessing = false;
    activeTracked.pendingToolResultsByTurn.clear();

    logSessionEvent(activeTracked, 'session.disconnected', { reason: 'disconnected' });
    broadcastToAdmins({
      type: 'session.disconnected',
      sessionId: activeTracked.id,
    });

    console.log(`[voxglide] Client disconnected: ${activeTracked.id} (active: ${Array.from(trackedSessions.values()).filter(s => !s.disconnected).length})`);

    // Clean up after 30 minutes if not reconnected
    activeTracked.cleanupTimer = setTimeout(() => {
      trackedSessions.delete(activeTracked.id);
    }, SESSION_CLEANUP_MS);
  });

  clientWs.on('error', (err) => {
    console.error('[voxglide] Client WebSocket error:', err.message);
    const activeTracked = findTrackedByWs(clientWs) || tracked;
    logSessionEvent(activeTracked, 'error', { message: err.message });
  });
});

// ── Helper: find tracked session by websocket ──

function findTrackedByWs(ws: WebSocket): TrackedSession | null {
  for (const tracked of trackedSessions.values()) {
    if (tracked.clientWs === ws) return tracked;
  }
  return null;
}

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
    tracked.pendingToolResultsByTurn.set(turnId, {
      resolve,
      results: [],
      expectedCount,
    });
    setTimeout(() => {
      if (tracked.pendingToolResultsByTurn.has(turnId)) {
        tracked.pendingToolResultsByTurn.delete(turnId);
        reject(new Error('Tool result timeout'));
      }
    }, 30000);
  });
}

// ── Streaming Gemini turn handling ──

async function handleTurnStreaming(
  session: Session,
  clientWs: WebSocket,
  tracked: TrackedSession,
  turnId: string,
): Promise<void> {
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
      // Check client still connected
      if (clientWs.readyState !== WebSocket.OPEN) {
        if (allParts.length > 0) {
          session.history.push({ role: 'model', parts: allParts });
        }
        return;
      }

      if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;

      for (const part of chunk.candidates?.[0]?.content?.parts || []) {
        allParts.push(part);
        if (part.text) {
          accumulatedText += part.text;
          sendToClient(clientWs, { type: 'response.delta', text: part.text });
        }
        if (part.functionCall) {
          functionCalls.push(part);
        }
      }
    }
  } catch (err: any) {
    // Save partial history on stream error
    if (allParts.length > 0) {
      session.history.push({ role: 'model', parts: allParts });
    }
    throw err;
  }

  // Send usage
  if (usageMetadata) {
    session.lastPromptTokenCount = usageMetadata.promptTokenCount || 0;
    session.lastOutputTokenCount = usageMetadata.candidatesTokenCount || 0;
    sendToClient(clientWs, {
      type: 'usage',
      totalTokens: usageMetadata.totalTokenCount || 0,
      inputTokens: usageMetadata.promptTokenCount || 0,
      outputTokens: usageMetadata.candidatesTokenCount || 0,
    });
  }

  if (functionCalls.length > 0) {
    session.history.push({ role: 'model', parts: allParts });

    // Send tool calls to client and wait for results
    const fcs = functionCalls.map((p: any) => ({
      id: crypto.randomUUID(),
      name: p.functionCall.name,
      args: p.functionCall.args || {},
    }));

    sendToClient(clientWs, { type: 'toolCall', functionCalls: fcs, turnId });
    logSessionEvent(tracked, 'toolCall', { functionCalls: fcs, turnId });

    // Wait for tool results from client
    const results = await waitForToolResults(tracked, fcs.length, turnId);

    // Add tool results to history
    const functionResponseParts = results.map((r: any) => ({
      functionResponse: {
        name: r.name,
        response: r.response,
      },
    }));
    session.history.push({ role: 'user', parts: functionResponseParts });

    // Get the model's follow-up response with tool results
    await handleTurnStreaming(session, clientWs, tracked, turnId);
  } else {
    session.history.push({ role: 'model', parts: allParts });

    // Send final response (backward compatible — old clients see type:'response')
    if (accumulatedText) {
      sendToClient(clientWs, { type: 'response', text: accumulatedText });
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

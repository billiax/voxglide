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
}

interface TrackedSession {
  session: Session | null;
  id: string;
  pageUrl: string;
  connectedAt: number;
  events: SessionEvent[];
  messageCount: number;
  disconnected: boolean;
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
    events: [],
    messageCount: 0,
    disconnected: false,
  };
  trackedSessions.set(sessionId, tracked);

  // Notify admins of new session
  broadcastToAdmins({
    type: 'session.new',
    session: getSessionSummary(tracked),
  });

  console.log(`[voxglide] Client connected: ${sessionId} (active: ${trackedSessions.size})`);

  let pendingToolResultResolve: ((results: any[]) => void) | null = null;
  let pendingToolResults: any[] = [];
  let pendingToolCount = 0;

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
        tracked.session = {
          history: [],
          systemInstruction: msg.config?.systemInstruction || '',
          tools: msg.config?.tools || [],
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
        sendToClient(clientWs, { type: 'session.started' });
        // Update admins with potentially new pageUrl
        broadcastToAdmins({
          type: 'session.update',
          session: getSessionSummary(tracked),
        });
        break;
      }

      case 'text': {
        if (!tracked.session) {
          sendToClient(clientWs, { type: 'error', message: 'No active session. Send session.start first.' });
          logSessionEvent(tracked, 'error', { message: 'Text sent without active session' });
          return;
        }

        const userText = msg.text;
        if (!userText) return;

        tracked.messageCount++;
        logSessionEvent(tracked, 'text', { text: userText });

        tracked.session.history.push({ role: 'user', parts: [{ text: userText }] });

        try {
          await handleTurn(tracked.session, clientWs, waitForToolResults, tracked);
        } catch (err: any) {
          sendToClient(clientWs, { type: 'error', message: err.message });
          logSessionEvent(tracked, 'error', { message: err.message });
        }
        break;
      }

      case 'toolResult': {
        const responses = msg.functionResponses || [];
        logSessionEvent(tracked, 'toolResult', { responses });
        pendingToolResults.push(...responses);
        if (pendingToolResults.length >= pendingToolCount && pendingToolResultResolve) {
          pendingToolResultResolve(pendingToolResults);
          pendingToolResultResolve = null;
          pendingToolResults = [];
          pendingToolCount = 0;
        }
        break;
      }

      case 'scan': {
        logSessionEvent(tracked, 'scan', msg.data || {});
        break;
      }

      case 'context.update': {
        if (!tracked.session) {
          sendToClient(clientWs, { type: 'error', message: 'No active session. Send session.start first.' });
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
        sendToClient(clientWs, { type: 'context.updated' });
        break;
      }

      case 'session.stop': {
        tracked.session = null;
        logSessionEvent(tracked, 'session.stop', {});
        sendToClient(clientWs, { type: 'session.stopped' });
        break;
      }

      default:
        sendToClient(clientWs, { type: 'error', message: `Unknown message type: ${msg.type}` });
        logSessionEvent(tracked, 'error', { message: `Unknown message type: ${msg.type}` });
    }
  });

  function waitForToolResults(expectedCount: number): Promise<any[]> {
    pendingToolResults = [];
    pendingToolCount = expectedCount;
    return new Promise((resolve, reject) => {
      pendingToolResultResolve = resolve;
      setTimeout(() => {
        if (pendingToolResultResolve) {
          pendingToolResultResolve = null;
          reject(new Error('Tool result timeout'));
        }
      }, 30000);
    });
  }

  clientWs.on('close', () => {
    tracked.session = null;
    tracked.disconnected = true;
    logSessionEvent(tracked, 'session.stop', { reason: 'disconnected' });
    broadcastToAdmins({
      type: 'session.disconnected',
      sessionId: tracked.id,
    });
    console.log(`[voxglide] Client disconnected: ${sessionId} (active: ${Array.from(trackedSessions.values()).filter(s => !s.disconnected).length})`);
    // Keep tracked session for admin review; clean up after 10 minutes
    setTimeout(() => {
      trackedSessions.delete(sessionId);
    }, 10 * 60 * 1000);
  });

  clientWs.on('error', (err) => {
    console.error('[voxglide] Client WebSocket error:', err.message);
    logSessionEvent(tracked, 'error', { message: err.message });
    tracked.session = null;
  });
});

// ── Gemini turn handling ──

async function handleTurn(
  session: Session,
  clientWs: WebSocket,
  waitForToolResults: (count: number) => Promise<any[]>,
  tracked: TrackedSession,
): Promise<void> {
  const config: GenerateContentConfig = {
    systemInstruction: session.systemInstruction,
    tools: session.tools,
  };

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: session.history,
    config,
  });

  // Extract usage
  if (response.usageMetadata) {
    sendToClient(clientWs, {
      type: 'usage',
      totalTokens: response.usageMetadata.totalTokenCount || 0,
      inputTokens: response.usageMetadata.promptTokenCount || 0,
      outputTokens: response.usageMetadata.candidatesTokenCount || 0,
    });
  }

  const candidate = response.candidates?.[0];
  if (!candidate?.content?.parts) {
    sendToClient(clientWs, { type: 'error', message: 'No response from model' });
    logSessionEvent(tracked, 'error', { message: 'No response from model' });
    return;
  }

  const parts = candidate.content.parts;

  // Check for function calls
  const functionCalls = parts.filter((p: any) => p.functionCall);

  if (functionCalls.length > 0) {
    // Add model's response (with function calls) to history
    session.history.push({ role: 'model', parts });

    // Send tool calls to client and wait for results
    const fcs = functionCalls.map((p: any) => ({
      id: p.functionCall.name + '_' + Date.now(),
      name: p.functionCall.name,
      args: p.functionCall.args || {},
    }));

    sendToClient(clientWs, { type: 'toolCall', functionCalls: fcs });
    logSessionEvent(tracked, 'toolCall', { functionCalls: fcs });

    // Wait for tool results from client
    const results = await waitForToolResults(fcs.length);

    // Add tool results to history
    const functionResponseParts = results.map((r: any) => ({
      functionResponse: {
        name: r.name,
        response: r.response,
      },
    }));
    session.history.push({ role: 'user', parts: functionResponseParts });

    // Get the model's follow-up response with tool results
    await handleTurn(session, clientWs, waitForToolResults, tracked);
  } else {
    // Regular text response
    const textParts = parts.filter((p: any) => p.text);
    const responseText = textParts.map((p: any) => p.text).join('');

    // Add to history
    session.history.push({ role: 'model', parts });

    // Send to client
    if (responseText) {
      sendToClient(clientWs, {
        type: 'response',
        text: responseText,
      });
      logSessionEvent(tracked, 'response', { text: responseText });
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

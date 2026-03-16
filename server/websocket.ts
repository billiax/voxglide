import { WebSocketServer, WebSocket } from 'ws';
import type http from 'http';
import {
  trackedSessions, adminClients, getTrackedByWs,
  getSessionSummary,
} from './state.js';
import { sendToClient } from './utils.js';
import { isOriginAllowed } from './http.js';
import {
  handleSessionStart, handleText, handleToolResult, handleToolProgress,
  handleScan, handleContextUpdate, handleSessionStop, handleWsClose,
  handleScreenshot, handleScreenshotError,
} from './handlers.js';
import { handleTurnCancel } from './turn-queue.js';
import { logSessionEvent } from './state.js';

export function initWebSockets(httpServer: http.Server): void {
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
        case 'turn.cancel': handleTurnCancel(tracked, msg); break;
        case 'session.stop': handleSessionStop(tracked); break;
        case 'screenshot': handleScreenshot(tracked, msg); break;
        case 'screenshot.error': handleScreenshotError(tracked, msg); break;
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
}

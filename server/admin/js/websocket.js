import { state, getDomRefs, renderers } from './state.js';
import { renderSidebar, selectSession, renderSessionHeader } from './sidebar.js';
import { appendEvent } from './events.js';

let analyticsDebounceTimer = null;

function scheduleAnalyticsUpdate() {
  if (state.activeTab !== 'analytics') return;
  if (analyticsDebounceTimer) return;
  analyticsDebounceTimer = setTimeout(() => {
    analyticsDebounceTimer = null;
    if (state.activeTab === 'analytics' && renderers.renderAnalytics) {
      renderers.renderAnalytics();
    }
  }, 500);
}

export function connect() {
  const { statusDot, statusText } = getDomRefs();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(proto + '//' + location.host + '/admin');

  state.ws.onopen = () => {
    statusDot.classList.add('connected');
    statusText.textContent = 'Connected';
  };

  state.ws.onclose = () => {
    statusDot.classList.remove('connected');
    statusText.textContent = 'Disconnected - reconnecting...';
    setTimeout(connect, 2000);
  };

  state.ws.onerror = () => {
    statusDot.classList.remove('connected');
    statusText.textContent = 'Error';
  };

  state.ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'sessions.list':
      for (const s of msg.sessions) {
        if (!state.sessions.has(s.id)) {
          state.sessions.set(s.id, { meta: s, events: [], screenshots: s.screenshots || {} });
        } else {
          const existing = state.sessions.get(s.id);
          existing.meta = s;
          // Clear events — server replays full history after sessions.list
          existing.events = [];
          if (s.screenshots) Object.assign(existing.screenshots || (existing.screenshots = {}), s.screenshots);
        }
      }
      renderSidebar();
      // Re-render events tab to clear stale display before replay
      if (state.selectedSessionId && state.sessions.has(state.selectedSessionId)) {
        if (state.activeTab === 'events' && renderers.renderEvents) renderers.renderEvents();
        if (state.activeTab === 'analysis' && renderers.renderAnalysis) renderers.renderAnalysis();
      }
      scheduleAnalyticsUpdate();
      break;

    case 'session.new':
      state.sessions.set(msg.session.id, { meta: msg.session, events: [], screenshots: {} });
      renderSidebar();
      // Auto-select if no session selected
      if (!state.selectedSessionId) {
        selectSession(msg.session.id);
      }
      scheduleAnalyticsUpdate();
      break;

    case 'session.update':
      if (state.sessions.has(msg.session.id)) {
        state.sessions.get(msg.session.id).meta = msg.session;
        renderSidebar();
        if (state.selectedSessionId === msg.session.id) {
          renderSessionHeader();
        }
      }
      break;

    case 'session.event': {
      if (!state.sessions.has(msg.sessionId)) {
        state.sessions.set(msg.sessionId, { meta: { id: msg.sessionId, pageUrl: '', connectedAt: Date.now(), messageCount: 0, disconnected: false }, events: [] });
        renderSidebar();
      }
      const session = state.sessions.get(msg.sessionId);
      // Dedup: skip if event with this seq already exists
      if (typeof msg.event.seq === 'number' && session.events.some(e => e.seq === msg.event.seq)) {
        break;
      }
      session.events.push(msg.event);
      // Update message count
      if (msg.event.type === 'text') {
        session.meta.messageCount = (session.meta.messageCount || 0) + 1;
        renderSidebar();
      }
      if (state.selectedSessionId === msg.sessionId) {
        if (state.activeTab === 'events') appendEvent(msg.event);
        if (msg.event.type === 'scan' && state.activeTab === 'analysis') {
          state.selectedScanIndex = -1; // auto-select latest
          renderers.renderAnalysis();
        }
      }
      scheduleAnalyticsUpdate();
      break;
    }

    case 'session.disconnected':
      if (state.sessions.has(msg.sessionId)) {
        state.sessions.get(msg.sessionId).meta.disconnected = true;
        renderSidebar();
        if (state.selectedSessionId === msg.sessionId) {
          renderSessionHeader();
        }
      }
      scheduleAnalyticsUpdate();
      break;

    case 'session.queue': {
      const sess = state.sessions.get(msg.sessionId);
      if (sess) {
        sess.queue = { active: msg.active, queued: msg.queued };
      }
      break;
    }

    case 'session.screenshot': {
      // Store screenshot on the session (latest per URL)
      const sess = state.sessions.get(msg.sessionId);
      if (sess) {
        if (!sess.screenshots) sess.screenshots = {};
        if (msg.image) sess.screenshots[msg.url || ''] = msg.image;
      }
      // Update analysis view if this is the selected session
      if (msg.sessionId === state.selectedSessionId) {
        if (renderers.handleScreenshotResult) {
          renderers.handleScreenshotResult(msg);
        }
      }
      break;
    }

    case 'screenshot.error':
      if (msg.sessionId === state.selectedSessionId && renderers.handleScreenshotError) {
        renderers.handleScreenshotError(msg);
      }
      break;
  }
}

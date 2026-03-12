import { state, getDomRefs, renderers } from './state.js';
import { escapeHtml, formatElapsed } from './utils.js';

export function renderSidebar() {
  const { sessionList, noSessions, sessionCount } = getDomRefs();
  const ids = Array.from(state.sessions.keys());
  sessionCount.textContent = '(' + ids.length + ')';

  if (ids.length === 0) {
    noSessions.style.display = 'block';
    return;
  }
  noSessions.style.display = 'none';

  // Sort: active first, then by connection time desc
  ids.sort((a, b) => {
    const sa = state.sessions.get(a).meta;
    const sb = state.sessions.get(b).meta;
    if (sa.disconnected !== sb.disconnected) return sa.disconnected ? 1 : -1;
    return sb.connectedAt - sa.connectedAt;
  });

  // Rebuild list preserving selection
  const fragment = document.createDocumentFragment();
  for (const id of ids) {
    const s = state.sessions.get(id).meta;
    const div = document.createElement('div');
    div.className = 'session-item' +
      (id === state.selectedSessionId ? ' active' : '') +
      (s.disconnected ? ' disconnected' : '');
    div.onclick = () => selectSession(id);

    const shortId = id.substring(0, 8);
    const elapsed = formatElapsed(s.connectedAt);
    const statusDot = s.disconnected
      ? '<span class="session-status-dot dead"></span>'
      : '<span class="session-status-dot live"></span>';

    // Extract pathname from URL for primary display
    // Fall back to lastScanData URL if pageUrl is not set
    const effectiveUrl = s.pageUrl || (s.lastScanData && s.lastScanData.url) || '';
    let displayUrl = effectiveUrl || 'unknown';
    try {
      if (effectiveUrl) {
        const u = new URL(effectiveUrl);
        displayUrl = u.pathname || '/';
      }
    } catch {}

    div.innerHTML =
      '<div class="session-url" title="' + escapeHtml(effectiveUrl) + '">' +
        statusDot + escapeHtml(displayUrl) +
      '</div>' +
      '<div class="session-id">' + shortId + '...</div>' +
      '<div class="session-meta">' +
        '<div>' + elapsed + ' | ' + (s.messageCount || 0) + ' messages</div>' +
      '</div>';
    fragment.appendChild(div);
  }

  // Replace children
  while (sessionList.firstChild && sessionList.firstChild !== noSessions) {
    sessionList.removeChild(sessionList.firstChild);
  }
  sessionList.insertBefore(fragment, noSessions);
}

function updateTabDisabledState() {
  const { tabBar } = getDomRefs();
  const hasSession = !!state.selectedSessionId;
  tabBar.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = btn.dataset.tab;
    if (tab === 'events' || tab === 'analysis') {
      btn.classList.toggle('disabled', !hasSession);
    }
  });
}

export function selectSession(id) {
  const { eventStream, analysisPanel, analyticsPanel } = getDomRefs();
  state.selectedSessionId = id;
  state.selectedScanIndex = -1;
  renderSidebar();
  renderSessionHeader();
  updateTabDisabledState();

  // If on a session-dependent tab, show it; if on analytics, stay there
  if (state.activeTab === 'analytics') {
    eventStream.style.display = 'none';
    analysisPanel.classList.remove('visible');
    analyticsPanel.classList.add('visible');
    return;
  }

  if (state.activeTab === 'events') {
    eventStream.style.display = '';
    analysisPanel.classList.remove('visible');
    analyticsPanel.classList.remove('visible');
    renderers.renderEvents();
  } else {
    eventStream.style.display = 'none';
    analysisPanel.classList.add('visible');
    analyticsPanel.classList.remove('visible');
    renderers.renderAnalysis();
  }
}

export function renderSessionHeader() {
  const { selectedSessionInfo, selectedSessionMeta } = getDomRefs();
  updateTabDisabledState();
  if (!state.selectedSessionId || !state.sessions.has(state.selectedSessionId)) {
    selectedSessionInfo.textContent = 'Select a session to view events';
    selectedSessionMeta.textContent = '';
    return;
  }
  const s = state.sessions.get(state.selectedSessionId).meta;
  const status = s.disconnected ? ' (disconnected)' : ' (live)';
  selectedSessionInfo.textContent = s.id.substring(0, 8) + '...' + status;
  selectedSessionMeta.textContent = escapeHtml(s.pageUrl || '');
}

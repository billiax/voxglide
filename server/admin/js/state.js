// Shared mutable state
export const state = {
  sessions: new Map(), // sessionId -> { meta, events[] }
  selectedSessionId: null,
  ws: null,
  autoScroll: true,
  activeTab: 'events', // 'events' | 'analysis' | 'analytics'
  selectedScanIndex: -1, // -1 = latest
  theme: 'auto', // 'dark' | 'light' | 'auto'
  eventFilters: { user: true, ai: true, tools: true, scans: true, system: true },
  eventGroupsCollapsed: new Set(),
};

// Renderer registry (avoids circular imports)
export const renderers = {};

// Cached DOM refs
let domRefs = null;

export function getDomRefs() {
  if (!domRefs) {
    domRefs = {
      statusDot: document.getElementById('statusDot'),
      statusText: document.getElementById('statusText'),
      sessionList: document.getElementById('sessionList'),
      noSessions: document.getElementById('noSessions'),
      sessionCount: document.getElementById('sessionCount'),
      eventStream: document.getElementById('eventStream'),
      emptyState: document.getElementById('emptyState'),
      selectedSessionInfo: document.getElementById('selectedSessionInfo'),
      selectedSessionMeta: document.getElementById('selectedSessionMeta'),
      tabBar: document.getElementById('tabBar'),
      analysisPanel: document.getElementById('analysisPanel'),
      analyticsPanel: document.getElementById('analyticsPanel'),
    };
  }
  return domRefs;
}

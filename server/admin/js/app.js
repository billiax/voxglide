import { state, getDomRefs, renderers } from './state.js';
import { initTheme } from './theme.js';
import { renderSidebar } from './sidebar.js';
import { connect } from './websocket.js';
// Import to trigger renderer registration
import './events.js';
import './analysis.js';
import './analytics.js';

const { tabBar, eventStream, analysisPanel, analyticsPanel } = getDomRefs();

// Initialize theme before anything else
initTheme();

// Tab switching
tabBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn || btn.classList.contains('disabled')) return;
  const tab = btn.dataset.tab;
  if (tab === state.activeTab) return;
  state.activeTab = tab;
  tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  eventStream.style.display = tab === 'events' ? '' : 'none';
  analysisPanel.classList.toggle('visible', tab === 'analysis');
  analyticsPanel.classList.toggle('visible', tab === 'analytics');
  if (tab === 'analysis') renderers.renderAnalysis();
  if (tab === 'analytics') renderers.renderAnalytics();
});

// Detect if user scrolled up (disable auto-scroll)
eventStream.addEventListener('scroll', () => {
  const atBottom = eventStream.scrollTop + eventStream.clientHeight >= eventStream.scrollHeight - 40;
  state.autoScroll = atBottom;
});

// Update elapsed times every 10s
setInterval(renderSidebar, 10000);

// Start
connect();

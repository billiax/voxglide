import { state, getDomRefs, renderers } from './state.js';
import { initTheme } from './theme.js';
import { renderSidebar } from './sidebar.js';
import { connect } from './websocket.js';
// Import to trigger renderer registration
import './events.js';
import './analysis.js';

const { tabBar, eventStream, analysisPanel } = getDomRefs();

// Initialize theme before anything else
initTheme();

// Tab switching
tabBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  const tab = btn.dataset.tab;
  if (tab === state.activeTab) return;
  state.activeTab = tab;
  tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'events') {
    eventStream.style.display = '';
    analysisPanel.classList.remove('visible');
  } else {
    eventStream.style.display = 'none';
    analysisPanel.classList.add('visible');
    renderers.renderAnalysis();
  }
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

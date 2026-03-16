export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

export function formatElapsed(connectedAt) {
  const diff = Math.floor((Date.now() - connectedAt) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  return Math.floor(diff / 3600) + 'h ago';
}

export function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return totalSec + 's';
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return min + 'm ' + sec + 's';
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return hr + 'h ' + remMin + 'm';
}

export function truncateStr(s, max) {
  if (!s || s.length <= max) return s || '';
  return s.slice(0, max - 3) + '...';
}

export function eventLabel(type) {
  const labels = {
    'text': 'USER',
    'response': 'AI',
    'toolCall': 'TOOL CALL',
    'toolResult': 'TOOL RESULT',
    'scan': 'SCAN',
    'context.update': 'CONTEXT',
    'session.start': 'START',
    'session.stop': 'STOP',
    'session.resumed': 'RESUMED',
    'session.disconnected': 'DISCONNECTED',
    'tool.progress': 'TOOL STATUS',
    'history.summarized': 'SUMMARIZED',
    'response.delta': 'DELTA',
    'error': 'ERROR',
    'llm.turn': 'LLM',
    'cache.created': 'CACHE',
    'cache.error': 'CACHE ERR',
    'response.suppressed': 'SUPPRESSED',
    'warning': 'WARN',
  };
  return labels[type] || type.toUpperCase();
}

export function statCard(value, label, accent) {
  return '<div class="stat-card ' + accent + '">' +
    '<div class="stat-value">' + value + '</div>' +
    '<div class="stat-label">' + label + '</div>' +
    '</div>';
}

export function scrollToBottom(eventStream) {
  requestAnimationFrame(() => {
    eventStream.scrollTop = eventStream.scrollHeight;
  });
}

export function chevronIcon(collapsed) {
  const rotation = collapsed ? '-90' : '0';
  return '<svg class="chevron" width="12" height="12" viewBox="0 0 12 12" style="transform:rotate(' + rotation + 'deg)">' +
    '<path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
}

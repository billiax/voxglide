import { state, getDomRefs, renderers } from './state.js';
import { escapeHtml, formatTime, eventLabel, scrollToBottom, chevronIcon } from './utils.js';

// ── Filter category mapping ──
function getFilterCategory(eventType) {
  switch (eventType) {
    case 'text': return 'user';
    case 'response':
    case 'response.delta': return 'ai';
    case 'toolCall':
    case 'toolResult':
    case 'tool.progress': return 'tools';
    case 'scan':
    case 'context.update': return 'scans';
    default: return 'system';
  }
}

const filterLabels = { user: 'User', ai: 'AI', tools: 'Tools', scans: 'Scans', system: 'System' };

/**
 * Resolve an element description by index from the latest scan data.
 * Used to annotate clickElement/fillField tool calls with the actual element name.
 */
function resolveElementNameByIndex(index) {
  if (!state.selectedSessionId || !state.sessions.has(state.selectedSessionId)) return null;
  const session = state.sessions.get(state.selectedSessionId);
  // Find the most recent scan event
  for (let i = session.events.length - 1; i >= 0; i--) {
    const ev = session.events[i];
    if (ev.type === 'scan' && ev.data && Array.isArray(ev.data.interactiveElements)) {
      const el = ev.data.interactiveElements.find(e => e.index === index);
      if (el) return el.description || null;
      break;
    }
  }
  return null;
}

// ── Event Grouping (pure function) ──
function groupEvents(events) {
  const groups = [];
  const toolGroups = new Map(); // turnId -> group index

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];

    // Tool grouping: toolCall + tool.progress + toolResult with same turnId
    if ((ev.type === 'toolCall' || ev.type === 'tool.progress' || ev.type === 'toolResult') && ev.data && ev.data.turnId) {
      const turnId = ev.data.turnId;
      if (toolGroups.has(turnId)) {
        const gIdx = toolGroups.get(turnId);
        groups[gIdx].events.push(ev);
        // Update status
        if (ev.type === 'toolResult') {
          groups[gIdx].status = 'completed';
        } else if (ev.type === 'tool.progress' && ev.data.status === 'failed') {
          groups[gIdx].status = 'failed';
        }
        continue;
      }
      // Start new tool group
      let toolName = '';
      if (ev.type === 'toolCall' && ev.data.functionCalls) {
        toolName = ev.data.functionCalls.map(fc => fc.name).join(', ');
      } else if (ev.data.toolName) {
        toolName = ev.data.toolName;
      }
      const group = {
        type: 'tool-group',
        toolName: toolName,
        turnId: turnId,
        status: ev.type === 'toolResult' ? 'completed' : 'executing',
        events: [ev],
        filterCategory: 'tools',
      };
      toolGroups.set(turnId, groups.length);
      groups.push(group);
      continue;
    }

    // Duplicate scan collapse: consecutive scans for same URL
    if (ev.type === 'scan' && ev.data) {
      const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
      if (lastGroup && lastGroup.type === 'scan-group' && lastGroup.url === (ev.data.url || '')) {
        lastGroup.events.push(ev);
        lastGroup.count++;
        continue;
      }
      groups.push({
        type: 'scan-group',
        url: ev.data.url || '',
        count: 1,
        events: [ev],
        filterCategory: 'scans',
      });
      continue;
    }

    // Navigation grouping: navigateTo tool result + session.disconnected + session.resumed
    // Check if this is a session.disconnected that follows a navigateTo tool group
    if (ev.type === 'session.disconnected') {
      const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
      if (lastGroup && lastGroup.type === 'tool-group' && lastGroup.toolName === 'navigateTo') {
        // Convert to navigation group
        lastGroup.type = 'nav-group';
        lastGroup.events.push(ev);
        lastGroup.filterCategory = 'system';
        continue;
      }
    }

    if (ev.type === 'session.resumed') {
      const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
      if (lastGroup && lastGroup.type === 'nav-group') {
        lastGroup.events.push(ev);
        lastGroup.status = 'completed';
        continue;
      }
    }

    // Individual event
    groups.push({
      type: 'event',
      event: ev,
      events: [ev],
      filterCategory: getFilterCategory(ev.type),
    });
  }

  return groups;
}

// ── Filter Bar ──
function renderFilterBar(events) {
  const counts = { user: 0, ai: 0, tools: 0, scans: 0, system: 0 };
  for (const ev of events) {
    counts[getFilterCategory(ev.type)]++;
  }

  let html = '<div class="event-filter-bar">';
  for (const [key, label] of Object.entries(filterLabels)) {
    const active = state.eventFilters[key] ? ' active' : '';
    html += '<button class="filter-toggle' + active + '" data-filter="' + key + '">' +
      label + ' <span class="filter-count">' + counts[key] + '</span></button>';
  }
  html += '</div>';
  return html;
}

// ── Rendering ──
export function renderEvents() {
  const { eventStream } = getDomRefs();
  eventStream.innerHTML = '';
  if (!state.selectedSessionId || !state.sessions.has(state.selectedSessionId)) {
    eventStream.innerHTML = '<div class="empty-state">Select a session from the sidebar</div>';
    return;
  }
  const events = state.sessions.get(state.selectedSessionId).events;
  if (events.length === 0) {
    eventStream.innerHTML = '<div class="empty-state">No events yet</div>';
    return;
  }

  // Filter bar
  const filterBarHtml = renderFilterBar(events);
  const filterDiv = document.createElement('div');
  filterDiv.innerHTML = filterBarHtml;
  eventStream.appendChild(filterDiv.firstElementChild);

  // Wire up filter toggles
  eventStream.querySelector('.event-filter-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-toggle');
    if (!btn) return;
    const filter = btn.dataset.filter;
    state.eventFilters[filter] = !state.eventFilters[filter];
    btn.classList.toggle('active', state.eventFilters[filter]);
    applyFilters();
  });

  // Group and render events
  const groups = groupEvents(events);
  for (const group of groups) {
    renderGroup(group, eventStream);
  }

  scrollToBottom(eventStream);
}

function applyFilters() {
  const { eventStream } = getDomRefs();
  const items = eventStream.querySelectorAll('[data-filter-category]');
  for (const item of items) {
    const cat = item.dataset.filterCategory;
    item.classList.toggle('filtered-out', !state.eventFilters[cat]);
  }
}

function renderGroup(group, container) {
  if (group.type === 'event') {
    const div = renderEventItem(group.event);
    div.dataset.filterCategory = group.filterCategory;
    container.appendChild(div);
    return;
  }

  if (group.type === 'tool-group') {
    renderToolGroup(group, container);
    return;
  }

  if (group.type === 'nav-group') {
    renderNavGroup(group, container);
    return;
  }

  if (group.type === 'scan-group') {
    renderScanGroup(group, container);
    return;
  }
}

function renderToolGroup(group, container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'event-group collapsed';
  wrapper.dataset.filterCategory = group.filterCategory;
  wrapper.dataset.turnId = group.turnId;

  const statusBadge = group.status === 'completed'
    ? '<span class="group-badge completed">completed</span>'
    : group.status === 'failed'
      ? '<span class="group-badge failed">failed</span>'
      : '<span class="group-badge" style="background:var(--bg-badge-blue);color:var(--accent-blue)">executing</span>';

  const time = formatTime(group.events[0].timestamp);

  wrapper.innerHTML =
    '<div class="event-group-header">' +
      chevronIcon(true) +
      '<div class="group-title">' +
        '<span class="event-time">' + time + '</span>' +
        '<span class="event-label" style="background:var(--bg-badge-purple);color:var(--accent-purple)">TOOL</span>' +
        '<span class="tool-name">' + escapeHtml(group.toolName) + '</span>' +
        statusBadge +
        '<span style="color:var(--text-faint);font-size:11px">' + group.events.length + ' events</span>' +
      '</div>' +
    '</div>' +
    '<div class="event-group-body"></div>';

  const header = wrapper.querySelector('.event-group-header');
  const body = wrapper.querySelector('.event-group-body');

  header.addEventListener('click', () => {
    wrapper.classList.toggle('collapsed');
    const chev = header.querySelector('.chevron');
    if (chev) {
      chev.style.transform = wrapper.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
    }
  });

  for (const ev of group.events) {
    body.appendChild(renderEventItem(ev));
  }

  container.appendChild(wrapper);
}

function renderNavGroup(group, container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'event-group collapsed';
  wrapper.dataset.filterCategory = group.filterCategory;

  // Extract navigation URL from the tool call
  let navUrl = '';
  for (const ev of group.events) {
    if (ev.type === 'toolCall' && ev.data.functionCalls) {
      for (const fc of ev.data.functionCalls) {
        if (fc.name === 'navigateTo' && fc.args && fc.args.url) {
          navUrl = fc.args.url;
        }
      }
    }
  }

  let displayPath = navUrl;
  try {
    if (navUrl) displayPath = new URL(navUrl).pathname;
  } catch {}

  const statusBadge = group.status === 'completed'
    ? '<span class="group-badge navigated">completed</span>'
    : '<span class="group-badge" style="background:var(--bg-badge-blue);color:var(--accent-blue)">navigating</span>';

  const time = formatTime(group.events[0].timestamp);

  wrapper.innerHTML =
    '<div class="event-group-header">' +
      chevronIcon(true) +
      '<div class="group-title">' +
        '<span class="event-time">' + time + '</span>' +
        '<span class="event-label" style="background:var(--bg-badge-blue);color:var(--accent-blue)">NAV</span>' +
        '<span style="color:var(--accent-blue);font-weight:600">Navigated to ' + escapeHtml(displayPath) + '</span>' +
        statusBadge +
      '</div>' +
    '</div>' +
    '<div class="event-group-body"></div>';

  const header = wrapper.querySelector('.event-group-header');
  const body = wrapper.querySelector('.event-group-body');

  header.addEventListener('click', () => {
    wrapper.classList.toggle('collapsed');
    const chev = header.querySelector('.chevron');
    if (chev) {
      chev.style.transform = wrapper.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
    }
  });

  for (const ev of group.events) {
    body.appendChild(renderEventItem(ev));
  }

  container.appendChild(wrapper);
}

function renderScanGroup(group, container) {
  if (group.count === 1) {
    // Single scan — render as regular event
    const div = renderEventItem(group.events[0]);
    div.dataset.filterCategory = group.filterCategory;
    container.appendChild(div);
    return;
  }

  // Multiple scans for same URL — collapsed group
  const wrapper = document.createElement('div');
  wrapper.className = 'event-group collapsed';
  wrapper.dataset.filterCategory = group.filterCategory;

  const latestScan = group.events[group.events.length - 1];
  const time = formatTime(latestScan.timestamp);

  wrapper.innerHTML =
    '<div class="event-group-header">' +
      chevronIcon(true) +
      '<div class="group-title">' +
        '<span class="event-time">' + time + '</span>' +
        '<span class="event-label" style="background:var(--bg-badge-blue);color:var(--accent-cyan)">SCAN</span>' +
        '<span>Scanned</span>' +
        '<span class="duplicate-indicator">x' + group.count + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="event-group-body"></div>';

  const header = wrapper.querySelector('.event-group-header');
  const body = wrapper.querySelector('.event-group-body');

  header.addEventListener('click', () => {
    wrapper.classList.toggle('collapsed');
    const chev = header.querySelector('.chevron');
    if (chev) {
      chev.style.transform = wrapper.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
    }
  });

  for (const ev of group.events) {
    body.appendChild(renderEventItem(ev));
  }

  container.appendChild(wrapper);
}

function renderEventItem(event) {
  const div = document.createElement('div');
  div.className = 'event-item ' + event.type;

  const time = formatTime(event.timestamp);
  const label = eventLabel(event.type);
  let content = '';

  switch (event.type) {
    case 'text':
      content = '<strong>User:</strong> ' + escapeHtml(event.data.text || '');
      break;
    case 'response':
      content = '<strong>AI:</strong> ' + escapeHtml(event.data.text || '');
      break;
    case 'toolCall':
      if (event.data.functionCalls) {
        content = event.data.functionCalls.map(fc => {
          let argsHtml = '<div class="tool-args">' + escapeHtml(JSON.stringify(fc.args, null, 2)) + '</div>';
          // Resolve element name from scan data for clickElement/fillField with index
          if ((fc.name === 'clickElement' || fc.name === 'fillField') && fc.args && fc.args.index != null) {
            const elName = resolveElementNameByIndex(fc.args.index);
            if (elName) {
              argsHtml += '<div class="tool-resolved" style="color:var(--text-muted);font-size:11px;margin-top:2px">' +
                '\u2192 ' + escapeHtml(elName) + '</div>';
            }
          }
          return '<span class="tool-name">' + escapeHtml(fc.name) + '</span>' + argsHtml;
        }).join('<br>');
      }
      break;
    case 'toolResult':
      if (event.data.responses) {
        content = event.data.responses.map(r =>
          '<span class="tool-name">' + escapeHtml(r.name) + '</span>: ' +
          '<span class="tool-args">' + escapeHtml(typeof r.response === 'string' ? r.response : JSON.stringify(r.response, null, 2)) + '</span>'
        ).join('<br>');
      }
      break;
    case 'scan':
      content = renderScanData(event.data);
      break;
    case 'context.update':
      content = 'Page context updated';
      if (event.data.systemInstruction) {
        content += renderPageContext(event.data.systemInstruction);
      }
      break;
    case 'session.start':
      content = 'Session started';
      if (event.data.pageUrl) content += ' | ' + escapeHtml(event.data.pageUrl);
      if (event.data.toolCount) content += ' | ' + event.data.toolCount + ' tools';
      if (event.data.systemInstruction) {
        content += renderPageContext(event.data.systemInstruction);
      }
      break;
    case 'session.stop':
      content = event.data.reason === 'disconnected' ? 'Client disconnected' : 'Session stopped';
      break;
    case 'tool.progress':
      content = '<span class="tool-name">' + escapeHtml(event.data.toolName || '') + '</span>' +
        '<span class="tool-progress-status ' + (event.data.status || '') + '">' + escapeHtml(event.data.status || '') + '</span>';
      break;
    case 'history.summarized':
      content = 'History summarized: <strong>' + (event.data.oldTurns || 0) + '</strong> old turns compressed, ' +
        '<strong>' + (event.data.keptTurns || 0) + '</strong> recent turns kept. ' +
        'Summary: ' + (event.data.summaryLength || 0) + ' chars';
      break;
    case 'session.resumed':
      content = 'Session resumed (reconnected)';
      if (event.data.pageUrl) content += ' | ' + escapeHtml(event.data.pageUrl);
      break;
    case 'session.disconnected':
      content = 'Client disconnected';
      if (event.data.reason) content += ' (' + escapeHtml(event.data.reason) + ')';
      break;
    case 'error':
      content = escapeHtml(event.data.message || JSON.stringify(event.data));
      break;
    default:
      content = escapeHtml(JSON.stringify(event.data, null, 2));
  }

  div.innerHTML =
    '<div>' +
      '<span class="event-time">' + time + '</span>' +
      '<span class="event-label">' + label + '</span>' +
    '</div>' +
    '<div class="event-content">' + content + '</div>';

  // Click to expand collapsed content
  div.addEventListener('click', () => {
    const c = div.querySelector('.event-content');
    if (c && c.classList.contains('collapsed')) {
      c.classList.remove('collapsed');
    }
  });

  return div;
}

// ── Incremental Append ──
export function appendEvent(event, scroll = true) {
  const { eventStream } = getDomRefs();

  // Remove empty state
  const empty = eventStream.querySelector('.empty-state');
  if (empty) empty.remove();

  // Ensure filter bar exists
  if (!eventStream.querySelector('.event-filter-bar')) {
    const session = state.sessions.get(state.selectedSessionId);
    if (session) {
      const filterBarHtml = renderFilterBar(session.events);
      const filterDiv = document.createElement('div');
      filterDiv.innerHTML = filterBarHtml;
      const bar = filterDiv.firstElementChild;
      eventStream.insertBefore(bar, eventStream.firstChild);
      bar.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-toggle');
        if (!btn) return;
        const filter = btn.dataset.filter;
        state.eventFilters[filter] = !state.eventFilters[filter];
        btn.classList.toggle('active', state.eventFilters[filter]);
        applyFilters();
      });
    }
  } else {
    // Update filter counts
    updateFilterCounts();
  }

  const category = getFilterCategory(event.type);

  // Try to append to existing group
  if ((event.type === 'toolCall' || event.type === 'tool.progress' || event.type === 'toolResult') && event.data && event.data.turnId) {
    const existingGroup = eventStream.querySelector('.event-group[data-turn-id="' + event.data.turnId + '"]');
    if (existingGroup) {
      const body = existingGroup.querySelector('.event-group-body');
      body.appendChild(renderEventItem(event));
      // Update status badge
      if (event.type === 'toolResult') {
        const badge = existingGroup.querySelector('.group-badge');
        if (badge) { badge.className = 'group-badge completed'; badge.textContent = 'completed'; }
      } else if (event.type === 'tool.progress' && event.data.status === 'failed') {
        const badge = existingGroup.querySelector('.group-badge');
        if (badge) { badge.className = 'group-badge failed'; badge.textContent = 'failed'; }
      }
      // Update event count
      const countSpan = existingGroup.querySelector('.group-title > span:last-child');
      if (countSpan && countSpan.textContent.includes('events')) {
        const eventCount = existingGroup.querySelectorAll('.event-group-body .event-item').length;
        countSpan.textContent = eventCount + ' events';
      }
      if (!state.eventFilters[category]) existingGroup.classList.add('filtered-out');
      if (scroll && state.autoScroll) scrollToBottom(eventStream);
      return;
    }
  }

  // Scan deduplication: check if last item is a scan group or scan event for same URL
  if (event.type === 'scan' && event.data) {
    const lastChild = eventStream.lastElementChild;
    // Check for existing scan group
    if (lastChild && lastChild.classList.contains('event-group') && lastChild.dataset.filterCategory === 'scans') {
      const body = lastChild.querySelector('.event-group-body');
      body.appendChild(renderEventItem(event));
      const indicator = lastChild.querySelector('.duplicate-indicator');
      if (indicator) {
        const count = lastChild.querySelectorAll('.event-group-body .event-item').length;
        indicator.textContent = 'x' + count;
      }
      if (!state.eventFilters[category]) lastChild.classList.add('filtered-out');
      if (scroll && state.autoScroll) scrollToBottom(eventStream);
      return;
    }
    // Check for single scan event — convert to group
    if (lastChild && lastChild.classList.contains('event-item') && lastChild.classList.contains('scan')) {
      // Full re-render is simplest here
      renderEvents();
      return;
    }
  }

  // Navigation group: session.disconnected after navigateTo tool group
  if (event.type === 'session.disconnected') {
    const lastChild = eventStream.lastElementChild;
    if (lastChild && lastChild.classList.contains('event-group') && lastChild.dataset.turnId) {
      // Check if this was a navigateTo group
      const titleSpan = lastChild.querySelector('.tool-name');
      if (titleSpan && titleSpan.textContent === 'navigateTo') {
        const body = lastChild.querySelector('.event-group-body');
        body.appendChild(renderEventItem(event));
        // Update header to show navigation
        const header = lastChild.querySelector('.event-group-header');
        if (header) {
          const labelEl = header.querySelector('.event-label');
          if (labelEl) { labelEl.textContent = 'NAV'; labelEl.style.background = 'var(--bg-badge-blue)'; labelEl.style.color = 'var(--accent-blue)'; }
        }
        if (scroll && state.autoScroll) scrollToBottom(eventStream);
        return;
      }
    }
  }

  // session.resumed after nav group
  if (event.type === 'session.resumed') {
    const lastChild = eventStream.lastElementChild;
    if (lastChild && lastChild.classList.contains('event-group')) {
      const labelEl = lastChild.querySelector('.event-label');
      if (labelEl && labelEl.textContent === 'NAV') {
        const body = lastChild.querySelector('.event-group-body');
        body.appendChild(renderEventItem(event));
        const badge = lastChild.querySelector('.group-badge');
        if (badge) { badge.className = 'group-badge navigated'; badge.textContent = 'completed'; }
        if (scroll && state.autoScroll) scrollToBottom(eventStream);
        return;
      }
    }
  }

  // New tool group
  if (event.type === 'toolCall' && event.data && event.data.turnId) {
    const group = {
      type: 'tool-group',
      toolName: event.data.functionCalls ? event.data.functionCalls.map(fc => fc.name).join(', ') : '',
      turnId: event.data.turnId,
      status: 'executing',
      events: [event],
      filterCategory: 'tools',
    };
    renderToolGroup(group, eventStream);
    const wrapper = eventStream.lastElementChild;
    if (!state.eventFilters[category]) wrapper.classList.add('filtered-out');
    if (scroll && state.autoScroll) scrollToBottom(eventStream);
    return;
  }

  // Default: individual event
  const div = renderEventItem(event);
  div.dataset.filterCategory = category;
  if (!state.eventFilters[category]) div.classList.add('filtered-out');
  eventStream.appendChild(div);

  if (scroll && state.autoScroll) {
    scrollToBottom(eventStream);
  }
}

function updateFilterCounts() {
  const { eventStream } = getDomRefs();
  const session = state.sessions.get(state.selectedSessionId);
  if (!session) return;

  const counts = { user: 0, ai: 0, tools: 0, scans: 0, system: 0 };
  for (const ev of session.events) {
    counts[getFilterCategory(ev.type)]++;
  }

  const bar = eventStream.querySelector('.event-filter-bar');
  if (!bar) return;
  bar.querySelectorAll('.filter-toggle').forEach(btn => {
    const filter = btn.dataset.filter;
    const countEl = btn.querySelector('.filter-count');
    if (countEl) countEl.textContent = counts[filter];
  });
}

export function renderScanData(data) {
  if (!data || typeof data !== 'object') return escapeHtml(JSON.stringify(data));

  let html = '';
  if (data.title || data.url) {
    html += '<div style="margin-bottom:6px;font-size:12px">';
    if (data.title) html += '<strong style="color:var(--text-primary)">' + escapeHtml(data.title) + '</strong>';
    if (data.url) html += ' <span style="color:var(--accent-blue);font-family:monospace;font-size:11px">' + escapeHtml(data.url) + '</span>';
    html += '</div>';
  }

  const counts = [
    ['forms', 'Forms'],
    ['interactiveElements', 'Interactive'],
    ['headings', 'Headings'],
    ['navigation', 'Nav Links'],
  ];
  html += '<div class="scan-details">';
  for (const [key, label] of counts) {
    if (data[key] !== undefined) {
      const val = Array.isArray(data[key]) ? data[key].length : data[key];
      html += '<div class="scan-stat"><strong>' + val + '</strong> ' + label + '</div>';
    }
  }
  if (data.content) {
    const len = typeof data.content === 'string' ? data.content.length : 0;
    html += '<div class="scan-stat"><strong>' + (len > 1000 ? (len/1000).toFixed(1) + 'K' : len) + '</strong> Content chars</div>';
  }
  html += '</div>';

  return html;
}

export function renderPageContext(systemInstruction) {
  const sections = {};
  let currentSection = null;
  const lines = systemInstruction.split('\n');

  for (const line of lines) {
    const sectionMatch = line.match(/^([A-Z ]+):$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      sections[currentSection] = [];
    } else if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  let html = '<div class="context-panel">';

  const pageContext = sections['PAGE CONTEXT'];
  if (pageContext) {
    const contextText = pageContext.join('\n').trim();
    html += '<details class="context-section">' +
      '<summary>Page Analysis</summary>' +
      '<pre class="context-content">' + escapeHtml(contextText) + '</pre>' +
      '</details>';
  }

  const devContext = sections['ADDITIONAL CONTEXT'];
  if (devContext) {
    const devText = devContext.join('\n').trim();
    if (devText && devText !== 'None.') {
      html += '<details class="context-section">' +
        '<summary>Developer Context</summary>' +
        '<pre class="context-content">' + escapeHtml(devText) + '</pre>' +
        '</details>';
    }
  }

  const actions = sections['AVAILABLE ACTIONS'];
  if (actions) {
    const actionsText = actions.join('\n').trim();
    if (actionsText && actionsText !== 'None.') {
      html += '<details class="context-section">' +
        '<summary>Available Actions</summary>' +
        '<pre class="context-content">' + escapeHtml(actionsText) + '</pre>' +
        '</details>';
    }
  }

  html += '</div>';
  return html;
}

// Register renderer
renderers.renderEvents = renderEvents;

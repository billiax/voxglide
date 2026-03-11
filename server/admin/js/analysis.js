import { state, getDomRefs, renderers } from './state.js';
import { escapeHtml, formatTime, formatDuration, chevronIcon } from './utils.js';

function getScanEvents(sessionId) {
  if (!sessionId || !state.sessions.has(sessionId)) return [];
  return state.sessions.get(sessionId).events.filter(e => e.type === 'scan' && e.data);
}

function getSessionEvents(sessionId) {
  if (!sessionId || !state.sessions.has(sessionId)) return [];
  return state.sessions.get(sessionId).events;
}

// ── Group scans by page URL ──
function groupScansByPage(scanEvents) {
  const pages = [];
  for (const se of scanEvents) {
    const url = se.data.url || '';
    const last = pages.length > 0 ? pages[pages.length - 1] : null;
    if (last && last.url === url) {
      last.scans.push(se);
      last.lastTime = se.timestamp;
    } else {
      pages.push({
        url: url,
        title: se.data.title || '',
        scans: [se],
        firstTime: se.timestamp,
        lastTime: se.timestamp,
      });
    }
  }
  return pages;
}

// ── Categorize elements ──
function groupElementsByCategory(elements) {
  const categories = [
    { key: 'buttons', label: 'Buttons', test: el => hasCapability(el, 'clickable') && isButton(el) && !hasCapability(el, 'navigable') },
    { key: 'links', label: 'Links / Navigation', test: el => hasCapability(el, 'navigable') },
    { key: 'switches', label: 'Switches / Toggles', test: el => hasCapability(el, 'toggleable') },
    { key: 'forms', label: 'Form Controls', test: el => hasCapability(el, 'editable') || hasCapability(el, 'selectable') },
  ];

  const result = [];
  const assigned = new Set();

  for (const cat of categories) {
    const items = elements.filter((el, i) => {
      if (assigned.has(i)) return false;
      return cat.test(el);
    });
    items.forEach(el => assigned.add(elements.indexOf(el)));
    if (items.length > 0) {
      result.push({ key: cat.key, label: cat.label, items });
    }
  }

  // "Other" category for anything not assigned
  const others = elements.filter((_, i) => !assigned.has(i));
  if (others.length > 0) {
    result.push({ key: 'other', label: 'Other', items: others });
  }

  return result;
}

function hasCapability(el, cap) {
  return Array.isArray(el.capabilities) && el.capabilities.includes(cap);
}

function isButton(el) {
  const tag = (el.tagName || '').toLowerCase();
  const role = (el.role || '').toLowerCase();
  return tag === 'button' || role === 'button' || tag === 'a' || role === 'menuitem';
}

// ── Render capability badges ──
function renderCapabilityBadges(capabilities) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) return '';
  return capabilities.map(c =>
    '<span class="capability-badge cap-' + escapeHtml(c) + '">' + escapeHtml(c) + '</span>'
  ).join(' ');
}

// ── Render element card ──
function renderElementCard(el) {
  const vpDot = el.inViewport !== undefined
    ? '<span class="viewport-dot ' + (el.inViewport ? 'in' : 'out') + '" title="' + (el.inViewport ? 'In viewport' : 'Off screen') + '"></span>'
    : '';
  const tagDisplay = el.role ? escapeHtml(el.role) : escapeHtml(el.tagName || '-');
  const caps = renderCapabilityBadges(el.capabilities);
  const stateStr = el.state
    ? Object.entries(el.state).map(p => escapeHtml(p[0]) + '=' + escapeHtml(p[1])).join(', ')
    : '';

  let html = '<div class="element-card">';
  if (vpDot) {
    html += '<div class="element-card-viewport">' + vpDot + '</div>';
  }
  html += '<div class="element-card-body">';
  html += '<div class="element-card-desc">' + escapeHtml(el.description || '-') + '</div>';
  html += '<div class="element-card-details">';
  html += '<span class="tag-badge">' + tagDisplay + '</span> ';
  html += caps;
  html += '</div>';
  if (stateStr) {
    html += '<div class="element-card-state">' + stateStr + '</div>';
  }
  html += '</div>';
  html += '</div>';
  return html;
}

// ── Render element group (collapsible) ──
function renderElementGroup(category, defaultExpanded) {
  const collapsed = defaultExpanded ? '' : ' collapsed';
  let html = '<div class="element-group' + collapsed + '">';
  html += '<div class="element-group-header">';
  html += chevronIcon(!defaultExpanded);
  html += '<span class="element-group-title">' + escapeHtml(category.label) + '</span>';
  html += '<span class="element-group-count">' + category.items.length + '</span>';
  html += '</div>';
  html += '<div class="element-group-items">';
  for (const el of category.items) {
    html += renderElementCard(el);
  }
  html += '</div></div>';
  return html;
}

// ── Main render ──
export function renderAnalysis() {
  const { analysisPanel } = getDomRefs();
  const scanEvents = getScanEvents(state.selectedSessionId);
  const allEvents = getSessionEvents(state.selectedSessionId);

  if (scanEvents.length === 0) {
    analysisPanel.innerHTML = '<div class="analysis-empty">No scan data yet for this session</div>';
    return;
  }

  // Determine which scan to show
  const idx = state.selectedScanIndex < 0 ? scanEvents.length - 1 : Math.min(state.selectedScanIndex, scanEvents.length - 1);
  const scan = scanEvents[idx].data;

  let html = '';

  // ── 1. Session Summary Card ──
  const pages = groupScansByPage(scanEvents);
  const distinctUrls = new Set(scanEvents.map(se => se.data.url || '')).size;
  const interactive = Array.isArray(scan.interactiveElements) ? scan.interactiveElements : [];
  const forms = Array.isArray(scan.forms) ? scan.forms : [];
  const textEvents = allEvents.filter(e => e.type === 'text').length;
  const toolCallEvents = allEvents.filter(e => e.type === 'toolCall').length;

  // Session duration
  let duration = '';
  if (allEvents.length > 1) {
    const first = allEvents[0].timestamp;
    const last = allEvents[allEvents.length - 1].timestamp;
    duration = formatDuration(last - first);
  }

  const stats = [];
  if (distinctUrls > 0) stats.push({ value: distinctUrls, label: 'Pages', accent: 'accent-blue' });
  if (interactive.length > 0) stats.push({ value: interactive.length, label: 'Interactive', accent: 'accent-purple' });
  if (forms.length > 0) stats.push({ value: forms.length, label: 'Form Fields', accent: 'accent-green' });
  if (textEvents > 0) stats.push({ value: textEvents, label: 'Messages', accent: 'accent-cyan' });
  if (toolCallEvents > 0) stats.push({ value: toolCallEvents, label: 'Tool Calls', accent: 'accent-orange' });
  if (duration) stats.push({ value: duration, label: 'Duration', accent: '' });

  if (stats.length > 0) {
    html += '<div class="session-summary-card">';
    for (const s of stats) {
      html += '<div class="summary-stat ' + s.accent + '">';
      html += '<div class="summary-stat-value">' + s.value + '</div>';
      html += '<div class="summary-stat-label">' + s.label + '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  // ── 2. Vertical Page Journey ──
  if (pages.length > 1) {
    html += '<div class="analysis-section">';
    html += '<div class="analysis-section-title">Page Journey (' + pages.length + ' pages)</div>';
    html += '<div class="page-journey">';

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const isActive = scanEvents.indexOf(page.scans[page.scans.length - 1]) === idx ||
        (page.scans.some((se, si) => scanEvents.indexOf(se) === idx));

      let displayUrl = page.url;
      try {
        if (page.url) displayUrl = new URL(page.url).pathname || '/';
      } catch {}

      const elCount = page.scans[page.scans.length - 1].data.interactiveElements
        ? page.scans[page.scans.length - 1].data.interactiveElements.length : 0;
      const hCount = page.scans[page.scans.length - 1].data.headings
        ? page.scans[page.scans.length - 1].data.headings.length : 0;

      const metaParts = [];
      if (elCount > 0) metaParts.push(elCount + ' elements');
      if (hCount > 0) metaParts.push(hCount + ' headings');

      const timeRange = formatTime(page.firstTime) +
        (page.lastTime !== page.firstTime ? ' - ' + formatTime(page.lastTime) : '');

      // URL change indicator between pages
      if (i > 0) {
        html += '<div class="page-journey-change">';
        html += '<svg viewBox="0 0 10 10"><path d="M5 0v10M2 7l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        html += ' URL changed';
        html += '</div>';
      }

      // Find the scan index for the latest scan in this page group
      const latestScanIdx = scanEvents.indexOf(page.scans[page.scans.length - 1]);

      html += '<div class="page-journey-card' + (isActive ? ' active' : '') + '" data-page-scan-idx="' + latestScanIdx + '">';
      html += '<div class="page-journey-dot"></div>';
      html += '<div class="page-journey-url">' + escapeHtml(displayUrl) + '</div>';
      html += '<div class="page-journey-meta">';
      if (metaParts.length > 0) html += '<span>' + metaParts.join(', ') + '</span>';
      html += '<span>' + timeRange + '</span>';

      // Element count delta from previous page
      if (i > 0) {
        const prevPage = pages[i - 1];
        const prevElCount = prevPage.scans[prevPage.scans.length - 1].data.interactiveElements
          ? prevPage.scans[prevPage.scans.length - 1].data.interactiveElements.length : 0;
        const delta = elCount - prevElCount;
        if (delta !== 0) {
          html += '<span class="page-journey-delta">' + (delta > 0 ? '+' : '') + delta + ' elements</span>';
        }
      }
      html += '</div>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  // ── 3. Page Info Bar ──
  if (scan.title || scan.url) {
    html += '<div class="page-info-bar">';
    if (scan.title) html += '<span class="page-title">' + escapeHtml(scan.title) + '</span>';
    if (scan.title && scan.url) html += '<span class="separator">|</span>';
    if (scan.url) html += '<span class="page-url">' + escapeHtml(scan.url) + '</span>';
    if (scan.description) {
      html += '<span class="separator">|</span>';
      html += '<span style="color:var(--text-muted);font-size:11px">' + escapeHtml(scan.description) + '</span>';
    }
    html += '</div>';
  }

  // ── 4. Grouped Interactive Elements ──
  if (interactive.length > 0) {
    html += '<div class="analysis-section">';
    html += '<div class="analysis-section-title">Interactive Elements (' + interactive.length + ')</div>';

    const categories = groupElementsByCategory(interactive);
    for (let i = 0; i < categories.length; i++) {
      const expanded = i < 2; // First two non-empty groups expanded
      html += renderElementGroup(categories[i], expanded);
    }

    html += '</div>';
  }

  // ── 5. Form Fields Table ──
  if (forms.length > 0) {
    html += '<div class="analysis-section">';
    html += '<div class="analysis-section-title">Form Fields (' + forms.length + ')</div>';
    html += '<div class="table-container"><table class="data-table">';
    html += '<thead><tr><th>ID</th><th>Type</th><th>Label</th><th>Required</th><th>Value</th><th>Placeholder</th></tr></thead>';
    html += '<tbody>';
    for (const f of forms) {
      const reqBadge = f.required
        ? '<span class="badge badge-green">Yes</span>'
        : '<span class="badge badge-dim">No</span>';
      const disabledBadge = f.disabled ? ' <span class="badge badge-red">disabled</span>' : '';
      html += '<tr>';
      html += '<td class="mono">' + escapeHtml(f.id || f.name || '-') + '</td>';
      html += '<td><span class="badge badge-blue">' + escapeHtml(f.type || 'text') + '</span></td>';
      html += '<td>' + escapeHtml(f.label || '-') + '</td>';
      html += '<td>' + reqBadge + disabledBadge + '</td>';
      html += '<td>' + escapeHtml(f.value || '-') + '</td>';
      html += '<td style="color:var(--text-faint)">' + escapeHtml(f.placeholder || '-') + '</td>';
      html += '</tr>';
      if (f.options && f.options.length > 0) {
        html += '<tr><td></td><td colspan="5" style="color:var(--text-muted);font-size:11px">Options: ' + f.options.map(o => escapeHtml(o)).join(', ') + '</td></tr>';
      }
    }
    html += '</tbody></table></div></div>';
  }

  // ── 6. Page Outline / Headings ──
  const headings = Array.isArray(scan.headings) ? scan.headings : [];
  if (headings.length > 0) {
    html += '<div class="analysis-section">';
    html += '<div class="analysis-section-title">Page Outline (' + headings.length + ')</div>';
    html += '<div class="heading-tree">';
    for (const h of headings) {
      const indent = (h.level - 1) * 20;
      html += '<div class="heading-item" style="padding-left:' + indent + 'px">';
      html += '<span class="heading-level">H' + h.level + '</span>';
      html += escapeHtml(h.text);
      html += '</div>';
    }
    html += '</div></div>';
  }

  analysisPanel.innerHTML = html;

  // ── Wire up page journey clicks ──
  analysisPanel.querySelectorAll('.page-journey-card[data-page-scan-idx]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedScanIndex = parseInt(el.dataset.pageScanIdx, 10);
      renderAnalysis();
    });
  });

  // ── Wire up element group collapse/expand ──
  analysisPanel.querySelectorAll('.element-group-header').forEach(header => {
    header.addEventListener('click', () => {
      const group = header.parentElement;
      group.classList.toggle('collapsed');
      const chev = header.querySelector('.chevron');
      if (chev) {
        chev.style.transform = group.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
      }
    });
  });
}

// Register renderer
renderers.renderAnalysis = renderAnalysis;

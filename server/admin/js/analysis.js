import { state, getDomRefs, renderers } from './state.js';
import { escapeHtml, formatTime, formatDuration, chevronIcon } from './utils.js';

let currentSearchQuery = '';
let searchTimeout = null;
let screenshotRequestId = 0;

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

// ── Build search text for an element ──
function buildElementSearchText(el) {
  const parts = [el.description, el.tagName, el.role];
  if (Array.isArray(el.capabilities)) parts.push(...el.capabilities);
  if (el.state) {
    for (const [k, v] of Object.entries(el.state)) {
      parts.push(k, String(v));
    }
  }
  if (el.selector) parts.push(el.selector);
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function buildFormSearchText(f) {
  const parts = [f.id, f.name, f.type, f.label, f.value, f.placeholder];
  if (f.options) parts.push(...f.options);
  return parts.filter(Boolean).join(' ').toLowerCase();
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
  const indexBadge = el.index != null
    ? '<span class="element-index-badge">' + el.index + '</span>'
    : '';

  const searchText = buildElementSearchText(el);

  let html = '<div class="element-card" data-search-text="' + escapeHtml(searchText) + '">';
  if (vpDot) {
    html += '<div class="element-card-viewport">' + vpDot + '</div>';
  }
  html += '<div class="element-card-body">';
  html += '<div class="element-card-desc">' + indexBadge + escapeHtml(el.description || '-') + '</div>';
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

// ── Search bar HTML ──
function renderSearchBar() {
  return '<div class="search-bar">' +
    '<div class="search-input-wrapper">' +
      '<svg class="search-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">' +
        '<path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04z"/>' +
      '</svg>' +
      '<input class="search-input" type="text" placeholder="Search elements, forms, headings\u2026  ( / )" />' +
      '<button class="search-clear" title="Clear search">&times;</button>' +
    '</div>' +
    '<div class="search-results-summary"></div>' +
  '</div>';
}

// ── Search highlighting ──
function highlightInTextEl(el, query) {
  const text = el._origText !== undefined ? el._origText : el.textContent;
  el._origText = text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();

  let result = '';
  let lastIdx = 0;
  let pos = lower.indexOf(q);
  while (pos >= 0) {
    result += escapeHtml(text.substring(lastIdx, pos));
    result += '<mark>' + escapeHtml(text.substring(pos, pos + q.length)) + '</mark>';
    lastIdx = pos + q.length;
    pos = lower.indexOf(q, lastIdx);
  }
  result += escapeHtml(text.substring(lastIdx));
  el.innerHTML = result;
}

function clearHighlight(el) {
  if (el._origText !== undefined) {
    el.textContent = el._origText;
    delete el._origText;
  }
}

function highlightHeadingItem(el, query) {
  const levelSpan = el.querySelector('.heading-level');
  const levelHtml = levelSpan ? levelSpan.outerHTML : '';
  // Extract text after the heading level span
  const rawText = el._origHeadingText !== undefined ? el._origHeadingText : el.textContent.replace(/^H\d\s*/, '');
  el._origHeadingText = rawText;

  const lower = rawText.toLowerCase();
  const q = query.toLowerCase();
  let result = '';
  let lastIdx = 0;
  let pos = lower.indexOf(q);
  while (pos >= 0) {
    result += escapeHtml(rawText.substring(lastIdx, pos));
    result += '<mark>' + escapeHtml(rawText.substring(pos, pos + q.length)) + '</mark>';
    lastIdx = pos + q.length;
    pos = lower.indexOf(q, lastIdx);
  }
  result += escapeHtml(rawText.substring(lastIdx));
  el.innerHTML = levelHtml + result;
}

function clearHeadingHighlight(el) {
  if (el._origHeadingText !== undefined) {
    const levelSpan = el.querySelector('.heading-level');
    const levelHtml = levelSpan ? levelSpan.outerHTML : '';
    el.innerHTML = levelHtml + escapeHtml(el._origHeadingText);
    delete el._origHeadingText;
  }
}

// ── Cross-scan search ──
function searchCrossScans(query) {
  const scanEvents = getScanEvents(state.selectedSessionId);
  const currentIdx = state.selectedScanIndex < 0 ? scanEvents.length - 1 : Math.min(state.selectedScanIndex, scanEvents.length - 1);
  const results = [];

  for (let i = 0; i < scanEvents.length; i++) {
    if (i === currentIdx) continue;
    const scan = scanEvents[i].data;
    let matchCount = 0;

    if (Array.isArray(scan.interactiveElements)) {
      for (const el of scan.interactiveElements) {
        if (buildElementSearchText(el).includes(query)) matchCount++;
      }
    }
    if (Array.isArray(scan.forms)) {
      for (const f of scan.forms) {
        if (buildFormSearchText(f).includes(query)) matchCount++;
      }
    }
    if (Array.isArray(scan.headings)) {
      for (const h of scan.headings) {
        if ((h.text || '').toLowerCase().includes(query)) matchCount++;
      }
    }

    if (matchCount > 0) {
      let displayUrl = scan.url || 'unknown';
      try { if (scan.url) displayUrl = new URL(scan.url).pathname || '/'; } catch {}
      results.push({ scanIdx: i, displayUrl, matchCount, timestamp: scanEvents[i].timestamp });
    }
  }

  return results;
}

// ── Apply search ──
function applySearch(query) {
  const { analysisPanel } = getDomRefs();
  const q = query.trim().toLowerCase();
  currentSearchQuery = query.trim();

  const summaryEl = analysisPanel.querySelector('.search-results-summary');
  const clearBtn = analysisPanel.querySelector('.search-clear');
  if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';

  // Clear all search state
  analysisPanel.querySelectorAll('.search-hidden').forEach(el => el.classList.remove('search-hidden'));

  // Clear highlights
  analysisPanel.querySelectorAll('.element-card-desc').forEach(clearHighlight);
  analysisPanel.querySelectorAll('.heading-item').forEach(clearHeadingHighlight);

  // Restore element group counts
  analysisPanel.querySelectorAll('.element-group').forEach(group => {
    const countEl = group.querySelector('.element-group-count');
    if (countEl && countEl._origCount !== undefined) {
      countEl.textContent = countEl._origCount;
      delete countEl._origCount;
    }
  });

  // Restore section visibility
  analysisPanel.querySelectorAll('.analysis-section.search-hidden-section').forEach(s => {
    s.classList.remove('search-hidden-section');
  });

  if (!q) {
    if (summaryEl) summaryEl.innerHTML = '';
    return;
  }

  // Search through all searchable elements
  const searchableEls = analysisPanel.querySelectorAll('[data-search-text]');
  const sectionMatches = new Map(); // section title -> count

  for (const el of searchableEls) {
    const text = el.dataset.searchText;
    if (text.includes(q)) {
      // Find parent section title
      const section = el.closest('.analysis-section');
      if (section) {
        const titleEl = section.querySelector('.analysis-section-title');
        const title = titleEl ? titleEl.textContent : 'Other';
        sectionMatches.set(title, (sectionMatches.get(title) || 0) + 1);
      }

      // Auto-expand parent element group
      const group = el.closest('.element-group');
      if (group && group.classList.contains('collapsed')) {
        group.classList.remove('collapsed');
        const chev = group.querySelector('.chevron');
        if (chev) chev.style.transform = 'rotate(0deg)';
      }

      // Highlight matching text
      const desc = el.querySelector('.element-card-desc');
      if (desc) highlightInTextEl(desc, q);
      if (el.classList.contains('heading-item')) highlightHeadingItem(el, q);
    } else {
      el.classList.add('search-hidden');
    }
  }

  // Update element group visibility and counts
  analysisPanel.querySelectorAll('.element-group').forEach(group => {
    const allCards = group.querySelectorAll('.element-card');
    const visibleCards = group.querySelectorAll('.element-card:not(.search-hidden)');
    if (visibleCards.length === 0) {
      group.classList.add('search-hidden');
    } else {
      group.classList.remove('search-hidden');
      const countEl = group.querySelector('.element-group-count');
      if (countEl) {
        if (countEl._origCount === undefined) countEl._origCount = countEl.textContent;
        countEl.textContent = visibleCards.length + '/' + allCards.length;
      }
    }
  });

  // Hide sections with no visible searchable items
  analysisPanel.querySelectorAll('.analysis-section').forEach(section => {
    const searchables = section.querySelectorAll('[data-search-text]');
    if (searchables.length === 0) return; // Section has no searchable items (e.g., page journey)
    const visible = section.querySelectorAll('[data-search-text]:not(.search-hidden)');
    // Also check element-groups (which may contain visible cards)
    const visibleGroups = section.querySelectorAll('.element-group:not(.search-hidden)');
    if (visible.length === 0 && visibleGroups.length === 0) {
      section.classList.add('search-hidden-section');
    }
  });

  // Hide form table rows that don't match — also check table-container
  analysisPanel.querySelectorAll('.table-container').forEach(container => {
    const rows = container.querySelectorAll('tbody tr[data-search-text]');
    const visibleRows = container.querySelectorAll('tbody tr[data-search-text]:not(.search-hidden)');
    if (rows.length > 0 && visibleRows.length === 0) {
      container.classList.add('search-hidden');
    } else {
      container.classList.remove('search-hidden');
    }
  });

  // Cross-scan search
  const crossScanResults = searchCrossScans(q);
  const totalMatches = Array.from(sectionMatches.values()).reduce((a, b) => a + b, 0);

  // Build summary HTML
  let summaryHtml = '';

  if (totalMatches > 0) {
    const parts = [];
    for (const [section, count] of sectionMatches) {
      parts.push('<strong>' + count + '</strong> in ' + escapeHtml(section));
    }
    summaryHtml = '<div class="search-match-info">' +
      '<span class="search-match-count">' + totalMatches + ' match' + (totalMatches !== 1 ? 'es' : '') + '</span>' +
      ' &mdash; ' + parts.join(', ') +
    '</div>';
  } else {
    summaryHtml = '<div class="search-no-match">' +
      '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="vertical-align:-1px;margin-right:4px">' +
        '<path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm9-3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM8 6.5a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4A.75.75 0 0 1 8 6.5z"/>' +
      '</svg>';
    if (crossScanResults.length > 0) {
      summaryHtml += 'Not found in this scan';
    } else {
      summaryHtml += 'Not found in any scan &mdash; the page scanner may not detect this element';
    }
    summaryHtml += '</div>';
  }

  if (crossScanResults.length > 0) {
    summaryHtml += '<div class="search-cross-scan">Also found in: ';
    summaryHtml += crossScanResults.map(r =>
      '<button class="search-cross-link" data-scan-idx="' + r.scanIdx + '" title="Switch to this scan">' +
        escapeHtml(r.displayUrl) + ' <span class="search-cross-count">(' + r.matchCount + ')</span>' +
      '</button>'
    ).join(' ');
    summaryHtml += '</div>';
  }

  if (summaryEl) {
    summaryEl.innerHTML = summaryHtml;

    // Wire cross-scan clicks
    summaryEl.querySelectorAll('.search-cross-link[data-scan-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedScanIndex = parseInt(btn.dataset.scanIdx, 10);
        renderAnalysis(); // currentSearchQuery is preserved and re-applied automatically
      });
    });
  }
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

  // ── Search Bar ──
  html += renderSearchBar();

  // ── 2. Vertical Page Journey ──
  if (pages.length > 1) {
    html += '<div class="analysis-section">';
    html += '<div class="analysis-section-title">Page Journey (' + pages.length + ' pages)</div>';
    html += '<div class="page-journey">';

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const isActive = page.scans.some(se => scanEvents.indexOf(se) === idx);

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

      if (i > 0) {
        html += '<div class="page-journey-change">';
        html += '<svg viewBox="0 0 10 10"><path d="M5 0v10M2 7l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        html += ' URL changed';
        html += '</div>';
      }

      const latestScanIdx = scanEvents.indexOf(page.scans[page.scans.length - 1]);

      html += '<div class="page-journey-card' + (isActive ? ' active' : '') + '" data-page-scan-idx="' + latestScanIdx + '">';
      html += '<div class="page-journey-dot"></div>';
      html += '<div class="page-journey-url">' + escapeHtml(displayUrl) + '</div>';
      html += '<div class="page-journey-meta">';
      if (metaParts.length > 0) html += '<span>' + metaParts.join(', ') + '</span>';
      html += '<span>' + timeRange + '</span>';

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
    // Refresh screenshot button — only show when session is connected
    const sessionData = state.sessions.has(state.selectedSessionId) ? state.sessions.get(state.selectedSessionId) : null;
    const sessionMeta = sessionData ? sessionData.meta : null;
    if (sessionMeta && !sessionMeta.disconnected) {
      html += '<button class="screenshot-btn" title="Refresh screenshot from client browser">';
      html += '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M10.5 0a.5.5 0 0 0 0 1h.793l-2.147 2.146a.5.5 0 0 0 .708.708L12 1.707V2.5a.5.5 0 0 0 1 0v-2a.5.5 0 0 0-.5-.5h-2zM1 7.5A.5.5 0 0 1 1.5 7H5a.5.5 0 0 1 0 1H1.5A.5.5 0 0 1 1 7.5zm0 3A.5.5 0 0 1 1.5 10H5a.5.5 0 0 1 0 1H1.5a.5.5 0 0 1-.5-.5zm.146-6.354a.5.5 0 0 1 .708 0L4 6.293V5.5a.5.5 0 0 1 1 0v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h.793L1.146 4.854a.5.5 0 0 1 0-.708z"/></svg>';
      html += ' Refresh';
      html += '</button>';
    }
    html += '</div>';

    // Show existing screenshot if we have one for this URL
    const existingScreenshot = sessionData && sessionData.screenshots && scan.url
      ? sessionData.screenshots[scan.url] : null;
    if (existingScreenshot) {
      html += '<div class="page-screenshot-container"><img class="page-screenshot" src="data:image/jpeg;base64,' + existingScreenshot + '" alt="Page screenshot" /></div>';
    } else {
      html += '<div class="page-screenshot-container"></div>';
    }
  }

  // ── 4. Grouped Interactive Elements ──
  if (interactive.length > 0) {
    html += '<div class="analysis-section">';
    html += '<div class="analysis-section-title">Interactive Elements (' + interactive.length + ')</div>';

    const categories = groupElementsByCategory(interactive);
    for (let i = 0; i < categories.length; i++) {
      const expanded = i < 2;
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
      const searchText = buildFormSearchText(f);
      html += '<tr data-search-text="' + escapeHtml(searchText) + '">';
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
      const searchText = ('h' + h.level + ' ' + (h.text || '')).toLowerCase();
      html += '<div class="heading-item" data-search-text="' + escapeHtml(searchText) + '" style="padding-left:' + indent + 'px">';
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

  // ── Wire up search ──
  const searchInput = analysisPanel.querySelector('.search-input');
  const searchClearBtn = analysisPanel.querySelector('.search-clear');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => applySearch(e.target.value), 150);
    });

    // Clear button
    if (searchClearBtn) {
      searchClearBtn.style.display = 'none';
      searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        currentSearchQuery = '';
        applySearch('');
        searchInput.focus();
      });
    }

    // Restore previous search query after re-render
    if (currentSearchQuery) {
      searchInput.value = currentSearchQuery;
      applySearch(currentSearchQuery);
    }
  }

  // ── Wire up screenshot lightbox ──
  analysisPanel.querySelectorAll('.page-screenshot').forEach(img => {
    img.addEventListener('click', () => openScreenshotLightbox(img.src));
  });

  // ── Wire up screenshot button ──
  const screenshotBtn = analysisPanel.querySelector('.screenshot-btn');
  if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
      if (!state.selectedSessionId || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      screenshotBtn.disabled = true;
      screenshotBtn.textContent = 'Capturing...';
      screenshotRequestId++;
      state.ws.send(JSON.stringify({
        type: 'screenshot.request',
        sessionId: state.selectedSessionId,
        requestId: String(screenshotRequestId),
      }));
    });
  }

  // Keyboard shortcut: / to focus search (when not in input)
  if (!analysisPanel._searchKeyBound) {
    analysisPanel._searchKeyBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
        const input = analysisPanel.querySelector('.search-input');
        if (input && analysisPanel.classList.contains('visible')) {
          e.preventDefault();
          input.focus();
        }
      }
      // Escape to clear search
      if (e.key === 'Escape') {
        const input = analysisPanel.querySelector('.search-input');
        if (input && document.activeElement === input && input.value) {
          input.value = '';
          currentSearchQuery = '';
          applySearch('');
        }
      }
    });
  }
}

// ── Screenshot handlers ──

function handleScreenshotResult(msg) {
  const { analysisPanel } = getDomRefs();
  const container = analysisPanel.querySelector('.page-screenshot-container');
  if (!container) return;

  container.innerHTML = '<img class="page-screenshot" src="data:image/jpeg;base64,' + msg.image + '" alt="Page screenshot" />';
  container.querySelector('.page-screenshot').addEventListener('click', function () {
    openScreenshotLightbox(this.src);
  });

  // Reset refresh button
  resetScreenshotBtn();
}

function handleScreenshotError(msg) {
  // Only show error for on-demand requests (has requestId)
  if (!msg.requestId) return;

  const { analysisPanel } = getDomRefs();
  const container = analysisPanel.querySelector('.page-screenshot-container');
  if (container) {
    container.innerHTML = '<div class="screenshot-error">Screenshot failed: ' + escapeHtml(msg.error || 'Unknown error') + '</div>';
  }

  resetScreenshotBtn();
}

function resetScreenshotBtn() {
  const { analysisPanel } = getDomRefs();
  const btn = analysisPanel.querySelector('.screenshot-btn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M10.5 0a.5.5 0 0 0 0 1h.793l-2.147 2.146a.5.5 0 0 0 .708.708L12 1.707V2.5a.5.5 0 0 0 1 0v-2a.5.5 0 0 0-.5-.5h-2zM1 7.5A.5.5 0 0 1 1.5 7H5a.5.5 0 0 1 0 1H1.5A.5.5 0 0 1 1 7.5zm0 3A.5.5 0 0 1 1.5 10H5a.5.5 0 0 1 0 1H1.5a.5.5 0 0 1-.5-.5zm.146-6.354a.5.5 0 0 1 .708 0L4 6.293V5.5a.5.5 0 0 1 1 0v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h.793L1.146 4.854a.5.5 0 0 1 0-.708z"/></svg> Refresh';
  }
}

// ── Screenshot lightbox ──

function openScreenshotLightbox(src) {
  const overlay = document.createElement('div');
  overlay.className = 'screenshot-lightbox';
  overlay.innerHTML = '<img src="' + src + '" alt="Screenshot preview" />';

  const close = () => overlay.remove();
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  document.body.appendChild(overlay);
}

// Register renderer and screenshot handlers
renderers.renderAnalysis = renderAnalysis;
renderers.handleScreenshotResult = handleScreenshotResult;
renderers.handleScreenshotError = handleScreenshotError;

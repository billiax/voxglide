import { state, getDomRefs, renderers } from './state.js';
import { escapeHtml, formatDuration, formatTime } from './utils.js';

// ── Aggregation ──

function getAllEvents() {
  const all = [];
  for (const [sessionId, session] of state.sessions) {
    for (const event of session.events) {
      all.push({ ...event, sessionId });
    }
  }
  return all;
}

function aggregateAllSessions() {
  let totalMessages = 0;
  let totalToolCalls = 0;
  let totalErrors = 0;
  let activeNow = 0;
  const durations = [];

  for (const session of state.sessions.values()) {
    const meta = session.meta;
    const events = session.events;
    if (!meta.disconnected) activeNow++;

    for (const ev of events) {
      if (ev.type === 'text') totalMessages++;
      if (ev.type === 'toolCall' && ev.data?.functionCalls) {
        totalToolCalls += ev.data.functionCalls.length;
      }
      if (ev.type === 'error') totalErrors++;
    }

    if (events.length >= 2) {
      const first = events[0].timestamp;
      const last = events[events.length - 1].timestamp;
      durations.push(last - first);
    }
  }

  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  return {
    totalSessions: state.sessions.size,
    activeNow,
    totalMessages,
    totalToolCalls,
    avgDuration,
    totalErrors,
  };
}

function computeToolMetrics(allEvents) {
  const tools = new Map(); // toolName -> { calls, successes, failures, totalTimeMs }

  // Index toolCall events by turnId for timing
  const toolCallTimestamps = new Map(); // turnId -> timestamp

  for (const ev of allEvents) {
    if (ev.type === 'toolCall' && ev.data?.functionCalls) {
      if (ev.data.turnId) {
        toolCallTimestamps.set(ev.data.turnId, ev.timestamp);
      }
      for (const fc of ev.data.functionCalls) {
        if (!tools.has(fc.name)) {
          tools.set(fc.name, { calls: 0, successes: 0, failures: 0, totalTimeMs: 0, timings: 0 });
        }
        tools.get(fc.name).calls++;
      }
    }

    if (ev.type === 'toolResult' && ev.data?.responses) {
      const turnCallTs = ev.data.turnId ? toolCallTimestamps.get(ev.data.turnId) : null;

      for (const resp of ev.data.responses) {
        const name = resp.name;
        if (!name) continue;
        if (!tools.has(name)) {
          tools.set(name, { calls: 0, successes: 0, failures: 0, totalTimeMs: 0, timings: 0 });
        }
        const tool = tools.get(name);

        // Check success/failure
        let isError = false;
        try {
          const result = typeof resp.response?.result === 'string'
            ? JSON.parse(resp.response.result)
            : resp.response?.result;
          if (result && result.error) isError = true;
        } catch {
          // Non-JSON result — treat as success
        }
        if (isError) tool.failures++;
        else tool.successes++;

        // Compute timing from toolCall to toolResult
        if (turnCallTs) {
          const dt = ev.timestamp - turnCallTs;
          if (dt >= 0 && dt < 60000) { // sanity: under 60s
            tool.totalTimeMs += dt;
            tool.timings++;
          }
        }
      }
    }
  }

  // Sort by call count descending
  return Array.from(tools.entries())
    .map(([name, data]) => ({
      name,
      ...data,
      avgTimeMs: data.timings > 0 ? Math.round(data.totalTimeMs / data.timings) : null,
    }))
    .sort((a, b) => b.calls - a.calls);
}

function computeResponseTimes(allEvents) {
  // Group events by sessionId
  const bySession = new Map();
  for (const ev of allEvents) {
    if (!bySession.has(ev.sessionId)) bySession.set(ev.sessionId, []);
    bySession.get(ev.sessionId).push(ev);
  }

  const times = [];

  for (const events of bySession.values()) {
    // Sort by timestamp
    const sorted = events.slice().sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].type !== 'text') continue;
      const textEv = sorted[i];
      const turnId = textEv.data?.turnId;

      // Find first response or toolCall after this text event
      let responseTs = null;
      for (let j = i + 1; j < sorted.length; j++) {
        const candidate = sorted[j];
        // If we hit another text event, stop searching
        if (candidate.type === 'text') break;

        if (candidate.type === 'response' || candidate.type === 'toolCall') {
          // Match by turnId if available
          if (turnId && candidate.data?.turnId) {
            if (candidate.data.turnId === turnId) {
              responseTs = candidate.timestamp;
              break;
            }
          } else {
            // Positional fallback: first response/toolCall after text
            responseTs = candidate.timestamp;
            break;
          }
        }
      }

      if (responseTs !== null) {
        const dt = responseTs - textEv.timestamp;
        if (dt >= 0 && dt < 120000) { // sanity: under 2 min
          times.push({
            turnId: turnId || null,
            responseTimeMs: dt,
            timestamp: textEv.timestamp,
          });
        }
      }
    }
  }

  return times;
}

function computeResponseTimeStats(times) {
  if (times.length === 0) return null;
  const ms = times.map(t => t.responseTimeMs).sort((a, b) => a - b);
  const avg = Math.round(ms.reduce((a, b) => a + b, 0) / ms.length);
  const min = ms[0];
  const max = ms[ms.length - 1];
  const median = ms.length % 2 === 0
    ? Math.round((ms[ms.length / 2 - 1] + ms[ms.length / 2]) / 2)
    : ms[Math.floor(ms.length / 2)];
  return { avg, min, max, median, count: ms.length };
}

function computeTokenUsage(allEvents) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalTokens = 0;
  let sessionCount = 0;
  const seenSessions = new Set();

  for (const ev of allEvents) {
    if (ev.type !== 'usage') continue;
    totalInput += ev.data?.inputTokens || 0;
    totalOutput += ev.data?.outputTokens || 0;
    totalTokens += ev.data?.totalTokens || 0;
    seenSessions.add(ev.sessionId);
  }

  sessionCount = seenSessions.size;
  const perSessionAvg = sessionCount > 0 ? Math.round(totalTokens / sessionCount) : 0;

  return { totalInput, totalOutput, totalTokens, perSessionAvg, hasData: totalTokens > 0 };
}

function computeTopQueries(allEvents) {
  const counts = new Map();
  for (const ev of allEvents) {
    if (ev.type !== 'text' || !ev.data?.text) continue;
    const key = ev.data.text.trim().toLowerCase();
    if (!key) continue;
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { text: ev.data.text.trim(), count: 1 });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

function computeErrorBreakdown(allEvents) {
  const groups = new Map();
  for (const ev of allEvents) {
    if (ev.type !== 'error') continue;
    const msg = ev.data?.message || 'Unknown error';
    const existing = groups.get(msg);
    if (existing) {
      existing.count++;
      existing.lastTimestamp = Math.max(existing.lastTimestamp, ev.timestamp);
    } else {
      groups.set(msg, { message: msg, count: 1, lastTimestamp: ev.timestamp });
    }
  }
  return Array.from(groups.values())
    .sort((a, b) => b.count - a.count);
}

// ── Rendering ──

function formatSeconds(ms) {
  return (ms / 1000).toFixed(1) + 's';
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function rateClass(rate) {
  if (rate >= 90) return 'rate-green';
  if (rate >= 70) return 'rate-amber';
  return 'rate-red';
}

function timeClass(ms) {
  if (ms < 2000) return 'time-green';
  if (ms < 5000) return 'time-amber';
  return 'time-red';
}

function renderOverviewStats(data) {
  let html = '<div class="analytics-stats-bar">';
  html += '<div class="analytics-stat accent-blue"><div class="analytics-stat-value">' + data.totalSessions + '</div><div class="analytics-stat-label">Sessions</div></div>';
  html += '<div class="analytics-stat accent-green"><div class="analytics-stat-value">' + data.activeNow + '</div><div class="analytics-stat-label">Active Now</div></div>';
  html += '<div class="analytics-stat accent-cyan"><div class="analytics-stat-value">' + data.totalMessages + '</div><div class="analytics-stat-label">Messages</div></div>';
  html += '<div class="analytics-stat accent-purple"><div class="analytics-stat-value">' + data.totalToolCalls + '</div><div class="analytics-stat-label">Tool Calls</div></div>';
  html += '<div class="analytics-stat"><div class="analytics-stat-value">' + (data.avgDuration > 0 ? formatDuration(data.avgDuration) : '-') + '</div><div class="analytics-stat-label">Avg Duration</div></div>';
  if (data.totalErrors > 0) {
    html += '<div class="analytics-stat accent-red"><div class="analytics-stat-value">' + data.totalErrors + '</div><div class="analytics-stat-label">Errors</div></div>';
  }
  html += '</div>';
  return html;
}

function renderToolPerformance(toolMetrics) {
  if (toolMetrics.length === 0) {
    return '<div class="analytics-empty-section">No tool calls recorded</div>';
  }

  const totalCalls = toolMetrics.reduce((a, t) => a + t.calls, 0);
  const totalSuccesses = toolMetrics.reduce((a, t) => a + t.successes, 0);
  const totalFailures = toolMetrics.reduce((a, t) => a + t.failures, 0);
  const totalResolved = totalSuccesses + totalFailures;
  const overallRate = totalResolved > 0 ? Math.round((totalSuccesses / totalResolved) * 100) : 100;
  const maxCalls = toolMetrics[0].calls;

  let html = '<div class="analytics-overall-rate">';
  html += '<strong class="' + rateClass(overallRate) + '">' + overallRate + '%</strong>';
  html += ' success rate across ' + totalCalls + ' call' + (totalCalls !== 1 ? 's' : '');
  html += '</div>';

  html += '<div class="analytics-tool-list">';
  for (const tool of toolMetrics) {
    const resolved = tool.successes + tool.failures;
    const rate = resolved > 0 ? Math.round((tool.successes / resolved) * 100) : 100;
    const barWidth = maxCalls > 0 ? Math.round((tool.calls / maxCalls) * 100) : 0;
    const greenWidth = resolved > 0 ? Math.round((tool.successes / resolved) * barWidth) : barWidth;
    const redWidth = barWidth - greenWidth;

    html += '<div class="analytics-tool-item">';
    html += '<div class="analytics-tool-header">';
    html += '<span class="analytics-tool-name">' + escapeHtml(tool.name) + '</span>';
    html += '<span class="analytics-tool-count">' + tool.calls + ' call' + (tool.calls !== 1 ? 's' : '') + '</span>';
    if (resolved > 0) {
      html += '<span class="analytics-rate-badge ' + rateClass(rate) + '">' + rate + '%</span>';
    }
    html += '</div>';

    html += '<div class="analytics-bar-track">';
    if (greenWidth > 0) html += '<div class="analytics-bar-fill bar-green" style="width:' + greenWidth + '%"></div>';
    if (redWidth > 0) html += '<div class="analytics-bar-fill bar-red" style="width:' + redWidth + '%"></div>';
    html += '</div>';

    const parts = [];
    if (tool.successes > 0) parts.push(tool.successes + ' success');
    if (tool.failures > 0) parts.push(tool.failures + ' failed');
    if (tool.avgTimeMs !== null) parts.push('avg ' + tool.avgTimeMs + 'ms');
    html += '<div class="analytics-tool-detail">' + parts.join(' · ') + '</div>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderResponseTimes(times) {
  const stats = computeResponseTimeStats(times);
  if (!stats) {
    return '<div class="analytics-empty-section">No response time data</div>';
  }

  let html = '<div class="analytics-response-stats">';
  html += '<div class="analytics-response-stat"><div class="analytics-response-stat-value">' + formatSeconds(stats.avg) + '</div><div class="analytics-response-stat-label">Average</div></div>';
  html += '<div class="analytics-response-stat"><div class="analytics-response-stat-value">' + formatSeconds(stats.min) + '</div><div class="analytics-response-stat-label">Min</div></div>';
  html += '<div class="analytics-response-stat"><div class="analytics-response-stat-value">' + formatSeconds(stats.median) + '</div><div class="analytics-response-stat-label">Median</div></div>';
  html += '<div class="analytics-response-stat"><div class="analytics-response-stat-value">' + formatSeconds(stats.max) + '</div><div class="analytics-response-stat-label">Max</div></div>';
  html += '</div>';

  // Recent timeline (last 20)
  const recent = times.slice(-20);
  if (recent.length > 0) {
    const maxMs = Math.max(...recent.map(t => t.responseTimeMs));
    html += '<div class="analytics-timeline">';
    for (const t of recent) {
      const pct = maxMs > 0 ? Math.round((t.responseTimeMs / maxMs) * 100) : 0;
      const cls = timeClass(t.responseTimeMs);
      html += '<div class="analytics-timeline-bar">';
      html += '<div class="analytics-timeline-fill ' + cls + '" style="width:' + Math.max(pct, 2) + '%"></div>';
      html += '<span class="analytics-timeline-label">' + formatSeconds(t.responseTimeMs) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  return html;
}

function renderTokenUsage(usage) {
  if (!usage.hasData) {
    return '<div class="analytics-empty-section">No usage data yet</div>';
  }

  let html = '<div class="analytics-token-stats">';
  html += '<div class="analytics-token-stat"><div class="analytics-token-stat-value">' + formatNumber(usage.totalTokens) + '</div><div class="analytics-token-stat-label">Total Tokens</div></div>';
  html += '<div class="analytics-token-stat"><div class="analytics-token-stat-value">' + formatNumber(usage.perSessionAvg) + '</div><div class="analytics-token-stat-label">Per Session</div></div>';
  html += '</div>';

  // Ratio bar
  const total = usage.totalInput + usage.totalOutput;
  if (total > 0) {
    const inputPct = Math.round((usage.totalInput / total) * 100);
    const outputPct = 100 - inputPct;
    html += '<div class="analytics-ratio-bar">';
    html += '<div class="analytics-ratio-segment analytics-ratio-input" style="flex:' + inputPct + '">';
    html += 'Input: ' + formatNumber(usage.totalInput) + ' (' + inputPct + '%)';
    html += '</div>';
    html += '<div class="analytics-ratio-segment analytics-ratio-output" style="flex:' + outputPct + '">';
    html += 'Output: ' + formatNumber(usage.totalOutput) + ' (' + outputPct + '%)';
    html += '</div>';
    html += '</div>';
  }

  return html;
}

function renderTopQueries(queries) {
  if (queries.length === 0) {
    return '<div class="analytics-empty-section">No user queries recorded</div>';
  }

  let html = '<div class="analytics-query-list">';
  for (const q of queries) {
    html += '<div class="analytics-query-item">';
    html += '<span class="analytics-query-count">' + q.count + '</span>';
    html += '<span class="analytics-query-text">' + escapeHtml(q.text) + '</span>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderErrorBreakdown(errors) {
  if (errors.length === 0) return '';

  let html = '<div class="analytics-section">';
  html += '<div class="analytics-section-title">Error Breakdown</div>';
  html += '<div class="analytics-error-list">';
  for (const err of errors) {
    html += '<div class="analytics-error-item">';
    html += '<span class="analytics-error-count">' + err.count + '</span>';
    html += '<span class="analytics-error-text">' + escapeHtml(err.message) + '</span>';
    html += '<span class="analytics-error-time">' + formatTime(err.lastTimestamp) + '</span>';
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

// ── Entry Point ──

function renderAnalytics() {
  const { analyticsPanel } = getDomRefs();
  if (!analyticsPanel) return;

  if (state.sessions.size === 0) {
    analyticsPanel.innerHTML = '<div class="analytics-empty">No sessions yet</div>';
    return;
  }

  const allEvents = getAllEvents();
  const overview = aggregateAllSessions();
  const toolMetrics = computeToolMetrics(allEvents);
  const responseTimes = computeResponseTimes(allEvents);
  const tokenUsage = computeTokenUsage(allEvents);
  const topQueries = computeTopQueries(allEvents);
  const errors = computeErrorBreakdown(allEvents);

  let html = renderOverviewStats(overview);

  html += '<div class="analytics-section">';
  html += '<div class="analytics-section-title">Tool Performance</div>';
  html += renderToolPerformance(toolMetrics);
  html += '</div>';

  html += '<div class="analytics-section">';
  html += '<div class="analytics-section-title">Response Times</div>';
  html += renderResponseTimes(responseTimes);
  html += '</div>';

  html += '<div class="analytics-section">';
  html += '<div class="analytics-section-title">Token Usage</div>';
  html += renderTokenUsage(tokenUsage);
  html += '</div>';

  html += '<div class="analytics-section">';
  html += '<div class="analytics-section-title">Top User Queries</div>';
  html += renderTopQueries(topQueries);
  html += '</div>';

  html += renderErrorBreakdown(errors);

  analyticsPanel.innerHTML = html;
}

// ── Registration ──
renderers.renderAnalytics = renderAnalytics;

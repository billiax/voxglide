import type { ResolvedTheme } from '../types';

/**
 * Build themed CSS for the SDK Shadow DOM.
 * Injects resolved theme values as CSS custom properties.
 */
export function buildStyles(theme: ResolvedTheme): string {
  const c = theme.colors;
  const darkOverrides = theme.colorScheme === 'dark' ? '' : `
  @media (prefers-color-scheme: dark) {
    :host {
      --vsdk-bg: #1a1a2e;
      --vsdk-bg-overlay: rgba(26, 26, 46, 0.96);
      --vsdk-text: #eaf0f6;
      --vsdk-text-muted: #8892a4;
      --vsdk-border: rgba(255,255,255,0.08);
      --vsdk-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.2);
      --vsdk-user-bg: var(--vsdk-primary);
      --vsdk-user-text: #ffffff;
      --vsdk-ai-bg: rgba(255,255,255,0.06);
      --vsdk-ai-text: #eaf0f6;
      --vsdk-input-bg: rgba(255,255,255,0.06);
    }
  }`;

  const darkSection = theme.colorScheme === 'light' ? '' : darkOverrides;

  return `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;

    --vsdk-primary: ${c.primary};
    --vsdk-primary-hover: ${c.primaryHover};
    --vsdk-danger: ${c.danger};
    --vsdk-danger-hover: ${c.dangerHover};
    --vsdk-bg: ${c.background};
    --vsdk-bg-overlay: ${c.backgroundOverlay};
    --vsdk-text: ${c.text};
    --vsdk-text-muted: ${c.textMuted};
    --vsdk-border: ${c.border};
    --vsdk-shadow: ${c.shadow};
    --vsdk-radius: ${theme.borderRadius};

    --vsdk-paused: #d97706;
    --vsdk-paused-hover: #b45309;
    --vsdk-success: #22c55e;

    /* Chat bubble colors */
    --vsdk-user-bg: ${c.primary};
    --vsdk-user-text: #ffffff;
    --vsdk-ai-bg: rgba(0,0,0,0.04);
    --vsdk-ai-text: ${c.text};
    --vsdk-input-bg: ${c.background};
${Object.entries(theme.customProperties).map(([k, v]) => `    ${k}: ${v};`).join('\n')}
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Layout container ── */
  .vsdk-container {
    position: fixed;
    z-index: var(--vsdk-z-index, 9999);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
    pointer-events: none;
    --vsdk-ox: 20px;
    --vsdk-oy: 20px;
  }
  /* Corner positions */
  .vsdk-container.bottom-right { bottom: var(--vsdk-oy); right: var(--vsdk-ox); }
  .vsdk-container.bottom-left  { bottom: var(--vsdk-oy); left: var(--vsdk-ox); align-items: flex-start; }
  .vsdk-container.top-right    { top: var(--vsdk-oy); right: var(--vsdk-ox); }
  .vsdk-container.top-left     { top: var(--vsdk-oy); left: var(--vsdk-ox); align-items: flex-start; }
  /* Edge-center positions */
  .vsdk-container.bottom-center { bottom: var(--vsdk-oy); left: 50%; transform: translateX(-50%); align-items: center; }
  .vsdk-container.top-center    { top: var(--vsdk-oy); left: 50%; transform: translateX(-50%); align-items: center; }
  .vsdk-container.center-right  { top: 50%; right: var(--vsdk-ox); transform: translateY(-50%); }
  .vsdk-container.center-left   { top: 50%; left: var(--vsdk-ox); transform: translateY(-50%); align-items: flex-start; }
  /* Dead-center */
  .vsdk-container.center        { top: 50%; left: 50%; transform: translate(-50%, -50%); align-items: center; }

  /* ── Floating button ── */
  .vsdk-btn {
    pointer-events: auto;
    width: ${theme.buttonSize}px;
    height: ${theme.buttonSize}px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    background: var(--vsdk-primary);
    box-shadow: 0 4px 14px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1);
    transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
  }
  .vsdk-btn:hover {
    background: var(--vsdk-primary-hover);
    transform: scale(1.06);
    box-shadow: 0 6px 20px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.12);
  }
  .vsdk-btn:active { transform: scale(0.94); }
  .vsdk-btn svg { width: ${theme.iconSize}px; height: ${theme.iconSize}px; }

  .vsdk-btn.listening {
    background: var(--vsdk-danger);
    animation: vsdk-pulse 1.5s ease-in-out infinite;
  }
  .vsdk-btn.listening:hover { background: var(--vsdk-danger-hover); }

  .vsdk-btn.paused {
    background: var(--vsdk-paused);
    animation: vsdk-pulse-amber 2s ease-in-out infinite;
  }
  .vsdk-btn.paused:hover { background: var(--vsdk-paused-hover); }

  .vsdk-btn.connecting { background: var(--vsdk-primary); opacity: 0.8; cursor: wait; }
  .vsdk-btn.connecting svg { animation: vsdk-spin 1s linear infinite; }

  /* Focus outlines */
  .vsdk-btn:focus-visible,
  .vsdk-panel-minimize:focus-visible,
  .vsdk-panel-end-session:focus-visible,
  .vsdk-text-send:focus-visible,
  .vsdk-text-input:focus-visible,
  .vsdk-queue-cancel:focus-visible {
    outline: 2px solid var(--vsdk-primary);
    outline-offset: 2px;
  }

  @keyframes vsdk-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
    50% { box-shadow: 0 0 0 12px rgba(220, 38, 38, 0); }
  }
  @keyframes vsdk-pulse-amber {
    0%, 100% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.4); }
    50% { box-shadow: 0 0 0 10px rgba(217, 119, 6, 0); }
  }
  @keyframes vsdk-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── Chat panel ── */
  .vsdk-transcript {
    pointer-events: auto;
    background: var(--vsdk-bg-overlay);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--vsdk-border);
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08);
    width: ${theme.panelMaxWidth}px;
    min-width: ${theme.panelMaxWidth}px;
    max-height: 440px;
    display: flex;
    flex-direction: column;
    opacity: 0;
    transform: translateY(10px) scale(0.95);
    transition: opacity 0.2s ease, transform 0.2s ease;
    overflow: hidden;
  }
  .vsdk-transcript.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  .vsdk-transcript.text-mode {
    width: 360px;
    min-width: 360px;
    max-height: 500px;
  }

  /* ── Panel header ── */
  .vsdk-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--vsdk-border);
    flex-shrink: 0;
  }
  .vsdk-panel-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .vsdk-panel-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vsdk-success);
    flex-shrink: 0;
  }
  .vsdk-panel-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--vsdk-text);
    letter-spacing: -0.01em;
  }
  .vsdk-panel-minimize,
  .vsdk-panel-end-session {
    pointer-events: auto;
    border: none;
    background: none;
    color: var(--vsdk-text-muted);
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }
  .vsdk-panel-minimize:hover {
    background: var(--vsdk-border);
    color: var(--vsdk-text);
  }
  .vsdk-panel-end-session:hover {
    background: rgba(220, 38, 38, 0.1);
    color: var(--vsdk-danger);
  }
  .vsdk-panel-minimize svg,
  .vsdk-panel-end-session svg {
    width: 14px;
    height: 14px;
  }

  /* ── Messages area ── */
  .vsdk-messages {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 12px;
  }
  .vsdk-messages::-webkit-scrollbar { width: 3px; }
  .vsdk-messages::-webkit-scrollbar-track { background: transparent; }
  .vsdk-messages::-webkit-scrollbar-thumb { background: var(--vsdk-border); border-radius: 2px; }

  /* ── Chat bubbles ── */
  .vsdk-transcript-line {
    font-size: 13px;
    line-height: 1.5;
    padding: 8px 14px;
    border-radius: 18px;
    max-width: 85%;
    word-wrap: break-word;
    animation: vsdk-msg-in 0.25s ease-out;
  }
  @keyframes vsdk-msg-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* User bubble */
  .vsdk-msg-user {
    align-self: flex-end;
    background: var(--vsdk-user-bg);
    color: var(--vsdk-user-text);
    border-bottom-right-radius: 6px;
  }

  /* AI bubble */
  .vsdk-msg-ai {
    align-self: flex-start;
    background: var(--vsdk-ai-bg);
    color: var(--vsdk-ai-text);
    border-bottom-left-radius: 6px;
  }

  /* Truncation notice */
  .vsdk-truncation-notice {
    text-align: center;
    font-size: 11px;
    color: var(--vsdk-text-muted);
    padding: 4px 8px;
    opacity: 0.6;
    font-style: italic;
  }

  /* System messages */
  .vsdk-transcript-line.vsdk-msg-system {
    text-align: center;
    font-size: 12px;
    color: var(--vsdk-text-muted);
    font-style: italic;
    max-width: 100%;
    background: none;
    padding: 4px 8px;
    align-self: center;
  }

  /* Restored lines */
  .vsdk-transcript-line.vsdk-restored {
    opacity: 0.45;
    animation: none;
  }

  /* ── Text input ── */
  .vsdk-text-input-row {
    display: flex;
    gap: 8px;
    padding: 12px;
    border-top: 1px solid var(--vsdk-border);
    align-items: center;
    flex-shrink: 0;
  }
  .vsdk-text-input {
    flex: 1;
    border: 1.5px solid var(--vsdk-border);
    border-radius: 22px;
    padding: 9px 16px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    background: var(--vsdk-input-bg);
    color: var(--vsdk-text);
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .vsdk-text-input:focus {
    border-color: var(--vsdk-primary);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
  }
  .vsdk-text-input::placeholder { color: var(--vsdk-text-muted); }
  .vsdk-transcript.text-mode .vsdk-text-input {
    font-size: 14px;
    padding: 10px 18px;
  }

  .vsdk-text-send {
    pointer-events: auto;
    border: none;
    background: var(--vsdk-primary);
    color: white;
    border-radius: 50%;
    width: 36px;
    height: 36px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
  }
  .vsdk-text-send:hover {
    background: var(--vsdk-primary-hover);
    box-shadow: 0 3px 10px rgba(37, 99, 235, 0.3);
  }
  .vsdk-text-send:active { transform: scale(0.9); }
  .vsdk-text-send svg { width: 16px; height: 16px; }

  /* ── Tool status ── */
  .vsdk-tool-status {
    font-size: 12px;
    color: var(--vsdk-text-muted);
    padding: 6px 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    background: var(--vsdk-ai-bg);
    border-radius: 14px;
  }
  .vsdk-tool-status::before {
    content: '';
    display: inline-block;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--vsdk-primary);
    animation: vsdk-blink 1s ease-in-out infinite;
    flex-shrink: 0;
  }
  .vsdk-tool-status.completed::before { background: var(--vsdk-success); animation: none; }
  .vsdk-tool-status.failed::before { background: var(--vsdk-danger); animation: none; }
  @keyframes vsdk-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* ── Thinking indicator ── */
  .vsdk-thinking {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 10px 16px;
    align-self: flex-start;
    background: var(--vsdk-ai-bg);
    border-radius: 18px;
    border-bottom-left-radius: 6px;
  }
  .vsdk-thinking span {
    display: inline-block;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--vsdk-text-muted);
    animation: vsdk-dot-bounce 1.4s ease-in-out infinite both;
  }
  .vsdk-thinking span:nth-child(1) { animation-delay: 0s; }
  .vsdk-thinking span:nth-child(2) { animation-delay: 0.16s; }
  .vsdk-thinking span:nth-child(3) { animation-delay: 0.32s; }
  @keyframes vsdk-dot-bounce {
    0%, 80%, 100% { transform: scale(0.5); opacity: 0.35; }
    40% { transform: scale(1); opacity: 1; }
  }

  /* ── Queue panel ── */
  .vsdk-queue-panel {
    border-top: 1px solid var(--vsdk-border);
    padding: 8px 12px 4px;
    flex-shrink: 0;
  }
  .vsdk-queue-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font-size: 12px;
    animation: vsdk-queue-enter 0.15s ease-out;
  }
  .vsdk-queue-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .vsdk-queue-dot.processing { background: var(--vsdk-primary); animation: vsdk-blink 1s ease-in-out infinite; }
  .vsdk-queue-dot.executing-tools { background: var(--vsdk-paused); animation: vsdk-blink 1.5s ease-in-out infinite; }
  .vsdk-queue-dot.queued { background: var(--vsdk-text-muted); }
  .vsdk-queue-item-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vsdk-text-muted);
    font-style: italic;
  }
  .vsdk-queue-cancel {
    border: none;
    background: none;
    color: var(--vsdk-text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 4px;
    border-radius: 3px;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, background 0.15s;
  }
  .vsdk-queue-item:hover .vsdk-queue-cancel { opacity: 1; }
  .vsdk-queue-cancel:hover { color: var(--vsdk-danger); background: rgba(220,38,38,0.1); }
  @keyframes vsdk-queue-enter {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (hover: none) { .vsdk-queue-cancel { opacity: 1; } }

  /* ── Settings panel ── */
  .vsdk-panel-header-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .vsdk-settings-btn {
    pointer-events: auto;
    border: none;
    background: none;
    color: var(--vsdk-text-muted);
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }
  .vsdk-settings-btn:hover {
    background: var(--vsdk-border);
    color: var(--vsdk-text);
  }
  .vsdk-settings-btn svg { width: 14px; height: 14px; }
  .vsdk-settings-btn:focus-visible {
    outline: 2px solid var(--vsdk-primary);
    outline-offset: 2px;
  }

  .vsdk-transcript.settings-open .vsdk-messages,
  .vsdk-transcript.settings-open .vsdk-text-input-row,
  .vsdk-transcript.settings-open .vsdk-queue-panel {
    display: none;
  }

  .vsdk-settings {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .vsdk-settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--vsdk-border);
    flex-shrink: 0;
  }
  .vsdk-settings-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--vsdk-text);
  }
  .vsdk-settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .vsdk-settings-body::-webkit-scrollbar { width: 3px; }
  .vsdk-settings-body::-webkit-scrollbar-track { background: transparent; }
  .vsdk-settings-body::-webkit-scrollbar-thumb { background: var(--vsdk-border); border-radius: 2px; }
  .vsdk-settings-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .vsdk-settings-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vsdk-text-muted);
  }

  /* Position grid */
  .vsdk-pos-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }
  .vsdk-pos-cell {
    pointer-events: auto;
    padding: 6px;
    border: 1.5px solid var(--vsdk-border);
    border-radius: 6px;
    background: none;
    cursor: pointer;
    font-size: 10px;
    font-weight: 500;
    font-family: inherit;
    color: var(--vsdk-text-muted);
    text-align: center;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }
  .vsdk-pos-cell:hover {
    border-color: var(--vsdk-primary);
    color: var(--vsdk-text);
  }
  .vsdk-pos-cell.active {
    background: var(--vsdk-primary);
    border-color: var(--vsdk-primary);
    color: white;
  }

  /* Toggle group */
  .vsdk-toggle-group {
    display: flex;
    gap: 4px;
  }
  .vsdk-toggle-btn {
    pointer-events: auto;
    flex: 1;
    padding: 6px 8px;
    border: 1.5px solid var(--vsdk-border);
    border-radius: 8px;
    background: none;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    color: var(--vsdk-text-muted);
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }
  .vsdk-toggle-btn:hover {
    border-color: var(--vsdk-primary);
    color: var(--vsdk-text);
  }
  .vsdk-toggle-btn.active {
    background: var(--vsdk-primary);
    border-color: var(--vsdk-primary);
    color: white;
  }

  /* Color picker */
  .vsdk-color-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .vsdk-color-input {
    pointer-events: auto;
    width: 32px;
    height: 32px;
    border: 1.5px solid var(--vsdk-border);
    border-radius: 8px;
    cursor: pointer;
    padding: 2px;
    background: none;
  }
  .vsdk-color-value {
    font-size: 12px;
    color: var(--vsdk-text-muted);
    font-family: monospace;
  }

  /* Offset inputs */
  .vsdk-offset-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .vsdk-offset-label {
    font-size: 12px;
    color: var(--vsdk-text-muted);
    min-width: 12px;
    font-weight: 500;
  }
  .vsdk-offset-input {
    pointer-events: auto;
    width: 56px;
    padding: 5px 8px;
    border: 1.5px solid var(--vsdk-border);
    border-radius: 6px;
    font-size: 12px;
    font-family: inherit;
    background: var(--vsdk-input-bg);
    color: var(--vsdk-text);
    text-align: center;
    outline: none;
    transition: border-color 0.2s;
  }
  .vsdk-offset-input:focus {
    border-color: var(--vsdk-primary);
  }

  /* ── High contrast mode ── */
  :host(.high-contrast) {
    --vsdk-text: #000000;
    --vsdk-bg: #ffffff;
    --vsdk-border: #000000;
  }
  :host(.high-contrast) .vsdk-btn:focus-visible,
  :host(.high-contrast) .vsdk-panel-minimize:focus-visible,
  :host(.high-contrast) .vsdk-panel-end-session:focus-visible,
  :host(.high-contrast) .vsdk-text-send:focus-visible,
  :host(.high-contrast) .vsdk-text-input:focus-visible,
  :host(.high-contrast) .vsdk-queue-cancel:focus-visible {
    outline: 3px solid #facc15;
    outline-offset: 2px;
  }
  :host(.high-contrast) .vsdk-btn { border: 2px solid #000000; }
  /* ── Responsive: Mobile ── */
  @media (max-width: 480px) {
    .vsdk-transcript,
    .vsdk-transcript.text-mode {
      width: calc(100vw - 24px) !important;
      min-width: unset !important;
      max-width: calc(100vw - 24px);
      max-height: calc(100vh - 120px);
      max-height: calc(100dvh - 120px);
      border-radius: 12px;
    }
    .vsdk-panel-minimize,
    .vsdk-panel-end-session,
    .vsdk-settings-btn {
      width: 44px;
      height: 44px;
    }
    .vsdk-panel-minimize svg,
    .vsdk-panel-end-session svg,
    .vsdk-settings-btn svg {
      width: 18px;
      height: 18px;
    }
    .vsdk-text-input {
      font-size: 16px;
      padding: 12px 16px;
    }
    .vsdk-text-send {
      width: 44px;
      height: 44px;
    }
    .vsdk-queue-cancel { opacity: 1; }
  }

  /* ── Responsive: Small phones ── */
  @media (max-width: 374px) {
    .vsdk-transcript,
    .vsdk-transcript.text-mode {
      width: calc(100vw - 16px) !important;
      min-width: unset !important;
      max-width: calc(100vw - 16px);
    }
  }

  /* ── Landscape with virtual keyboard ── */
  @media (max-height: 500px) and (orientation: landscape) {
    .vsdk-transcript,
    .vsdk-transcript.text-mode {
      max-height: calc(100vh - 80px);
      max-height: calc(100dvh - 80px);
    }
  }

  /* ── Safe area for notch/Dynamic Island ── */
  @supports (padding-bottom: env(safe-area-inset-bottom)) {
    .vsdk-container.bottom-right,
    .vsdk-container.bottom-left,
    .vsdk-container.bottom-center {
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
  }

${darkSection}
`;
}

/** Default styles (backward compat — uses default theme) */
export const SDK_STYLES = buildStyles({
  colors: {
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    danger: '#dc2626',
    dangerHover: '#b91c1c',
    background: '#ffffff',
    backgroundOverlay: 'rgba(255, 255, 255, 0.95)',
    text: '#1f2937',
    textMuted: '#6b7280',
    border: '#e5e7eb',
    shadow: '0 4px 24px rgba(0, 0, 0, 0.12)',
  },
  size: 'md',
  borderRadius: '12px',
  colorScheme: 'auto',
  buttonSize: 56,
  iconSize: 24,
  panelMaxWidth: 320,
  customProperties: {},
});

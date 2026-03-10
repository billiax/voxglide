export const SDK_STYLES = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --vsdk-primary: var(--voice-sdk-primary, #2563eb);
    --vsdk-primary-hover: var(--voice-sdk-primary-hover, #1d4ed8);
    --vsdk-danger: #dc2626;
    --vsdk-danger-hover: #b91c1c;
    --vsdk-bg: #ffffff;
    --vsdk-bg-overlay: rgba(255, 255, 255, 0.95);
    --vsdk-text: #1f2937;
    --vsdk-text-muted: #6b7280;
    --vsdk-border: #e5e7eb;
    --vsdk-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
    --vsdk-radius: 12px;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .vsdk-container {
    position: fixed;
    z-index: var(--vsdk-z-index, 9999);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }

  .vsdk-container.bottom-right {
    bottom: 20px;
    right: 20px;
  }
  .vsdk-container.bottom-left {
    bottom: 20px;
    left: 20px;
    align-items: flex-start;
  }
  .vsdk-container.top-right {
    top: 20px;
    right: 20px;
  }
  .vsdk-container.top-left {
    top: 20px;
    left: 20px;
    align-items: flex-start;
  }

  /* Floating mic button */
  .vsdk-btn {
    pointer-events: auto;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    background: var(--vsdk-primary);
    box-shadow: var(--vsdk-shadow);
    transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
  }

  .vsdk-btn:hover {
    background: var(--vsdk-primary-hover);
    transform: scale(1.05);
  }

  .vsdk-btn:active {
    transform: scale(0.95);
  }

  .vsdk-btn.listening {
    background: var(--vsdk-danger);
    animation: vsdk-pulse 1.5s ease-in-out infinite;
  }

  .vsdk-btn.listening:hover {
    background: var(--vsdk-danger-hover);
  }

  .vsdk-btn.connecting {
    background: var(--vsdk-primary);
    opacity: 0.8;
    cursor: wait;
  }

  .vsdk-btn.connecting svg {
    animation: vsdk-spin 1s linear infinite;
  }

  .vsdk-btn svg {
    width: 24px;
    height: 24px;
  }

  @keyframes vsdk-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
    50% { box-shadow: 0 0 0 12px rgba(220, 38, 38, 0); }
  }

  @keyframes vsdk-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Transcript overlay */
  .vsdk-transcript {
    pointer-events: auto;
    background: var(--vsdk-bg-overlay);
    backdrop-filter: blur(8px);
    border: 1px solid var(--vsdk-border);
    border-radius: var(--vsdk-radius);
    box-shadow: var(--vsdk-shadow);
    padding: 12px 16px;
    max-width: 320px;
    min-width: 200px;
    max-height: 200px;
    overflow-y: auto;
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.2s, transform 0.2s;
  }

  .vsdk-transcript.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .vsdk-transcript-line {
    font-size: 13px;
    line-height: 1.4;
    color: var(--vsdk-text);
    margin-bottom: 6px;
  }

  .vsdk-transcript-line:last-child {
    margin-bottom: 0;
  }

  .vsdk-transcript-line .speaker {
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-right: 4px;
  }

  .vsdk-transcript-line .speaker.user {
    color: var(--vsdk-primary);
  }

  .vsdk-transcript-line .speaker.ai {
    color: var(--vsdk-danger);
  }

  /* Text input */
  .vsdk-text-input-row {
    display: flex;
    gap: 4px;
    margin-top: 8px;
    border-top: 1px solid var(--vsdk-border);
    padding-top: 8px;
  }

  .vsdk-text-input {
    flex: 1;
    border: 1px solid var(--vsdk-border);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    background: var(--vsdk-bg);
    color: var(--vsdk-text);
  }

  .vsdk-text-input:focus {
    border-color: var(--vsdk-primary);
  }

  .vsdk-text-send {
    pointer-events: auto;
    border: none;
    background: var(--vsdk-primary);
    color: white;
    border-radius: 6px;
    width: 28px;
    height: 28px;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .vsdk-text-send:hover {
    background: var(--vsdk-primary-hover);
  }

  /* Text-first mode */
  .vsdk-transcript.text-mode {
    min-width: 300px;
    max-height: 350px;
  }

  .vsdk-transcript.text-mode .vsdk-text-input {
    font-size: 14px;
    padding: 10px 12px;
  }

  /* Tool execution status */
  .vsdk-tool-status {
    font-size: 12px;
    color: var(--vsdk-text-muted);
    padding: 4px 0;
    font-style: italic;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .vsdk-tool-status::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--vsdk-primary);
    animation: vsdk-pulse 1s ease-in-out infinite;
  }

  .vsdk-tool-status.completed::before {
    background: #3fb950;
    animation: none;
  }

  .vsdk-tool-status.failed::before {
    background: var(--vsdk-danger);
    animation: none;
  }

  /* Panel header */
  .vsdk-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--vsdk-border);
  }

  .vsdk-panel-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--vsdk-text);
  }

  .vsdk-test-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #b45309;
    background: #fef3c7;
    border: 1px solid #fde68a;
    border-radius: 4px;
    padding: 1px 5px;
    margin-left: 6px;
  }

  .vsdk-panel-close {
    pointer-events: auto;
    border: none;
    background: none;
    color: var(--vsdk-text-muted);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
  }

  .vsdk-panel-close:hover {
    background: var(--vsdk-border);
    color: var(--vsdk-text);
  }

  /* AI thinking indicator */
  .vsdk-thinking {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 0;
  }

  .vsdk-thinking span {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--vsdk-text-muted);
    animation: vsdk-dot-bounce 1.4s ease-in-out infinite both;
  }

  .vsdk-thinking span:nth-child(1) {
    animation-delay: 0s;
  }

  .vsdk-thinking span:nth-child(2) {
    animation-delay: 0.16s;
  }

  .vsdk-thinking span:nth-child(3) {
    animation-delay: 0.32s;
  }

  @keyframes vsdk-dot-bounce {
    0%, 80%, 100% {
      transform: scale(0.6);
      opacity: 0.4;
    }
    40% {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* Restored transcript lines */
  .vsdk-transcript-line.vsdk-restored {
    opacity: 0.6;
  }

  /* Dark mode */
  @media (prefers-color-scheme: dark) {
    :host {
      --vsdk-bg: #1f2937;
      --vsdk-bg-overlay: rgba(31, 41, 55, 0.95);
      --vsdk-text: #f3f4f6;
      --vsdk-text-muted: #9ca3af;
      --vsdk-border: #374151;
      --vsdk-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
    }
  }
`;

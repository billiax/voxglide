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
`;

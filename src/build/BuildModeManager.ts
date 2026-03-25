import type { PageContextProvider } from '../context/PageContextProvider';
import { captureScreenshot } from '../utils/screenshot';
import { BuildModeSession } from './BuildModeSession';
import type { SendMessageOptions } from './BuildModeSession';
import { BrowserToolExecutor } from './browser-tools/BrowserToolExecutor';
import { CodeExtractor } from './CodeExtractor';
import type {
  BuildModeConfig, BuildSessionSnapshot, ExtractedCodeBlock, PendingTool, ToolDefinition,
} from './types';
import CONTEXT_PREAMBLE from './build-mode-prompt.md';

export interface BuildModeManagerCallbacks {
  onModeChange: (active: boolean, silent?: boolean) => void;
  onTranscript: (text: string, speaker: 'user' | 'ai', isFinal: boolean) => void;
  onToolsRegistered: (names: string[]) => void;
  onToolSavedToServer: () => void;
  onPendingTool: (tool: PendingTool) => void;
  onToolLoopStatus: (status: string | null) => void;
  onError: (message: string) => void;
  onLoadingChange: (loading: boolean) => void;
  onDebug: (message: string) => void;
}

export interface BuildModeDeps {
  getPageContextProvider: () => PageContextProvider | null;
}

const MAX_TOOL_LOOPS = 15;
const BUILD_MODE_STORAGE_KEY = 'vsdk-build-mode-active';
const BUILD_SESSION_STORAGE_KEY = 'vsdk-build-session';

/** Browser tool definitions sent to the API as structured tools. */
const BROWSER_TOOLS: ToolDefinition[] = [
  {
    name: 'page_snapshot',
    description: 'Returns the current page structure: URL, title, forms with all their fields and current values, interactive elements (buttons, links, toggles, inputs) with CSS selectors, headings hierarchy, navigation links, and visible text content. Always use this first to understand the page before writing any code.',
  },
  {
    name: 'take_screenshot',
    description: 'Captures a visual screenshot of the current browser page and returns it as an image. Use this to see what the page actually looks like — layout, colors, visual state of elements. Complements page_snapshot which returns structure/text only.',
  },
  {
    name: 'evaluate_js',
    description: 'Executes JavaScript in the browser page with full DOM access. This is your ONLY way to interact with the page — use it for clicking elements, filling fields, reading values, calling APIs, and testing selectors. There are no separate click/fill/navigate tools. Returns the expression result, any console output, and errors if thrown.',
    parameters: {
      code: { type: 'string', description: 'JavaScript code to execute in the page context, provide ONLY the code itself, no wrappers, no markdown or extra syntax', required: true },
    },
  },
  {
    name: 'get_console_logs',
    description: 'Returns recent console output (log, warn, error, info) captured from the browser page. Useful for debugging evaluate_js results or understanding page behavior.',
    parameters: {
      since_ms: { type: 'number', description: 'Only return logs after this Unix timestamp in milliseconds. Omit to get all recent logs.', required: false },
    },
  },
  {
    name: 'get_network_requests',
    description: 'Returns recent network requests (XHR, fetch, resource loads) captured from the browser page, including URL, method, status, and timing. Useful for understanding API endpoints the page communicates with.',
    parameters: {
      since_ms: { type: 'number', description: 'Only return requests after this Unix timestamp in milliseconds. Omit to get all recent requests.', required: false },
    },
  },
  {
    name: 'register_tool',
    description: 'Submit the finished page action code for registration. Use this when your page action is complete. The code will be proposed to the user for approval.',
    parameters: {
      name: { type: 'string', description: 'The camelCase name of the page action (e.g. createTask, addNote)', required: true },
      code: { type: 'string', description: 'The complete JavaScript code: window.nbt_functions.actionName = { description, parameters, handler }', required: true },
    },
  },
];


/**
 * Top-level orchestrator for Build Mode.
 * Uses text-based request protocol: browser tools are registered via the API,
 * Claude returns `requests` in the response, we execute them client-side and
 * send results back as [REQUEST RESULT: name] text blocks.
 * Screenshots are sent as images via native support.
 * Generated nbt_functions tools are proposed as "pending" for user accept/reject.
 */
export class BuildModeManager {
  private session: BuildModeSession | null = null;
  private toolExecutor: BrowserToolExecutor | null = null;
  private config: BuildModeConfig;
  private callbacks: BuildModeManagerCallbacks;
  private deps: BuildModeDeps;
  private active = false;
  private isFirstMessage = true;
  private lastContextUrl: string | null = null;
  private pendingTools: PendingTool[] = [];
  private inToolLoop = false;
  private pendingScreenshot: string | null = null;
  private pendingResume: BuildSessionSnapshot | null = null;

  constructor(config: BuildModeConfig, callbacks: BuildModeManagerCallbacks, deps: BuildModeDeps) {
    this.config = config;
    this.callbacks = callbacks;
    this.deps = deps;
  }

  static isPersistedActive(): boolean {
    try { return localStorage.getItem(BUILD_MODE_STORAGE_KEY) === 'true'; } catch { return false; }
  }

  isActive(): boolean {
    return this.active;
  }

  activate(options?: { silent?: boolean }): void {
    if (this.active) return;
    this.active = true;

    // Try to restore session from navigation persistence.
    // Only act on snapshots where a tool loop was interrupted — that's the
    // critical case where we need to auto-resume. For idle reloads the session
    // ID is still restored silently so the conversation continues, but we don't
    // show any special UI.
    const snapshot = BuildModeManager.consumePendingSession();
    if (snapshot?.inToolLoop) {
      this.isFirstMessage = false;
      this.lastContextUrl = snapshot.previousUrl;
      this.pendingResume = snapshot;
    } else {
      this.isFirstMessage = true;
      this.lastContextUrl = null;
      this.pendingResume = null;
    }

    this.pendingTools = [];
    this.pendingScreenshot = null;
    this.ensureSession();

    // Restore session ID so the Claude Code API conversation continues
    if (snapshot) {
      this.session!.setSessionId(snapshot.sessionId);
    }

    this.ensureToolExecutor();
    this.toolExecutor?.activate();
    try { localStorage.setItem(BUILD_MODE_STORAGE_KEY, 'true'); } catch { /* storage unavailable */ }
    this.callbacks.onModeChange(true, options?.silent);
    this.callbacks.onDebug(snapshot ? 'Build mode restored from navigation' : 'Build mode activated');
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.toolExecutor?.deactivate();
    this.pendingTools = [];
    this.pendingScreenshot = null;
    this.pendingResume = null;
    // Reset session so toggle off→on starts a truly fresh conversation
    this.session?.resetSession();
    this.callbacks.onLoadingChange(false);
    try { localStorage.removeItem(BUILD_MODE_STORAGE_KEY); } catch { /* storage unavailable */ }
    BuildModeManager.clearPendingSession();
    this.callbacks.onModeChange(false);
    this.callbacks.onDebug('Build mode deactivated');
  }

  toggle(): void {
    if (this.active) this.deactivate();
    else this.activate();
  }

  async sendMessage(text: string): Promise<void> {
    if (!text.trim()) return;
    if (this.inToolLoop) return;
    this.ensureSession();

    this.callbacks.onTranscript(text, 'user', true);
    this.callbacks.onLoadingChange(true);

    const currentUrl = window.location.href;
    const urlChanged = this.lastContextUrl !== null && this.lastContextUrl !== currentUrl;
    const needsContext = this.isFirstMessage || urlChanged;

    const options: SendMessageOptions = {};

    let message: string;
    if (needsContext) {
      // Capture screenshot for visual context (API supports images natively)
      const screenshot = await captureScreenshot();
      if (screenshot) {
        options.images = [{ data: screenshot, media_type: 'image/jpeg' }];
      }

      // Send browser tools as structured tool definitions
      options.tools = BROWSER_TOOLS;

      const existingTools = (window as any).nbt_functions
        ? Object.keys((window as any).nbt_functions).join(', ') || 'None'
        : 'None';
      message = `${CONTEXT_PREAMBLE}\n\nEXISTING PAGE ACTIONS: ${existingTools}\n\nUSER REQUEST:\n${text}`;
      this.isFirstMessage = false;
      this.lastContextUrl = currentUrl;
    } else {
      message = text;
    }

    await this.sendAndProcessLoop(message, options);
  }

  // ── Accept / Reject ──

  acceptTool(name: string): void {
    const pending = this.pendingTools.find(t => t.name === name && t.status === 'pending');
    if (!pending) return;

    pending.status = 'accepted';
    const registered = this.executeAndRegister(
      { language: 'javascript', code: pending.code, registered: false },
      pending.sessionId,
    );

    if (registered.length > 0) {
      this.callbacks.onToolsRegistered(registered);
    }
  }

  rejectTool(name: string): void {
    const pending = this.pendingTools.find(t => t.name === name && t.status === 'pending');
    if (!pending) return;
    pending.status = 'rejected';
  }

  getPendingTools(): PendingTool[] {
    return this.pendingTools.filter(t => t.status === 'pending');
  }

  // ── Navigation persistence ──

  /** Whether a tool loop was interrupted by navigation and needs to resume. */
  hasPendingResume(): boolean {
    return this.pendingResume !== null;
  }

  /**
   * Save build session state to sessionStorage before page unload.
   * Called from VoiceSDK's beforeunload handler.
   */
  saveSessionState(): void {
    const sessionId = this.session?.getSessionId();
    if (!this.active || !sessionId) return;

    const snapshot: BuildSessionSnapshot = {
      sessionId,
      inToolLoop: this.inToolLoop,
      previousUrl: window.location.href,
    };

    try {
      sessionStorage.setItem(BUILD_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
    } catch { /* storage unavailable */ }
  }

  /**
   * Resume the build conversation after a page navigation interrupted a tool loop.
   * Sends a tool result message to Claude with fresh page context so it can continue.
   */
  async resumeAfterNavigation(): Promise<void> {
    const snapshot = this.pendingResume;
    if (!snapshot) return;
    this.pendingResume = null;

    this.callbacks.onLoadingChange(true);

    // Capture fresh visual context for the new page
    const screenshot = await captureScreenshot();
    const options: SendMessageOptions = {};
    if (screenshot) {
      options.images = [{ data: screenshot, media_type: 'image/jpeg' }];
    }
    options.tools = BROWSER_TOOLS;

    const existingTools = (window as any).nbt_functions
      ? Object.keys((window as any).nbt_functions).join(', ') || 'None'
      : 'None';

    // Send as a tool result so Claude can pick up where it left off.
    // evaluate_js is the only browser tool that can trigger hard navigation.
    const message = [
      '[REQUEST RESULT: evaluate_js]',
      `The JavaScript execution caused the browser to navigate from ${snapshot.previousUrl} to ${window.location.href}. The page has fully reloaded.`,
      '',
      CONTEXT_PREAMBLE,
      '',
      `EXISTING PAGE ACTIONS: ${existingTools}`,
      '',
      'Continue with the user\'s original request. Analyze the new page and proceed with the next step.',
    ].join('\n');

    this.lastContextUrl = window.location.href;

    await this.sendAndProcessLoop(message, options);
  }

  /** Read and remove the pending session snapshot from sessionStorage. */
  static consumePendingSession(): BuildSessionSnapshot | null {
    try {
      const raw = sessionStorage.getItem(BUILD_SESSION_STORAGE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(BUILD_SESSION_STORAGE_KEY);
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** Clear any pending session snapshot without reading it. */
  static clearPendingSession(): void {
    try { sessionStorage.removeItem(BUILD_SESSION_STORAGE_KEY); } catch { /* ignore */ }
  }

  // ── Session management ──

  newSession(): void {
    this.session?.resetSession();
    this.isFirstMessage = true;
    this.lastContextUrl = null;
    this.pendingTools = [];
    this.pendingScreenshot = null;
    this.pendingResume = null;
    BuildModeManager.clearPendingSession();
    this.callbacks.onDebug('New build session started');
  }

  destroy(): void {
    this.active = false;
    this.pendingScreenshot = null;
    this.pendingResume = null;
    this.toolExecutor?.destroy();
    this.toolExecutor = null;
    this.session?.destroy();
    this.session = null;
  }

  // ── Core: send message, execute requests, loop ──

  private async sendAndProcessLoop(
    message: string,
    initialOptions?: SendMessageOptions,
  ): Promise<void> {
    this.inToolLoop = true;
    let iterations = 0;
    let currentMessage = message;
    let currentOptions: SendMessageOptions | undefined = initialOptions;
    let persistentToolsRegistered = false;

    try {
      while (iterations < MAX_TOOL_LOOPS) {
        iterations++;

        let response;
        try {
          response = await this.session!.sendMessage(currentMessage, currentOptions);
        } catch (err: any) {
          this.callbacks.onLoadingChange(false);
          if (err.name !== 'AbortError') this.callbacks.onError(err.message);
          return;
        }

        // After the first response we have a sessionId — register persistent
        // tools immediately so they're in the system prompt for turn 2+.
        // (Ephemeral tools from options.tools only last one turn.)
        if (!persistentToolsRegistered && initialOptions?.tools && this.session?.getSessionId()) {
          persistentToolsRegistered = true;
          this.session.registerPersistentTools(initialOptions.tools).catch(() => {});
        }

        const text = response.response || '';
        const requests = response.requests;

        if (!requests || requests.length === 0) {
          // No requests — turn is complete
          this.callbacks.onLoadingChange(false);
          if (text) {
            this.callbacks.onTranscript(text, 'ai', true);
            this.extractPendingTools(text, response.sessionId);
          }
          return;
        }

        // Handle register_tool requests — these deliver the final page action code.
        // Create a pending tool and end the loop (don't send results back).
        const registerReqs = requests.filter(r => r.name === 'register_tool');
        if (registerReqs.length > 0) {
          if (text) this.callbacks.onTranscript(text, 'ai', true);
          for (const req of registerReqs) {
            const code = (req.params?.code as string) || '';
            const name = (req.params?.name as string) || 'unknown';
            if (code) {
              const pending: PendingTool = {
                name,
                code,
                sessionId: response.sessionId,
                status: 'pending',
              };
              this.pendingTools.push(pending);
              this.callbacks.onPendingTool(pending);
            }
          }
          this.callbacks.onLoadingChange(false);
          return;
        }

        // Execute requests and build [REQUEST RESULT] messages
        const resultParts: string[] = [];
        for (const req of requests) {
          const label = req.name.replace(/_/g, ' ');
          this.callbacks.onToolLoopStatus(`Running ${label}...`);
          this.callbacks.onDebug(`Request: ${req.name}`);

          let output: string;
          if (this.toolExecutor) {
            const result = await this.toolExecutor.execute(req);
            output = result.output;
            // Screenshot results are sent as native images on the next turn
            if (result.image) {
              this.pendingScreenshot = result.image;
            }
          } else {
            output = 'Error: browser tools not available (PageContextProvider missing)';
          }

          resultParts.push(`[REQUEST RESULT: ${req.name}]\n${output}`);
          this.callbacks.onDebug(`Request result [${req.name}]: ${output.length} chars`);
        }

        // Show any text that accompanied the requests
        if (text) {
          this.callbacks.onTranscript(text, 'ai', true);
        }

        // Send request results back as text
        this.callbacks.onToolLoopStatus('Processing...');
        currentMessage = resultParts.join('\n\n');

        // Attach pending screenshot if take_screenshot was called this iteration
        if (this.pendingScreenshot) {
          currentOptions = {
            images: [{ data: this.pendingScreenshot, media_type: 'image/jpeg' }],
          };
          this.pendingScreenshot = null;
        } else {
          currentOptions = undefined;
        }
      }

      if (iterations >= MAX_TOOL_LOOPS) {
        this.callbacks.onLoadingChange(false);
        this.callbacks.onError('Tool loop exceeded maximum iterations');
      }
    } finally {
      this.inToolLoop = false;
      this.callbacks.onToolLoopStatus(null);
    }
  }

  // ── Tool extraction (pending, not auto-registered) ──

  private extractPendingTools(responseText: string, sessionId: string): void {
    const blocks = CodeExtractor.extractCodeBlocks(responseText);
    const toolBlocks = blocks.filter(b => CodeExtractor.containsToolDefinitions(b.code));

    for (const block of toolBlocks) {
      const names = CodeExtractor.extractToolNames(block.code);
      for (const name of names) {
        const pending: PendingTool = { name, code: block.code, sessionId, status: 'pending' };
        this.pendingTools.push(pending);
        this.callbacks.onPendingTool(pending);
      }
    }
  }

  // ── Execute and register (used by acceptTool) ──

  private executeAndRegister(block: ExtractedCodeBlock, _sessionId: string): string[] {
    if (!(window as any).nbt_functions) {
      (window as any).nbt_functions = {};
    }

    const before = new Map<string, unknown>();
    for (const [name, value] of Object.entries((window as any).nbt_functions)) {
      before.set(name, value);
    }

    try {
      (0, eval)(block.code);
      block.registered = true;
    } catch (err: any) {
      block.registered = false;
      block.error = err.message;
      this.callbacks.onError(`Failed to register tool: ${err.message}`);
      return [];
    }

    const changedNames: string[] = [];
    for (const [name, value] of Object.entries((window as any).nbt_functions)) {
      if (!before.has(name) || before.get(name) !== value) {
        changedNames.push(name);
      }
    }

    for (const name of changedNames) {
      this.saveToolToServer(name, block.code);
    }

    if (changedNames.length > 0) {
      window.dispatchEvent(new CustomEvent('voxglide:functions-changed'));
    }

    return changedNames;
  }

  /** Best-effort save to server. */
  private saveToolToServer(name: string, code: string): void {
    const serverUrl = this.config.serverUrl;
    if (!serverUrl) return;

    fetch(`${serverUrl.replace(/\/+$/, '')}/api/functions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        code,
        description: this.extractDescription(code),
        match: this.extractMatch(code),
        source: 'build-mode',
        sourceUrl: window.location.href,
      }),
    }).then(async (res) => {
      if (res.ok) {
        this.callbacks.onDebug(`Tool "${name}" saved to server`);
        this.callbacks.onToolSavedToServer();
      } else {
        this.callbacks.onDebug(`Failed to save "${name}" to server: ${await res.text()}`);
      }
    }).catch(() => {});
  }

  /** Extract description from generated nbt_functions code. */
  private extractDescription(code: string): string {
    const match = /description:\s*['"]([^'"]+)['"]/.exec(code);
    return match?.[1] || '';
  }

  /** Extract match pattern from generated nbt_functions code. Defaults to "*" (global). */
  private extractMatch(code: string): string {
    const match = /match:\s*['"]([^'"]+)['"]/.exec(code);
    return match?.[1] || '*';
  }

  // ── Internal helpers ──

  private ensureSession(): void {
    if (this.session) return;
    this.session = new BuildModeSession(this.config, {
      onStateChange: () => {},
      onError: (msg) => { this.callbacks.onLoadingChange(false); this.callbacks.onError(msg); },
      onDebug: (msg) => { this.callbacks.onDebug(msg); },
    });
  }

  private ensureToolExecutor(): void {
    if (this.toolExecutor) return;
    const provider = this.deps.getPageContextProvider();
    if (!provider) {
      this.callbacks.onDebug('PageContextProvider not available — browser tools disabled');
      return;
    }
    this.toolExecutor = new BrowserToolExecutor(provider);
  }
}

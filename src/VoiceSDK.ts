import { EventEmitter } from './events';
import { ProxySession } from './ai/ProxySession';
import { ContextEngine } from './context/ContextEngine';
import { TextProvider } from './context/TextProvider';
import { PageContextProvider } from './context/PageContextProvider';
import { ActionRouter } from './actions/ActionRouter';
import { NavigationHandler } from './actions/NavigationHandler';
import { NavigationObserver } from './NavigationObserver';
import { invalidateElementCache, setIndexResolver, setRescanCallback, setPostClickCallback } from './actions/DOMActions';
import { builtInTools } from './actions/tools';
import { UIManager } from './ui/UIManager';
import { ConnectionState, DEFAULT_LANGUAGE, SYSTEM_PROMPT_TEMPLATE } from './constants';
import type { ConnectionStateValue } from './constants';
import type {
  VoiceSDKConfig, VoiceSDKEvents, ContextProvider, CustomAction,
  ToolDeclaration, TranscriptEvent, ActionEvent,
} from './types';
import type { ProxySessionConfig } from './ai/types';
import type { InputMode } from './ui/FloatingButton';

export class VoiceSDK extends EventEmitter<VoiceSDKEvents> {
  /** Global singleton — only one VoiceSDK instance may be active at a time. */
  private static activeInstance: VoiceSDK | null = null;

  private config: VoiceSDKConfig;
  private session: ProxySession | null = null;
  private contextEngine: ContextEngine;
  private actionRouter: ActionRouter;
  private pageContextProvider: PageContextProvider | null = null;
  private textProvider: TextProvider | null = null;
  private ui: UIManager | null = null;
  private connectionState: ConnectionStateValue = ConnectionState.DISCONNECTED;
  private ttsEnabled: boolean;
  private resolvedInputMode: InputMode;
  private toggling = false;
  private lastScreenshotUrl: string | null = null;
  private navigationObserver: NavigationObserver | null = null;
  private contextChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSentSystemInstruction: string | null = null;
  private lastSentScanFingerprint: string | null = null;
  private destroyed = false;
  private speechCurrentlyActive = false;

  constructor(config: VoiceSDKConfig) {
    super();

    // Singleton enforcement: destroy previous instance to prevent ghost
    // WebSocket/SpeechCapture/UI from lingering when re-injected by extensions.
    if (VoiceSDK.activeInstance) {
      VoiceSDK.activeInstance.destroy();
    }
    VoiceSDK.activeInstance = this;

    this.config = config;
    this.ttsEnabled = config.tts ?? false;
    this.resolvedInputMode = this.resolveInputMode();

    // Set up context engine
    this.contextEngine = new ContextEngine();

    // Developer-supplied context
    if (config.context) {
      this.textProvider = new TextProvider(config.context);
      this.contextEngine.addProvider(this.textProvider);
    }

    // Auto page context
    if (config.autoContext !== false && config.autoContext !== undefined) {
      const autoConfig = config.autoContext === true ? true : config.autoContext;
      this.pageContextProvider = new PageContextProvider(autoConfig, () => this.handleContextChange());
      this.contextEngine.addProvider(this.pageContextProvider);
    }

    // Set up action router
    this.actionRouter = new ActionRouter(config);

    // Register scanPage handler
    this.actionRouter.registerHandler('scanPage', async () => {
      return this.handleScanPage();
    });

    // Wire index resolver and rescan callback for self-healing
    this.wireIndexResolver();
    setRescanCallback(async () => {
      if (this.pageContextProvider) {
        this.pageContextProvider.markDirty();
        await this.contextEngine.buildSystemPrompt();
        this.wireIndexResolver();
      }
    });

    // Wire post-click callback for SPA navigation detection
    setPostClickCallback(() => this.handlePostClickNavigation());

    // Register custom actions
    if (config.actions?.custom) {
      this.actionRouter.registerCustomActions(config.actions.custom);
    }

    // Set up UI (unless disabled)
    if (config.ui !== false) {
      this.ui = new UIManager(
        typeof config.ui === 'object' ? config.ui : {},
        () => this.toggle(),
        (text) => this.sendText(text),
        this.resolvedInputMode,
      );
    }

    // Wire disconnect handler from panel header
    if (this.ui) {
      this.ui.setDisconnectHandler(() => this.stop());
    }

    // Set up SPA navigation detection + beforeunload session persistence
    this.navigationObserver = new NavigationObserver(
      (event) => this.handleSPANavigation(event),
      () => this.handleBeforeUnload(),
    );

    // Check for pending reconnect from navigation
    if (config.autoReconnect !== false) {
      const pending = NavigationHandler.getPendingReconnect();
      if (pending) {
        // Restore transcript from previous page
        this.ui?.restoreTranscript();
        // Small delay to let the DOM settle after page load.
        // Don't pre-set CONNECTING here — start() sets it and also guards against
        // duplicate calls by checking for CONNECTING. Setting it here would cause
        // start() to bail out immediately, leaving the button stuck as a spinner.
        setTimeout(() => this.start(), 100);
      }
    }
  }

  /**
   * Resolve the effective input mode based on config and browser capabilities.
   */
  private resolveInputMode(): InputMode {
    const mode = this.config.mode ?? 'voice';
    if (mode === 'text') return 'text';
    if (mode === 'auto') {
      return ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
        ? 'voice' : 'text';
    }
    return 'voice';
  }

  /**
   * Start the voice session — connect to server and begin listening.
   */
  async start(): Promise<void> {
    if (this.destroyed) return;
    if (this.connectionState === ConnectionState.CONNECTED || this.connectionState === ConnectionState.CONNECTING) {
      return;
    }

    this.setConnectionState(ConnectionState.CONNECTING);
    // Reset dedup state for new connection
    this.lastSentSystemInstruction = null;
    this.lastSentScanFingerprint = null;

    try {
      // Check for stored sessionId from navigation reconnect
      let storedSessionId: string | undefined;
      const pending = NavigationHandler.getPendingReconnect();
      if (pending?.sessionId) {
        storedSessionId = pending.sessionId;
      }

      // Build context and system prompt (single buildContext() call)
      const { systemPrompt: contextPrompt, tools: contextTools } = await this.contextEngine.buildSystemPromptAndTools();

      // Combine built-in + context + custom tool declarations
      const allTools = this.buildToolDeclarations(contextTools);
      const toolDescriptions = allTools.map((t) => `- ${t.name}: ${t.description}`).join('\n');

      const systemInstruction = SYSTEM_PROMPT_TEMPLATE
        .replace('{pageContext}', contextPrompt || 'No page context available.')
        .replace('{developerContext}', this.config.context || 'None.')
        .replace('{toolDescriptions}', toolDescriptions || 'None.');

      const sessionConfig: ProxySessionConfig = {
        serverUrl: this.config.serverUrl,
        systemInstruction,
        tools: [{ functionDeclarations: allTools }],
        languageCode: this.config.language || DEFAULT_LANGUAGE,
        debug: this.config.debug ?? false,
        sessionId: storedSessionId,
        speechEnabled: this.resolvedInputMode === 'voice',
      };

      this.session = new ProxySession(sessionConfig, {
        onStatusChange: (status) => {
          if (status === 'connected') {
            this.setConnectionState(ConnectionState.CONNECTED);
            this.emit('connected');
            // Show transcript panel immediately so user can see input + type
            this.ui?.setAutoHideEnabled(false);
            this.ui?.showTranscript();
            // Store sessionId for navigation handler
            if (this.session?.sessionId) {
              this.actionRouter.setNavigationSessionId(this.session.sessionId);
            }
            // Clear pending reconnect now that we've successfully connected
            NavigationHandler.consumePendingReconnect();
            // Send structured scan data to server for admin visualization
            this.sendScanDataToServer();
          } else if (status === 'disconnected') {
            // Ignore stale disconnect if already disconnected (e.g. from old WS onclose)
            if (this.connectionState === ConnectionState.DISCONNECTED) return;
            // Re-enable auto-hide so transcript fades out naturally
            this.ui?.setAutoHideEnabled(true);
            this.setConnectionState(ConnectionState.DISCONNECTED);
            this.emit('disconnected');
          }
        },
        onTranscript: (text, speaker, isFinal) => {
          const event: TranscriptEvent = { speaker, text, isFinal };
          this.emit('transcript', event);
          this.ui?.addTranscript(event);

          // Show/hide AI thinking indicator
          if (speaker === 'user' && isFinal) {
            this.ui?.setAIThinking(true);
          } else if (speaker === 'ai' && isFinal) {
            this.ui?.setAIThinking(false);
          }

          // Speak AI responses if TTS is enabled
          if (speaker === 'ai' && isFinal && this.ttsEnabled) {
            this.speak(text);
          }
        },
        onToolCall: async (fc) => {
          const actionEvent: ActionEvent = { name: fc.name, args: fc.args };
          this.emit('action:before', actionEvent);

          // AI responded with action — no longer "thinking"
          this.ui?.setAIThinking(false);

          // Show tool status in UI
          this.ui?.showToolStatus(fc.name);

          const result = await this.actionRouter.route(fc);

          // Remove tool status from UI
          this.ui?.removeToolStatus();

          actionEvent.result = result;
          this.emit('action', actionEvent);

          return result;
        },
        onError: (message) => {
          this.setConnectionState(ConnectionState.ERROR);
          this.emit('error', { message });
        },
        onSessionEnd: (usage) => {
          this.emit('usage', usage);
        },
        onTokenUpdate: (usage) => {
          this.emit('usage', usage);
        },
        onDebug: (event) => {
          if (this.config.debug) {
            console.log(`[VoiceSDK:${event.direction}:${event.kind}]`, event.payload);
          }
        },
        onSpeechStateChange: (active, paused) => {
          this.speechCurrentlyActive = active;
          this.ui?.setSpeechState(active, paused);
        },
      });

      await this.session.connect();
    } catch (error: any) {
      this.setConnectionState(ConnectionState.ERROR);
      this.emit('error', { message: error.message });
    }
  }

  /**
   * Stop the voice session.
   * Keeps transcript visible briefly (auto-hide takes over) so user can see the last conversation.
   */
  async stop(): Promise<void> {
    this.cancelTTS();
    if (this.session) {
      await this.session.disconnect();
      this.session = null;
    }
    // Note: setConnectionState is NOT called here because session.disconnect()
    // triggers the onStatusChange('disconnected') callback which handles it.
    // Only set it if the callback didn't fire (e.g. no session existed).
    if (this.connectionState !== ConnectionState.DISCONNECTED) {
      this.setConnectionState(ConnectionState.DISCONNECTED);
    }
  }

  /**
   * Toggle start/stop.
   * In text mode while connected: toggle panel visibility.
   * In voice mode while connected: disconnect session.
   * While disconnected/error: connect.
   */
  async toggle(): Promise<void> {
    if (this.destroyed) return;
    // Guard against concurrent toggle calls (double-clicks, etc.)
    if (this.toggling) return;

    if (this.resolvedInputMode === 'text' && this.connectionState === ConnectionState.CONNECTED) {
      this.ui?.toggleTranscript();
      return;
    }

    this.toggling = true;
    try {
      if (this.connectionState === ConnectionState.CONNECTED) {
        // If voice mode and speech isn't active (failed/recovering),
        // retry speech with this user gesture instead of killing the session.
        if (this.resolvedInputMode === 'voice' && !this.speechCurrentlyActive && this.session) {
          this.session.retrySpeech();
        } else {
          await this.stop();
        }
      } else if (this.connectionState === ConnectionState.DISCONNECTED || this.connectionState === ConnectionState.ERROR) {
        await this.start();
      }
    } finally {
      this.toggling = false;
    }
  }

  /**
   * Send text directly to the AI (text mode, useful for debugging without mic).
   */
  sendText(text: string): void {
    if (!this.session || this.connectionState !== ConnectionState.CONNECTED) {
      this.emit('error', { message: 'Not connected. Call start() first.' });
      return;
    }
    this.session.sendText(text);
  }

  /**
   * Add a context provider at runtime.
   */
  addContext(provider: ContextProvider): void {
    this.contextEngine.addProvider(provider);
  }

  /**
   * Set or update the developer context text.
   */
  setContext(text: string): void {
    if (this.textProvider) {
      this.textProvider.setText(text);
    } else {
      this.textProvider = new TextProvider(text);
      this.contextEngine.addProvider(this.textProvider);
    }
  }

  /**
   * Register a custom action at runtime.
   */
  registerAction(name: string, action: CustomAction): void {
    this.actionRouter.registerHandler(name, async (args) => {
      const result = await action.handler(args);
      return { result: typeof result === 'string' ? result : JSON.stringify(result ?? { success: true }) };
    });
  }

  /**
   * Remove a custom action.
   */
  removeAction(name: string): void {
    this.actionRouter.removeHandler(name);
  }

  /**
   * Dump scan results for debugging. Returns the current page context.
   */
  async dumpScanResults(): Promise<string> {
    const contextPrompt = await this.contextEngine.buildSystemPrompt();
    if (this.config.debug) {
      console.log('[VoiceSDK:scan] Dump results:', contextPrompt);
    }
    return contextPrompt;
  }

  /**
   * Called when the PageContextProvider detects DOM changes via fingerprinting.
   * Debounced to coalesce rapid triggers (e.g. SPA navigation detected by both
   * NavigationObserver and post-click callback simultaneously).
   */
  private handleContextChange(): void {
    if (this.destroyed) return;
    if (!this.session || this.connectionState !== ConnectionState.CONNECTED) return;

    // Invalidate element lookup caches when DOM changes
    invalidateElementCache();

    // Debounce: coalesce multiple rapid triggers into one context update
    if (this.contextChangeTimer) {
      clearTimeout(this.contextChangeTimer);
    }
    this.contextChangeTimer = setTimeout(() => {
      this.contextChangeTimer = null;
      this.doContextUpdate();
    }, 100);
  }

  /**
   * Actually sends the context update to the server. Called after debounce.
   * Deduplicates: skips if systemInstruction and scan data haven't changed.
   */
  private async doContextUpdate(): Promise<void> {
    if (!this.session || this.connectionState !== ConnectionState.CONNECTED) return;

    try {
      // Single buildContext() call with section-level change detection
      const { systemPrompt: contextPrompt, tools: contextTools, changed } =
        await this.contextEngine.buildSystemPromptAndToolsIfChanged();

      this.wireIndexResolver();

      if (!changed) {
        if (this.config.debug) {
          console.log('[VoiceSDK:context] Skipping context update — no section changes');
        }
        return;
      }

      const allTools = this.buildToolDeclarations(contextTools);
      const toolDescriptions = allTools.map((t) => `- ${t.name}: ${t.description}`).join('\n');

      const systemInstruction = SYSTEM_PROMPT_TEMPLATE
        .replace('{pageContext}', contextPrompt || 'No page context available.')
        .replace('{developerContext}', this.config.context || 'None.')
        .replace('{toolDescriptions}', toolDescriptions || 'None.');

      // Deduplicate: skip if systemInstruction hasn't changed (template-level check)
      if (systemInstruction === this.lastSentSystemInstruction) {
        if (this.config.debug) {
          console.log('[VoiceSDK:context] Skipping duplicate context update');
        }
        return;
      }
      this.lastSentSystemInstruction = systemInstruction;

      if (this.config.debug) {
        console.log('[VoiceSDK:context] DOM changed, sending context update to server');
      }

      this.session.sendContextUpdate(systemInstruction);
      // Send structured scan data for admin visualization
      this.sendScanDataToServer();
    } catch (error: any) {
      if (this.config.debug) {
        console.log('[VoiceSDK:context] Failed to send context update:', error.message);
      }
    }
  }

  /**
   * Handle SPA navigation (pushState/replaceState/popstate).
   * Invalidates caches, re-scans context, and ensures the UI is still visible.
   */
  private handleSPANavigation(event: { from: string; to: string; type: string }): void {
    if (this.config.debug) {
      console.log(`[VoiceSDK:nav] SPA navigation detected: ${event.type} ${event.from} → ${event.to}`);
    }

    // Invalidate element caches — old DOM references are stale
    invalidateElementCache();

    // Ensure UI is still attached (SPA may have replaced body children)
    this.ui?.ensureAttached();

    // Force a context re-scan if we have an active session
    if (this.pageContextProvider) {
      this.pageContextProvider.markDirty();
    }

    // Send updated context to server if connected
    this.handleContextChange();
  }

  /**
   * Handle beforeunload (hard navigation / page close).
   * Saves session state so the SDK can reconnect on the new page.
   */
  private handleBeforeUnload(): void {
    if (this.config.autoReconnect === false) return;
    if (this.connectionState !== ConnectionState.CONNECTED && this.connectionState !== ConnectionState.CONNECTING) return;

    // Save session state to sessionStorage for reconnection
    const state = {
      config: {
        ...this.config,
        actions: this.config.actions ? {
          allowCrossOrigin: this.config.actions.allowCrossOrigin,
        } : undefined,
      },
      sessionId: this.session?.sessionId || undefined,
    };

    try {
      sessionStorage.setItem('voice-sdk-session', JSON.stringify(state));
    } catch {
      // sessionStorage may be full or disabled
    }
  }

  /**
   * Called after clickElement detects a URL change.
   * Forces context re-scan. The debounce in handleContextChange() will coalesce
   * this with NavigationObserver if both fire for the same navigation.
   */
  private handlePostClickNavigation(): void {
    if (this.config.debug) {
      console.log('[VoiceSDK:nav] URL changed after click, forcing context re-scan');
    }
    invalidateElementCache();
    this.ui?.ensureAttached();
    if (this.pageContextProvider) {
      this.pageContextProvider.markDirty();
    }
    this.handleContextChange();
  }

  /**
   * Send structured scan data to the server for admin dashboard visualization.
   * Deduplicates by fingerprint to avoid sending identical scans.
   * Also triggers an automatic screenshot capture when the page URL changes.
   */
  private sendScanDataToServer(): void {
    if (!this.session || !this.pageContextProvider) return;
    const scanData = this.pageContextProvider.getLastScanData();
    if (!scanData) return;

    // Deduplicate: build a quick fingerprint from URL + element count + heading count
    const elCount = Array.isArray(scanData.interactiveElements) ? scanData.interactiveElements.length : 0;
    const hCount = Array.isArray(scanData.headings) ? scanData.headings.length : 0;
    const contentLen = typeof scanData.content === 'string' ? scanData.content.length : 0;
    const fingerprint = `${scanData.url || ''}|${elCount}|${hCount}|${contentLen}`;

    if (fingerprint === this.lastSentScanFingerprint) {
      if (this.config.debug) {
        console.log('[VoiceSDK:scan] Skipping duplicate scan send');
      }
      return;
    }
    this.lastSentScanFingerprint = fingerprint;

    this.session.sendScanResults(scanData);

    // Auto-capture screenshot on URL change (non-blocking)
    const currentUrl = scanData.url || '';
    if (currentUrl !== this.lastScreenshotUrl) {
      this.lastScreenshotUrl = currentUrl;
      // Small delay to let the page render after navigation
      setTimeout(() => this.session?.captureAndSendScreenshot(), 500);
    }
  }

  /**
   * Handle the scanPage tool call — force a re-scan and return fresh context.
   */
  private async handleScanPage(): Promise<{ result: string }> {
    if (this.config.debug) {
      console.log('[VoiceSDK:scan] scanPage tool called, re-scanning');
    }

    // Invalidate element caches before re-scanning
    invalidateElementCache();

    if (this.pageContextProvider) {
      this.pageContextProvider.markDirty();
    }

    try {
      const contextPrompt = await this.contextEngine.buildSystemPrompt();
      this.wireIndexResolver();
      return { result: JSON.stringify({ success: true, context: contextPrompt }) };
    } catch (error: any) {
      return { result: JSON.stringify({ error: error.message }) };
    }
  }

  /**
   * Wire the index resolver from the scanner's getElementByIndex to DOMActions.
   */
  private wireIndexResolver(): void {
    if (this.pageContextProvider) {
      const scanner = this.pageContextProvider.getScanner();
      setIndexResolver((index: number) => scanner.getElementByIndex(index));
    }
  }

  /**
   * Destroy the SDK instance and clean up all resources.
   * Safe to call multiple times (idempotent).
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // Clear singleton reference
    if (VoiceSDK.activeInstance === this) {
      VoiceSDK.activeInstance = null;
    }

    this.cancelTTS();
    await this.stop();
    if (this.contextChangeTimer) {
      clearTimeout(this.contextChangeTimer);
      this.contextChangeTimer = null;
    }
    setIndexResolver(null);
    setRescanCallback(null);
    setPostClickCallback(null);
    this.navigationObserver?.destroy();
    this.navigationObserver = null;
    this.ui?.clearTranscript();
    this.pageContextProvider?.destroy();
    this.ui?.destroy();
    this.removeAllListeners();
    NavigationHandler.clearPendingReconnect();
  }

  /**
   * Get current connection state.
   */
  getConnectionState(): string {
    return this.connectionState;
  }

  /**
   * Speak text using browser TTS.
   * Pauses speech recognition during playback to prevent feedback loop.
   */
  private speak(text: string): void {
    if (typeof speechSynthesis === 'undefined') return;

    // Pause mic to prevent TTS audio being picked up as user speech
    this.session?.pauseSpeech();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.config.language || DEFAULT_LANGUAGE;

    utterance.onend = () => {
      this.session?.resumeSpeech();
    };

    utterance.onerror = () => {
      this.session?.resumeSpeech();
    };

    speechSynthesis.speak(utterance);
  }

  /**
   * Cancel any in-progress or queued TTS playback.
   */
  private cancelTTS(): void {
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }
  }

  private setConnectionState(state: typeof ConnectionState[keyof typeof ConnectionState]): void {
    const from = this.connectionState;
    this.connectionState = state;
    this.ui?.setConnectionState(state);
    this.emit('stateChange', { from, to: state });
  }

  private buildToolDeclarations(contextTools: ToolDeclaration[]): ToolDeclaration[] {
    const tools = [...builtInTools, ...contextTools];

    // Add custom action declarations
    if (this.config.actions?.custom) {
      for (const action of Object.values(this.config.actions.custom)) {
        tools.push(action.declaration);
      }
    }

    return tools;
  }
}

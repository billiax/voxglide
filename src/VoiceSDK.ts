import { EventEmitter } from './events';
import { ProxySession } from './ai/ProxySession';
import { ActionRouter } from './actions/ActionRouter';
import { NavigationHandler } from './actions/NavigationHandler';
import { NavigationObserver } from './NavigationObserver';
import { NbtFunctionsProvider } from './actions/NbtFunctionsProvider';
import { FunctionLoader } from './actions/FunctionLoader';
import { invalidateElementCache, setPostClickCallback } from './actions/DOMActions';
import { BuildModeManager } from './build/BuildModeManager';
import { BuildSpeechCapture } from './build/BuildSpeechCapture';
import { UIManager } from './ui/UIManager';
import { WorkflowEngine } from './workflows/WorkflowEngine';
import { WorkflowContextProvider } from './workflows/WorkflowContextProvider';
import { AccessibilityManager } from './accessibility/AccessibilityManager';
import { a11yTools } from './accessibility/a11y-tools';
import { TTSManager } from './coordinators/TTSManager';
import { ContextCoordinator } from './coordinators/ContextCoordinator';
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
  private contextCoordinator: ContextCoordinator;
  private actionRouter: ActionRouter;
  private ui: UIManager | null = null;
  private connectionState: ConnectionStateValue = ConnectionState.DISCONNECTED;
  private ttsEnabled: boolean;
  private ttsManager: TTSManager;
  private resolvedInputMode: InputMode;
  private toggling = false;
  private navigationObserver: NavigationObserver | null = null;
  private nbtFunctionsProvider: NbtFunctionsProvider | null = null;
  private functionLoader: FunctionLoader | null = null;
  private workflowEngine: WorkflowEngine | null = null;
  private a11yManager: AccessibilityManager | null = null;
  private destroyed = false;
  private panelMode: 'normal' | 'build' = 'normal';
  private buildManager: BuildModeManager | null = null;
  private buildSpeech: BuildSpeechCapture | null = null;
  private speechCurrentlyActive = false;
  /** Whether SpeechCapture intends to be running (user hasn't stopped it). */
  private speechRunning = false;
  /** Reconnect state snapshot taken before old instance's destroy() clears sessionStorage. */
  private pendingReconnectSnapshot: import('./types').SessionState | null = null;

  constructor(config: VoiceSDKConfig) {
    super();

    if (!config || !config.serverUrl) {
      throw new Error('[VoiceSDK] config.serverUrl is required');
    }

    // Snapshot pending reconnect BEFORE destroying old instance.
    // destroy() clears sessionStorage, so we must read first.
    const pendingReconnect = (config.autoReconnect !== false)
      ? NavigationHandler.getPendingReconnect()
      : null;

    // Singleton enforcement: destroy previous instance to prevent ghost
    // WebSocket/SpeechCapture/UI from lingering when re-injected by extensions.
    if (VoiceSDK.activeInstance) {
      VoiceSDK.activeInstance.destroy();
    }
    // Window-level singleton: survives IIFE re-execution by extensions.
    // Each re-injection creates a fresh VoiceSDK class (with activeInstance=null),
    // so the static check above misses instances from prior IIFE loads.
    const prev = (window as any).__voxglideInstance;
    if (prev && typeof prev.destroy === 'function') {
      try { prev.destroy(); } catch { /* ignore */ }
    }
    (window as any).__voxglideInstance = this;
    VoiceSDK.activeInstance = this;

    // DOM-level guard: remove ALL stale SDK host elements. querySelector only
    // returns the first match — if multiple injections raced, several can exist.
    document.querySelectorAll('div[data-voice-sdk]').forEach((el) => el.remove());

    this.config = config;
    this.ttsEnabled = config.tts ?? false;
    this.resolvedInputMode = this.resolveInputMode();

    // Set up TTS manager
    this.ttsManager = new TTSManager({
      config,
      getSession: () => this.session,
      getA11yTtsRate: () => this.a11yManager?.getTtsRate() ?? null,
    });

    // Set up context coordinator (context engine, text/page providers, dedup, scan data)
    this.contextCoordinator = new ContextCoordinator({
      config,
      isDestroyed: () => this.destroyed,
      getSession: () => this.session,
      getConnectionState: () => this.connectionState,
      debug: (...args) => { if (config.debug) console.log(...args); },
      getExtraToolDeclarationSources: () => {
        const sources: Array<() => ToolDeclaration[]> = [];
        if (this.nbtFunctionsProvider) {
          const nbt = this.nbtFunctionsProvider;
          sources.push(() => nbt.getToolDeclarations());
        }
        if (this.a11yManager) {
          sources.push(() => a11yTools);
        }
        return sources;
      },
      onSendScanData: (scanData) => {
        this.session?.sendScanResults(scanData);
      },
      onSendContextUpdate: (pageContext, tools) => {
        this.session?.sendContextUpdate(pageContext, tools);
      },
      onScreenshotUrlChanged: () => {
        // Small delay to let the page render after navigation
        setTimeout(() => this.session?.captureAndSendScreenshot(), 500);
      },
    });

    // Set up action router
    this.actionRouter = new ActionRouter(config);

    // Register scanPage handler
    this.actionRouter.registerHandler('scanPage', async () => {
      return this.contextCoordinator.handleScanPage();
    });

    // Wire post-click callback for SPA navigation detection
    setPostClickCallback(() => this.handlePostClickNavigation());

    // Register custom actions
    if (config.actions?.custom) {
      this.actionRouter.registerCustomActions(config.actions.custom);
    }

    // Auto-discover window.nbt_functions
    if (config.nbtFunctions !== false) {
      this.nbtFunctionsProvider = new NbtFunctionsProvider(
        (added, removed) => this.handleNbtFunctionsChanged(added, removed),
        config.debug,
      );
      const initialActions = this.nbtFunctionsProvider.getActions();
      if (Object.keys(initialActions).length > 0) {
        this.actionRouter.registerCustomActions(initialActions);
      }

      // Auto-load server-side functions (fire-and-forget: loads before start())
      this.functionLoader = new FunctionLoader(config.serverUrl, config.debug);
      this.functionLoader.load().then(() => {
        this.nbtFunctionsProvider?.sync();
      });
    }



    // Set up build mode if configured
    if (config.buildMode) {
      // Derive HTTP URL from WebSocket URL for server-side function persistence
      const buildConfig = { ...config.buildMode };
      if (!buildConfig.serverUrl && config.serverUrl) {
        buildConfig.serverUrl = config.serverUrl
          .replace(/^ws:/, 'http:')
          .replace(/^wss:/, 'https:');
      }

      this.buildManager = new BuildModeManager(
        buildConfig,
        {
          onModeChange: (active, silent) => {
            if (active) {
              this.ui?.showBuildButton();
              this.ui?.renderBuildButton({ visible: true, panelVisible: false, speechActive: false, aiThinking: false });
              if (!silent) {
                this.switchToBuildPanel();
              }
            } else {
              this.ui?.hideBuildButton();
              if (this.panelMode === 'build') {
                this.switchToNormalPanel();
              }
              this.stopBuildSpeech();
            }
          },
          onTranscript: (text, speaker, isFinal) => {
            this.emit('transcript', { speaker, text, isFinal });
            this.ui?.addTranscript({ speaker, text, isFinal });
          },
          onToolsRegistered: (names) => {
            this.ui?.addBuildSystemMessage(`Tools registered: ${names.join(', ')}`);
            this.nbtFunctionsProvider?.sync();
          },
          onToolSavedToServer: () => {
            // Re-fetch from server so FunctionLoader's ownership tracking stays in sync
            if (this.functionLoader) {
              this.functionLoader.invalidate();
              this.functionLoader.load().then(() => this.nbtFunctionsProvider?.sync());
            }
          },
          onPendingTool: (tool) => {
            this.ui?.addPendingTool(
              tool,
              () => this.buildManager?.acceptTool(tool.name),
              () => this.buildManager?.rejectTool(tool.name),
            );
          },
          onToolLoopStatus: (status) => {
            this.ui?.setToolLoopStatus(status);
          },
          onError: (message) => {
            this.emit('error', { message });
            this.ui?.addSystemMessage(`Build error: ${message}`);
          },
          onLoadingChange: (loading) => {
            this.ui?.setAIThinking(loading);
            if (this.panelMode === 'build') {
              this.ui?.renderBuildButton({
                visible: true,
                panelVisible: this.ui?.isPanelVisible() ?? false,
                speechActive: this.buildSpeech?.isRunning() ?? false,
                aiThinking: loading,
              });
            }
          },
          onDebug: (msg) => {
            if (config.debug) console.log(`[VoiceSDK:build] ${msg}`);
          },
        },
        {
          getPageContextProvider: () => this.contextCoordinator.getPageContextProvider(),
        },
      );
    }

    // Set up workflows
    if (config.workflows && config.workflows.length > 0) {
      this.workflowEngine = new WorkflowEngine(config.workflows, (event, data) => {
        if (event === 'cancel') {
          this.emit('workflow:cancel', data as { name: string; reason: string });
        } else {
          this.emit(`workflow:${event}` as any, data);
        }
      });

      // Register workflow tool handlers
      this.actionRouter.registerHandler('startWorkflow', async (args) => {
        const result = this.workflowEngine!.startWorkflow(args.name as string);
        return { result: JSON.stringify(result) };
      });
      this.actionRouter.registerHandler('workflowStepComplete', async (args) => {
        const result = this.workflowEngine!.advanceStep(
          args.field as string | undefined,
          args.value as string | undefined,
        );
        return { result: JSON.stringify(result) };
      });
      this.actionRouter.registerHandler('cancelWorkflow', async (args) => {
        this.workflowEngine!.cancelWorkflow((args.reason as string) ?? 'Cancelled by AI');
        return { result: JSON.stringify({ success: true }) };
      });
      this.actionRouter.registerHandler('getWorkflowStatus', async () => {
        return { result: JSON.stringify(this.workflowEngine!.getState()) };
      });

      // Add context provider
      const workflowProvider = new WorkflowContextProvider(this.workflowEngine);
      this.contextCoordinator.addProvider(workflowProvider);
    }

    // Set up accessibility mode
    if (config.accessibility) {
      const a11yConfig = config.accessibility === true ? {} : config.accessibility;
      this.a11yManager = new AccessibilityManager(a11yConfig, () => this.toggle());
      this.registerA11yToolHandlers();
    }

    // Set up UI (unless disabled)
    if (config.ui !== false) {
      this.ui = new UIManager(
        typeof config.ui === 'object' ? config.ui : {},
        () => this.toggle(),
        (text) => this.sendText(text),
        this.resolvedInputMode,
        () => this.toggleBuild(),
      );
      // Wire accessibility to Shadow DOM host if enabled
      if (this.a11yManager) {
        this.a11yManager.setShadowHost(this.ui.getHost());
      }
    }

    // Wire panel header handlers
    if (this.ui) {
      this.ui.setDisconnectHandler(() => this.stop());
      this.ui.setMinimizeHandler(() => this.ui?.hideTranscript());
      this.ui.setRefreshHandler(() => this.resetBuildSession());
    }

    // Auto-restore build mode if previously active (persisted across page loads).
    // Silent activation just shows the build button — no panel, no message.
    // The session ID is silently preserved so the next user message continues
    // the same Claude conversation. Only tool-loop interruptions get special UI.
    if (this.buildManager && BuildModeManager.isPersistedActive()) {
      this.buildManager.activate({ silent: true });

      if (this.buildManager.hasPendingResume()) {
        // Tool loop was interrupted by navigation — show panel and auto-resume
        this.switchToBuildPanel();
        this.ui?.clearTranscript();
        this.stopBuildSpeech();
        this.ui?.addBuildSystemMessage('Resuming after page navigation...');
        const scanDelay = this.getAutoContextConfig()?.scanDelay ?? 500;
        setTimeout(async () => {
          if (this.functionLoader) {
            await this.functionLoader.ready();
            this.nbtFunctionsProvider?.sync();
          }
          this.buildManager?.resumeAfterNavigation();
        }, scanDelay);
      }
    }

    // Set up SPA navigation detection + beforeunload session persistence
    this.navigationObserver = new NavigationObserver(
      (event) => this.handleSPANavigation(event),
      () => this.handleBeforeUnload(),
    );

    // Auto-reconnect from navigation (using snapshot taken before destroy wiped sessionStorage)
    if (pendingReconnect) {
      this.pendingReconnectSnapshot = pendingReconnect;
      // Restore transcript from previous page
      this.ui?.restoreTranscript();
      // Show the panel immediately so the user sees continuity
      this.ui?.showTranscript();
      // Delay to let the DOM settle after page load.
      // Don't pre-set CONNECTING here — start() sets it and also guards against
      // duplicate calls by checking for CONNECTING. Setting it here would cause
      // start() to bail out immediately, leaving the button stuck as a spinner.
      const scanDelay = this.getAutoContextConfig()?.scanDelay ?? 500;
      setTimeout(() => this.start(), scanDelay);
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
    this.contextCoordinator.resetDedupState();

    // Wait for in-flight function load (non-blocking if already done).
    // This piggybacks on the constructor's eager load — it does NOT start a new fetch.
    // If the load is still pending, we wait briefly so tool declarations are included
    // in session.start. If it already finished, this resolves instantly.
    if (this.functionLoader) {
      await this.functionLoader.ready();
      this.nbtFunctionsProvider?.sync();
    }

    try {
      // Check for stored sessionId from navigation reconnect.
      // Use the snapshot taken in the constructor (sessionStorage may already be cleared
      // by destroy() of the previous instance).
      let storedSessionId: string | undefined;
      const pending = this.pendingReconnectSnapshot ?? NavigationHandler.getPendingReconnect();
      if (pending?.sessionId) {
        storedSessionId = pending.sessionId;
      } else {
        // Fresh start (not navigation reconnect) — clear stale transcript
        // so the user gets a clean slate. The AI has no memory of old messages.
        this.ui?.clearTranscript();
      }
      // Clear snapshot after use — one-time consumption
      this.pendingReconnectSnapshot = null;

      // Build context and system prompt (single buildContext() call)
      const { systemPrompt: contextPrompt, tools: contextTools } = await this.contextCoordinator.contextEngine.buildSystemPromptAndTools();

      // Combine built-in + context + custom tool declarations
      const allTools = this.contextCoordinator.buildToolDeclarations(contextTools);

      const systemInstruction = SYSTEM_PROMPT_TEMPLATE
        .replace('{developerContext}', this.config.context || 'None.');

      const sessionConfig: ProxySessionConfig = {
        serverUrl: this.config.serverUrl,
        systemInstruction,
        pageContext: contextPrompt || '',
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
            // Disable auto-hide during active session — user controls visibility
            // via the minimize button. Re-enabled on disconnect.
            this.ui?.setAutoHideEnabled(false);
            // Show transcript panel immediately so user can see input + type
            this.ui?.showTranscript();
            // Store sessionId for navigation handler
            if (this.session?.sessionId) {
              this.actionRouter.setNavigationSessionId(this.session.sessionId);
            }
            // Clear pending reconnect now that we've successfully connected
            NavigationHandler.consumePendingReconnect();
            // Send structured scan data to server for admin visualization
            this.contextCoordinator.sendScanDataToServer();
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

          // Hide AI thinking indicator on final AI response
          // (queue panel now shows processing state instead of thinking indicator on user send)
          if (speaker === 'ai' && isFinal) {
            this.ui?.setAIThinking(false);
          }

          // Speak AI responses if TTS is enabled
          if (speaker === 'ai' && isFinal && this.ttsEnabled) {
            this.ui?.setPauseReason('tts');
            this.ttsManager.speak(text);
          }
        },
        onToolCall: async (fc) => {
          const actionEvent: ActionEvent = { name: fc.name, args: fc.args };
          this.emit('action:before', actionEvent);

          // AI responded with action — no longer "thinking"
          this.ui?.setAIThinking(false);

          // Show tool status in UI
          this.ui?.setToolLoopStatus(fc.name);

          const result = await this.actionRouter.route(fc);

          // Remove tool status from UI
          this.ui?.setToolLoopStatus(null);

          actionEvent.result = result;
          this.emit('action', actionEvent);

          // Accessibility: announce action result
          this.a11yManager?.announceAction(fc.name, fc.args);

          return result;
        },
        onError: (message) => {
          this.setConnectionState(ConnectionState.ERROR);
          this.ui?.setAIThinking(false);
          this.ui?.setToolLoopStatus(null);
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
        onSpeechStateChange: (active, paused, running) => {
          this.speechCurrentlyActive = active;
          this.speechRunning = running;
          this.ui?.setSpeechState(active, paused);
          // Clear pause reason when speech successfully resumes
          if (active && !paused) {
            this.ui?.setPauseReason(null);
          }
        },
        onSpeechError: (error, retriesLeft) => {
          this.ui?.setPauseReason('mic-error');
          if (retriesLeft === 0) {
            this.ui?.addSystemMessage('Microphone unavailable. Use text input instead.');
            this.ui?.setPauseReason(null);
          } else if (error === 'not-allowed') {
            this.ui?.addSystemMessage('Microphone access denied. Check browser permissions.');
          } else {
            this.ui?.addSystemMessage('Microphone busy — retrying...');
          }
        },
        onQueueOverflow: () => {
          this.ui?.addSystemMessage('Message not sent — connection interrupted. Please try again.');
        },
        onQueueUpdate: (queue) => {
          this.ui?.updateQueue(queue);
        },
      });

      // Wire cancel handler from queue panel to session
      this.ui?.setCancelHandler((turnId) => this.session?.cancelTurn(turnId));

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
    this.ttsManager.cancel();
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
   * Toggle — 3-state button behavior:
   *
   * Voice mode (primary):
   *   Disconnected/error → start (connect + mic + open panel)
   *   Connected + panel visible → stop (disconnect session)
   *   Connected + panel hidden (minimized) → show panel
   *   Connected + speech failed but retrying → retry with user gesture
   *
   * Text mode (backup/testing):
   *   Disconnected/error → start
   *   Connected → toggle panel visibility (session persists)
   */
  async toggle(): Promise<void> {
    if (this.destroyed) return;
    // Guard against concurrent toggle calls (double-clicks, etc.)
    if (this.toggling) return;

    // If build panel is showing, switch to normal mode first
    if (this.panelMode === 'build') {
      this.switchToNormalPanel();
    }

    if (this.connectionState === ConnectionState.CONNECTED) {
      if (this.resolvedInputMode === 'text') {
        // Text mode: always toggle panel visibility, session persists
        this.ui?.toggleTranscript();
        return;
      }

      // Voice mode: 3-state logic
      if (!this.speechCurrentlyActive && this.speechRunning && this.session) {
        // Speech failed but intending to run — retry with user gesture
        this.session.retrySpeech();
        return;
      }

      const panelVisible = this.ui?.getStateMachine().getState().panelVisible ?? true;
      if (panelVisible) {
        // Panel visible → stop session (one-click stop, like every voice assistant)
        this.toggling = true;
        try {
          await this.stop();
        } finally {
          this.toggling = false;
        }
      } else {
        // Panel hidden (user minimized) → show panel, session stays alive
        this.ui?.showTranscript();
      }
      return;
    }

    this.toggling = true;
    try {
      if (this.connectionState === ConnectionState.DISCONNECTED || this.connectionState === ConnectionState.ERROR) {
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
    // Build mode panel: route to BuildModeManager
    if (this.panelMode === 'build' && this.buildManager?.isActive()) {
      this.buildManager.sendMessage(text);
      return;
    }

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
    this.contextCoordinator.addProvider(provider);
  }

  /**
   * Set or update the developer context text.
   */
  setContext(text: string): void {
    this.contextCoordinator.setContext(text);
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
   * Toggle build mode on/off.
   * When active, user messages are sent to the Claude Code API for tool generation.
   */
  toggleBuildMode(): void {
    if (!this.buildManager) {
      this.emit('error', { message: 'Build mode not configured. Set buildMode in config.' });
      return;
    }
    this.buildManager.toggle();
  }

  /**
   * Check if build mode is currently active.
   */
  isBuildModeActive(): boolean {
    return this.buildManager?.isActive() ?? false;
  }

  /**
   * Set build mode active/inactive programmatically.
   */
  setBuildMode(active: boolean): void {
    if (!this.buildManager) return;
    if (active) this.buildManager.activate();
    else this.buildManager.deactivate();
  }

  /**
   * Toggle build panel — called when the build button is clicked.
   */
  private toggleBuild(): void {
    if (this.destroyed) return;
    if (!this.buildManager) return;

    if (this.panelMode === 'build' && this.ui?.isPanelVisible()) {
      // Build panel showing — toggle build speech on/off
      if (this.buildSpeech?.isRunning()) {
        this.stopBuildSpeech();
      } else {
        this.startBuildSpeech();
      }
    } else {
      // Switch to build panel
      this.switchToBuildPanel();
    }
  }

  /**
   * Switch the transcript panel to build mode.
   */
  private switchToBuildPanel(): void {
    this.panelMode = 'build';
    this.ui?.clearTranscript();
    this.ui?.setTranscriptBuildMode(true, 'Build Mode');
    this.ui?.showTranscript();
    this.ui?.setAutoHideEnabled(false);
    this.ui?.showRefreshButton();
    this.ui?.addBuildSystemMessage('Build mode active \u2014 describe the tool you want to create.');
    this.startBuildSpeech();
    // Update build button state
    this.ui?.renderBuildButton({
      visible: true,
      panelVisible: true,
      speechActive: this.buildSpeech?.isRunning() ?? false,
      aiThinking: false,
    });
  }

  /**
   * Switch the transcript panel back to normal mode.
   */
  private switchToNormalPanel(): void {
    this.panelMode = 'normal';
    this.stopBuildSpeech();
    this.ui?.clearTranscript();
    this.ui?.setTranscriptBuildMode(false, 'Assistant');
    this.ui?.hideRefreshButton();
    this.ui?.setAutoHideEnabled(true);
    // Update build button state — panel no longer showing build
    this.ui?.renderBuildButton({
      visible: this.buildManager?.isActive() ?? false,
      panelVisible: false,
      speechActive: false,
      aiThinking: false,
    });
  }

  /**
   * Reset the build session — starts a fresh conversation.
   */
  private resetBuildSession(): void {
    if (!this.buildManager) return;
    this.buildManager.newSession();
    this.ui?.clearTranscript();
    this.ui?.addBuildSystemMessage('New build session started.');
  }

  /**
   * Dump scan results for debugging. Returns the current page context.
   */
  async dumpScanResults(): Promise<string> {
    return this.contextCoordinator.dumpScanResults();
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

    // Re-load server functions for the new URL, then sync nbt_functions
    if (this.functionLoader) {
      this.functionLoader.reload().then(() => {
        this.nbtFunctionsProvider?.sync();
      });
    } else {
      this.nbtFunctionsProvider?.sync();
    }

    // Begin watch period for DOM stability before scanning
    const pageCtx = this.contextCoordinator.getPageContextProvider();
    if (pageCtx) {
      pageCtx.markDirty();
      pageCtx.beginWatchPeriod();
    }

    // Send updated context to server if connected
    this.contextCoordinator.handleContextChange();
  }

  /**
   * Handle beforeunload (hard navigation / page close).
   * Saves session state so the SDK can reconnect on the new page.
   */
  private handleBeforeUnload(): void {
    // Save build mode session state (independent of voice session autoReconnect)
    if (this.buildManager?.isActive()) {
      this.buildManager.saveSessionState();
    }

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
    const pageCtx = this.contextCoordinator.getPageContextProvider();
    if (pageCtx) {
      pageCtx.markDirty();
    }
    this.contextCoordinator.handleContextChange();
  }

  /**
   * Handle nbt_functions changes (added/removed functions).
   * Re-registers handlers with ActionRouter and pushes updated tools to server if connected.
   */
  private handleNbtFunctionsChanged(added: string[], removed: string[]): void {
    for (const name of removed) {
      this.actionRouter.removeHandler(name);
    }
    if (this.nbtFunctionsProvider && added.length > 0) {
      const allActions = this.nbtFunctionsProvider.getActions();
      const newActions: Record<string, import('./types').CustomAction> = {};
      for (const name of added) {
        if (allActions[name]) newActions[name] = allActions[name];
      }
      if (Object.keys(newActions).length > 0) {
        this.actionRouter.registerCustomActions(newActions);
      }
    }
    // Push updated tools to server if mid-session
    if (this.session && this.connectionState === ConnectionState.CONNECTED) {
      this.contextCoordinator.handleContextChange();
    }
  }

  /**
   * Register accessibility tool handlers on the ActionRouter.
   */
  private registerA11yToolHandlers(): void {
    this.actionRouter.registerHandler('describePage', async () => {
      const landmarks = Array.from(document.querySelectorAll('[role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"], nav, main, header, footer, aside'));
      const landmarkInfo = landmarks.map(el => `${el.tagName.toLowerCase()}[role="${el.getAttribute('role') ?? el.tagName.toLowerCase()}"]`);
      const forms = document.querySelectorAll('form').length;
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
      const links = document.querySelectorAll('a').length;
      const buttons = document.querySelectorAll('button, [role="button"]').length;
      const inputs = document.querySelectorAll('input, select, textarea').length;

      const description = [
        `Page: ${document.title}`,
        `Landmarks: ${landmarkInfo.length > 0 ? landmarkInfo.join(', ') : 'none'}`,
        `Forms: ${forms}, Headings: ${headings}, Links: ${links}, Buttons: ${buttons}, Inputs: ${inputs}`,
      ].join('\n');

      this.a11yManager?.announce('Page described');
      return { result: JSON.stringify({ success: true, description }) };
    });

    this.actionRouter.registerHandler('focusElement', async (args) => {
      let el: HTMLElement | null = null;

      if (args.index !== undefined) {
        const scanner = this.contextCoordinator.getPageContextProvider()?.getScanner();
        el = scanner?.getElementByIndex(args.index as number) ?? null;
      } else if (args.selector) {
        el = document.querySelector(args.selector as string);
      } else if (args.description) {
        const desc = (args.description as string).toLowerCase();
        const all = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [tabindex]');
        for (const candidate of all) {
          if ((candidate.textContent?.toLowerCase() ?? '').includes(desc) ||
              (candidate.getAttribute('aria-label')?.toLowerCase() ?? '').includes(desc)) {
            el = candidate as HTMLElement;
            break;
          }
        }
      }

      if (el) {
        this.a11yManager?.focusElement(el);
        this.a11yManager?.announce(`Focused: ${el.textContent?.trim().slice(0, 50) || el.tagName}`);
        return { result: JSON.stringify({ success: true }) };
      }
      return { result: JSON.stringify({ error: 'Element not found' }) };
    });

    this.actionRouter.registerHandler('listLandmarks', async () => {
      const selectors = '[role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"], nav, main, header, footer, aside';
      const landmarks = Array.from(document.querySelectorAll(selectors)).map(el => ({
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        name: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '',
        tag: el.tagName.toLowerCase(),
        contentPreview: (el.textContent ?? '').trim().slice(0, 100),
      }));
      return { result: JSON.stringify({ success: true, landmarks }) };
    });

    this.actionRouter.registerHandler('readHeadings', async () => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(el => ({
        level: parseInt(el.tagName[1]),
        text: el.textContent?.trim() ?? '',
      }));
      const tree = headings.map(h => `${'  '.repeat(h.level - 1)}h${h.level}: ${h.text}`).join('\n');
      return { result: JSON.stringify({ success: true, headings: tree }) };
    });

    this.actionRouter.registerHandler('nextFormField', async () => {
      const fields = Array.from(document.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea'));
      if (fields.length === 0) return { result: JSON.stringify({ error: 'No form fields found' }) };
      const cursor = (this.a11yManager?.getFormCursor() ?? -1) + 1;
      const idx = cursor >= fields.length ? 0 : cursor;
      this.a11yManager?.setFormCursor(idx);
      this.a11yManager?.focusElement(fields[idx]);
      const label = fields[idx].getAttribute('aria-label') || fields[idx].getAttribute('name') || fields[idx].tagName;
      this.a11yManager?.announce(`Field: ${label}`);
      return { result: JSON.stringify({ success: true, fieldIndex: idx, label }) };
    });

    this.actionRouter.registerHandler('prevFormField', async () => {
      const fields = Array.from(document.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea'));
      if (fields.length === 0) return { result: JSON.stringify({ error: 'No form fields found' }) };
      const cursor = (this.a11yManager?.getFormCursor() ?? 1) - 1;
      const idx = cursor < 0 ? fields.length - 1 : cursor;
      this.a11yManager?.setFormCursor(idx);
      this.a11yManager?.focusElement(fields[idx]);
      const label = fields[idx].getAttribute('aria-label') || fields[idx].getAttribute('name') || fields[idx].tagName;
      this.a11yManager?.announce(`Field: ${label}`);
      return { result: JSON.stringify({ success: true, fieldIndex: idx, label }) };
    });
  }

  // ── Build mode speech capture ──

  private startBuildSpeech(): void {
    if (this.resolvedInputMode !== 'voice') return;
    if (this.buildSpeech) return;

    this.buildSpeech = new BuildSpeechCapture(
      this.config.language ?? DEFAULT_LANGUAGE,
      {
        onInterimResult: (text) => {
          this.ui?.addTranscript({ speaker: 'user', text, isFinal: false });
        },
        onFinalMessage: (text) => {
          if (this.buildManager?.isActive()) {
            this.buildManager.sendMessage(text);
          }
        },
        onStatusChange: (active) => {
          this.ui?.setSpeechState(active, false);
          if (this.panelMode === 'build') {
            this.ui?.renderBuildButton({
              visible: true,
              panelVisible: this.ui?.isPanelVisible() ?? false,
              speechActive: active,
              aiThinking: false,
            });
          }
        },
      },
    );
    this.buildSpeech.start();

    if (this.config.debug) {
      console.log('[VoiceSDK:build] Speech capture started');
    }
  }

  private stopBuildSpeech(): void {
    this.buildSpeech?.stop();
    this.buildSpeech = null;
    this.ui?.setSpeechState(false, false);
  }

  /**
   * Destroy the SDK instance and clean up all resources.
   * Safe to call multiple times (idempotent).
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // Clear singleton references (both class-level and window-level)
    if (VoiceSDK.activeInstance === this) {
      VoiceSDK.activeInstance = null;
    }
    if ((window as any).__voxglideInstance === this) {
      (window as any).__voxglideInstance = null;
    }

    // Destroy UI FIRST (synchronous) to prevent the ensureAttached() interval
    // from resurrecting the host element during the async stop() below.
    this.ui?.clearTranscript();
    this.ui?.destroy();
    this.ui = null;

    this.stopBuildSpeech();
    this.buildManager?.destroy();
    this.buildManager = null;
    this.ttsManager.cancel();
    await this.stop();
    this.contextCoordinator.destroy();
    setPostClickCallback(null);
    this.nbtFunctionsProvider?.destroy();
    this.nbtFunctionsProvider = null;
    this.a11yManager?.destroy();
    this.a11yManager = null;
    this.navigationObserver?.destroy();
    this.navigationObserver = null;
    this.removeAllListeners();
    NavigationHandler.clearPendingReconnect();
  }

  /**
   * Get current connection state.
   */
  getConnectionState(): string {
    return this.connectionState;
  }

  private setConnectionState(state: typeof ConnectionState[keyof typeof ConnectionState]): void {
    const from = this.connectionState;
    this.connectionState = state;
    this.ui?.setConnectionState(state);
    this.emit('stateChange', { from, to: state });
  }

  private getAutoContextConfig(): import('./types').AutoContextConfig | null {
    if (this.config.autoContext === false || this.config.autoContext === undefined) return null;
    if (this.config.autoContext === true) return {};
    return this.config.autoContext;
  }
}

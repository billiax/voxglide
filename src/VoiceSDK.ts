import { EventEmitter } from './events';
import { ProxySession } from './ai/ProxySession';
import { ContextEngine } from './context/ContextEngine';
import { TextProvider } from './context/TextProvider';
import { PageContextProvider } from './context/PageContextProvider';
import { ActionRouter } from './actions/ActionRouter';
import { NavigationHandler } from './actions/NavigationHandler';
import { invalidateElementCache } from './actions/DOMActions';
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

  constructor(config: VoiceSDKConfig) {
    super();
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

    // Check for pending reconnect from navigation
    if (config.autoReconnect !== false) {
      const pending = NavigationHandler.getPendingReconnect();
      if (pending) {
        // Restore transcript from previous page
        this.ui?.restoreTranscript();
        setTimeout(() => this.start(), 500);
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
    if (this.connectionState === ConnectionState.CONNECTED || this.connectionState === ConnectionState.CONNECTING) {
      return;
    }

    this.setConnectionState(ConnectionState.CONNECTING);

    try {
      // Check for stored sessionId from navigation reconnect
      let storedSessionId: string | undefined;
      const pending = NavigationHandler.getPendingReconnect();
      if (pending?.sessionId) {
        storedSessionId = pending.sessionId;
      }

      // Build context and system prompt
      const contextPrompt = await this.contextEngine.buildSystemPrompt();
      const contextTools = await this.contextEngine.getTools();

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
    // Guard against concurrent toggle calls (double-clicks, etc.)
    if (this.toggling) return;

    if (this.resolvedInputMode === 'text' && this.connectionState === ConnectionState.CONNECTED) {
      this.ui?.toggleTranscript();
      return;
    }

    this.toggling = true;
    try {
      if (this.connectionState === ConnectionState.CONNECTED) {
        await this.stop();
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
   * Sends an updated context to the server mid-session.
   */
  private async handleContextChange(): Promise<void> {
    if (!this.session || this.connectionState !== ConnectionState.CONNECTED) return;

    // Invalidate element lookup caches when DOM changes
    invalidateElementCache();

    if (this.config.debug) {
      console.log('[VoiceSDK:context] DOM changed, sending context update to server');
    }

    try {
      const contextPrompt = await this.contextEngine.buildSystemPrompt();
      const contextTools = await this.contextEngine.getTools();
      const allTools = this.buildToolDeclarations(contextTools);
      const toolDescriptions = allTools.map((t) => `- ${t.name}: ${t.description}`).join('\n');

      const systemInstruction = SYSTEM_PROMPT_TEMPLATE
        .replace('{pageContext}', contextPrompt || 'No page context available.')
        .replace('{developerContext}', this.config.context || 'None.')
        .replace('{toolDescriptions}', toolDescriptions || 'None.');

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
   * Send structured scan data to the server for admin dashboard visualization.
   */
  private sendScanDataToServer(): void {
    if (!this.session || !this.pageContextProvider) return;
    const scanData = this.pageContextProvider.getLastScanData();
    if (scanData) {
      this.session.sendScanResults(scanData);
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
      return { result: JSON.stringify({ success: true, context: contextPrompt }) };
    } catch (error: any) {
      return { result: JSON.stringify({ error: error.message }) };
    }
  }

  /**
   * Destroy the SDK instance and clean up all resources.
   */
  async destroy(): Promise<void> {
    this.cancelTTS();
    await this.stop();
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

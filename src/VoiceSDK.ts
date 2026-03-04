import { EventEmitter } from './events';
import { LiveSession } from './ai/LiveSession';
import { ContextEngine } from './context/ContextEngine';
import { TextProvider } from './context/TextProvider';
import { PageContextProvider } from './context/PageContextProvider';
import { ActionRouter } from './actions/ActionRouter';
import { NavigationHandler } from './actions/NavigationHandler';
import { builtInTools } from './actions/tools';
import { UIManager } from './ui/UIManager';
import { ConnectionState, DEFAULT_MODEL, DEFAULT_VOICE, SYSTEM_PROMPT_TEMPLATE } from './constants';
import type { ConnectionStateValue } from './constants';
import type {
  VoiceSDKConfig, VoiceSDKEvents, ContextProvider, CustomAction,
  ToolDeclaration, TranscriptEvent, ActionEvent,
} from './types';
import type { LiveSessionConfig } from './ai/types';

export class VoiceSDK extends EventEmitter<VoiceSDKEvents> {
  private config: VoiceSDKConfig;
  private liveSession: LiveSession | null = null;
  private contextEngine: ContextEngine;
  private actionRouter: ActionRouter;
  private pageContextProvider: PageContextProvider | null = null;
  private textProvider: TextProvider | null = null;
  private ui: UIManager | null = null;
  private connectionState: ConnectionStateValue = ConnectionState.DISCONNECTED;

  constructor(config: VoiceSDKConfig) {
    super();
    this.config = config;

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
      this.pageContextProvider = new PageContextProvider(autoConfig);
      this.contextEngine.addProvider(this.pageContextProvider);
    }

    // Set up action router
    this.actionRouter = new ActionRouter(config);

    // Register custom actions
    if (config.actions?.custom) {
      this.actionRouter.registerCustomActions(config.actions.custom);
    }

    // Set up UI (unless disabled)
    if (config.ui !== false) {
      this.ui = new UIManager(
        typeof config.ui === 'object' ? config.ui : {},
        () => this.toggle()
      );
    }

    // Check for pending reconnect from navigation
    if (config.autoReconnect !== false) {
      const pending = NavigationHandler.getPendingReconnect();
      if (pending) {
        // Auto-start after a brief delay to let the page settle
        setTimeout(() => this.start(), 500);
      }
    }
  }

  /**
   * Start the voice session — connect to Gemini and begin listening.
   */
  async start(): Promise<void> {
    if (this.connectionState === ConnectionState.CONNECTED || this.connectionState === ConnectionState.CONNECTING) {
      return;
    }

    this.setConnectionState(ConnectionState.CONNECTING);

    try {
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

      const voiceConfig = { ...DEFAULT_VOICE, ...this.config.voice };

      const sessionConfig: LiveSessionConfig = {
        apiKey: this.config.apiKey,
        model: this.config.model || DEFAULT_MODEL,
        systemInstruction,
        tools: [{ functionDeclarations: allTools }],
        voiceName: voiceConfig.voiceName,
        languageCode: voiceConfig.languageCode,
        silenceDurationMs: voiceConfig.silenceDurationMs,
        startSensitivity: voiceConfig.startSensitivity,
        endSensitivity: voiceConfig.endSensitivity,
        debug: this.config.debug ?? false,
      };

      this.liveSession = new LiveSession(sessionConfig, {
        onStatusChange: (status) => {
          if (status === 'connected') {
            this.setConnectionState(ConnectionState.CONNECTED);
            this.emit('connected');
          } else if (status === 'disconnected') {
            this.setConnectionState(ConnectionState.DISCONNECTED);
            this.emit('disconnected');
          }
        },
        onTranscript: (text, speaker, isFinal) => {
          const event: TranscriptEvent = { speaker, text, isFinal };
          this.emit('transcript', event);
          this.ui?.addTranscript(event);
        },
        onToolCall: async (fc) => {
          const actionEvent: ActionEvent = { name: fc.name, args: fc.args };
          this.emit('action:before', actionEvent);

          const result = await this.actionRouter.route(fc);

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

      await this.liveSession.connect();
    } catch (error: any) {
      this.setConnectionState(ConnectionState.ERROR);
      this.emit('error', { message: error.message });
    }
  }

  /**
   * Stop the voice session.
   */
  async stop(): Promise<void> {
    if (this.liveSession) {
      await this.liveSession.disconnect();
      this.liveSession = null;
    }
    this.setConnectionState(ConnectionState.DISCONNECTED);
    this.ui?.clearTranscript();
  }

  /**
   * Toggle start/stop.
   */
  async toggle(): Promise<void> {
    if (this.connectionState === ConnectionState.CONNECTED) {
      await this.stop();
    } else if (this.connectionState === ConnectionState.DISCONNECTED || this.connectionState === ConnectionState.ERROR) {
      await this.start();
    }
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
   * Destroy the SDK instance and clean up all resources.
   */
  async destroy(): Promise<void> {
    await this.stop();
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

import type { FunctionCall, CustomAction } from '../types';
import { fillField, clickElement, readContent } from './DOMActions';
import { NavigationHandler } from './NavigationHandler';
import type { VoiceSDKConfig } from '../types';

type ActionHandler = (args: Record<string, unknown>) => Promise<{ result: string }>;

/**
 * Routes AI tool calls to appropriate handlers.
 * Built-in handlers: fillField, clickElement, readContent, navigateTo.
 * Custom handlers can be registered via registerHandler().
 */
export class ActionRouter {
  private handlers = new Map<string, ActionHandler>();
  private navigationHandler: NavigationHandler;

  constructor(config: VoiceSDKConfig) {
    this.navigationHandler = new NavigationHandler(config);

    // Register built-in DOM action handlers
    this.handlers.set('fillField', fillField);
    this.handlers.set('clickElement', clickElement);
    this.handlers.set('readContent', readContent);
    this.handlers.set('navigateTo', (args) => this.navigationHandler.navigateTo(args));
  }

  /**
   * Pass the server-assigned sessionId to the navigation handler for reconnect persistence.
   */
  setNavigationSessionId(sessionId: string): void {
    this.navigationHandler.setSessionId(sessionId);
  }

  registerHandler(toolName: string, handler: ActionHandler): void {
    this.handlers.set(toolName, handler);
  }

  removeHandler(toolName: string): void {
    this.handlers.delete(toolName);
  }

  /**
   * Register custom actions from config.
   */
  registerCustomActions(actions: Record<string, CustomAction>): void {
    for (const [name, action] of Object.entries(actions)) {
      this.handlers.set(name, async (args) => {
        const result = await action.handler(args);
        return { result: typeof result === 'string' ? result : JSON.stringify(result ?? { success: true }) };
      });
    }
  }

  /**
   * Route a single function call to its handler.
   */
  async route(fc: FunctionCall): Promise<{ result: string }> {
    const handler = this.handlers.get(fc.name);

    if (handler) {
      try {
        return await handler(fc.args);
      } catch (err: any) {
        return { result: JSON.stringify({ error: err.message }) };
      }
    }

    return { result: JSON.stringify({ error: `Unknown action: "${fc.name}"` }) };
  }
}

import { ContextEngine } from '../context/ContextEngine';
import { TextProvider } from '../context/TextProvider';
import { PageContextProvider } from '../context/PageContextProvider';
import { invalidateElementCache, setIndexResolver, setRescanCallback } from '../actions/DOMActions';
import { builtInTools } from '../actions/tools';
import { ConnectionState } from '../constants';
import type { ContextProvider, ToolDeclaration } from '../types';
import type { ContextCoordinatorDeps } from './types';

/**
 * Manages context engine, text/page providers, dedup, scan data, and tool declarations.
 */
export class ContextCoordinator {
  readonly contextEngine: ContextEngine;
  private pageContextProvider: PageContextProvider | null = null;
  private textProvider: TextProvider | null = null;
  private contextChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSentPageContext: string | null = null;
  private lastSentScanFingerprint: string | null = null;
  private lastScreenshotUrl: string | null = null;
  private deps: ContextCoordinatorDeps;

  constructor(deps: ContextCoordinatorDeps) {
    this.deps = deps;
    this.contextEngine = new ContextEngine();

    // Developer-supplied context
    if (deps.config.context) {
      this.textProvider = new TextProvider(deps.config.context);
      this.contextEngine.addProvider(this.textProvider);
    }

    // Auto page context
    if (deps.config.autoContext !== false && deps.config.autoContext !== undefined) {
      const autoConfig = deps.config.autoContext === true ? true : deps.config.autoContext;
      this.pageContextProvider = new PageContextProvider(autoConfig, () => this.handleContextChange());
      this.contextEngine.addProvider(this.pageContextProvider);
    }

    // Wire index resolver and rescan callback for self-healing
    this.wireIndexResolver();
    setRescanCallback(async () => {
      if (this.pageContextProvider) {
        this.pageContextProvider.markDirty();
        await this.contextEngine.buildSystemPrompt();
        this.wireIndexResolver();
      }
    });
  }

  getPageContextProvider(): PageContextProvider | null {
    return this.pageContextProvider;
  }

  getTextProvider(): TextProvider | null {
    return this.textProvider;
  }

  /**
   * Called when the PageContextProvider detects DOM changes via fingerprinting.
   * Debounced to coalesce rapid triggers.
   */
  handleContextChange(): void {
    if (this.deps.isDestroyed()) return;
    if (!this.deps.getSession() || this.deps.getConnectionState() !== ConnectionState.CONNECTED) return;

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
    if (!this.deps.getSession() || this.deps.getConnectionState() !== ConnectionState.CONNECTED) return;

    try {
      // Single buildContext() call with section-level change detection
      const { systemPrompt: contextPrompt, tools: contextTools, changed } =
        await this.contextEngine.buildSystemPromptAndToolsIfChanged();

      this.wireIndexResolver();

      if (!changed) {
        if (this.deps.config.debug) {
          console.log('[VoiceSDK:context] Skipping context update — no section changes');
        }
        return;
      }

      const allTools = this.buildToolDeclarations(contextTools);
      const pageContext = contextPrompt || '';

      // Deduplicate: skip if page context hasn't changed
      if (pageContext === this.lastSentPageContext) {
        if (this.deps.config.debug) {
          console.log('[VoiceSDK:context] Skipping duplicate context update');
        }
        return;
      }
      this.lastSentPageContext = pageContext;

      if (this.deps.config.debug) {
        console.log('[VoiceSDK:context] DOM changed, sending context update to server');
      }

      this.deps.onSendContextUpdate(pageContext, [{ functionDeclarations: allTools }]);
      // Send structured scan data for admin visualization
      this.sendScanDataToServer();
    } catch (error: any) {
      if (this.deps.config.debug) {
        console.log('[VoiceSDK:context] Failed to send context update:', error.message);
      }
    }
  }

  /**
   * Send structured scan data to the server for admin dashboard visualization.
   * Deduplicates by fingerprint to avoid sending identical scans.
   */
  sendScanDataToServer(): void {
    if (!this.deps.getSession() || !this.pageContextProvider) return;
    const scanData = this.pageContextProvider.getLastScanData();
    if (!scanData) return;

    // Deduplicate: build a quick fingerprint from URL + element count + heading count
    const elCount = Array.isArray(scanData.interactiveElements) ? scanData.interactiveElements.length : 0;
    const hCount = Array.isArray(scanData.headings) ? scanData.headings.length : 0;
    const contentLen = typeof scanData.content === 'string' ? scanData.content.length : 0;
    const fingerprint = `${scanData.url || ''}|${elCount}|${hCount}|${contentLen}`;

    if (fingerprint === this.lastSentScanFingerprint) {
      if (this.deps.config.debug) {
        console.log('[VoiceSDK:scan] Skipping duplicate scan send');
      }
      return;
    }
    this.lastSentScanFingerprint = fingerprint;

    this.deps.onSendScanData(scanData);

    // Auto-capture screenshot on URL change (non-blocking)
    const currentUrl = scanData.url || '';
    if (currentUrl !== this.lastScreenshotUrl) {
      this.lastScreenshotUrl = currentUrl;
      this.deps.onScreenshotUrlChanged(currentUrl);
    }
  }

  /**
   * Handle the scanPage tool call — force a re-scan and return fresh context.
   */
  async handleScanPage(): Promise<{ result: string }> {
    if (this.deps.config.debug) {
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
  wireIndexResolver(): void {
    if (this.pageContextProvider) {
      const scanner = this.pageContextProvider.getScanner();
      setIndexResolver((index: number) => scanner.getElementByIndex(index));
    }
  }

  /**
   * Add a context provider at runtime.
   */
  addProvider(provider: ContextProvider): void {
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
   * Dump scan results for debugging.
   */
  async dumpScanResults(): Promise<string> {
    const contextPrompt = await this.contextEngine.buildSystemPrompt();
    if (this.deps.config.debug) {
      console.log('[VoiceSDK:scan] Dump results:', contextPrompt);
    }
    return contextPrompt;
  }

  /**
   * Build the full tool declarations array.
   */
  buildToolDeclarations(contextTools: ToolDeclaration[]): ToolDeclaration[] {
    const tools = [...builtInTools, ...contextTools];

    // Add custom action declarations
    if (this.deps.config.actions?.custom) {
      for (const action of Object.values(this.deps.config.actions.custom)) {
        tools.push(action.declaration);
      }
    }

    // Add extra tool declaration sources (nbt_functions, a11y tools, etc.)
    for (const getTools of this.deps.getExtraToolDeclarationSources()) {
      tools.push(...getTools());
    }

    return tools;
  }

  /**
   * Reset dedup state (called when reconnecting).
   */
  resetDedupState(): void {
    this.lastSentPageContext = null;
    this.lastSentScanFingerprint = null;
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    if (this.contextChangeTimer) {
      clearTimeout(this.contextChangeTimer);
      this.contextChangeTimer = null;
    }
    setIndexResolver(null);
    setRescanCallback(null);
    this.pageContextProvider?.destroy();
  }
}

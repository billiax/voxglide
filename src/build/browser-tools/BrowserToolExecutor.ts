import type { PageContextProvider } from '../../context/PageContextProvider';
import { captureScreenshot } from '../../utils/screenshot';
import type { BrowserRequest, BrowserToolResult } from '../types';
import { ConsoleCapture } from './ConsoleCapture';
import { NetworkMonitor } from './NetworkMonitor';
import { evaluateJS } from './EvaluateJSTool';
import { takePageSnapshot } from './PageSnapshotTool';

/**
 * Routes browser tool requests to the correct handler.
 * Owns the ConsoleCapture and NetworkMonitor lifecycle.
 */
export class BrowserToolExecutor {
  readonly consoleCapture: ConsoleCapture;
  readonly networkMonitor: NetworkMonitor;
  private pageContextProvider: PageContextProvider;

  constructor(pageContextProvider: PageContextProvider) {
    this.pageContextProvider = pageContextProvider;
    this.consoleCapture = new ConsoleCapture();
    this.networkMonitor = new NetworkMonitor();
  }

  activate(): void {
    this.consoleCapture.activate();
    this.networkMonitor.activate();
  }

  deactivate(): void {
    this.consoleCapture.deactivate();
    this.networkMonitor.deactivate();
  }

  async execute(request: BrowserRequest): Promise<BrowserToolResult> {
    try {
      // take_screenshot returns an image, not text
      if (request.name === 'take_screenshot') {
        const base64 = await captureScreenshot();
        if (!base64) return { output: 'Screenshot capture failed', isError: true };
        return { output: 'Screenshot captured', isError: false, image: base64 };
      }

      const output = await this.dispatch(request.name, request.params || {});
      return { output, isError: false };
    } catch (err: any) {
      return { output: `Error: ${err.message || err}`, isError: true };
    }
  }

  private async dispatch(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'page_snapshot':
        return takePageSnapshot(this.pageContextProvider);

      case 'evaluate_js': {
        const code = input.code as string;
        if (!code) throw new Error('evaluate_js requires a "code" parameter');
        const result = await evaluateJS(code, this.consoleCapture);
        return JSON.stringify(result, null, 2);
      }

      case 'get_console_logs': {
        const sinceMs = input.since_ms as number | undefined;
        const entries = this.consoleCapture.getEntries(sinceMs);
        if (entries.length === 0) return 'No console messages captured.';
        return entries
          .map(e => `[${e.level.toUpperCase()}] ${e.args.join(' ')}`)
          .join('\n');
      }

      case 'get_network_requests': {
        const sinceMs = input.since_ms as number | undefined;
        const entries = this.networkMonitor.getEntries(sinceMs);
        if (entries.length === 0) return 'No network requests captured.';
        return entries
          .map(e =>
            `[${e.initiatorType}] ${e.url}\n  => ${e.responseStatus || '?'} (${e.duration}ms, ${e.transferSize}B)`,
          )
          .join('\n');
      }

      default:
        throw new Error(`Unknown browser tool: ${name}`);
    }
  }

  destroy(): void {
    this.deactivate();
  }
}

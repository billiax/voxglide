/**
 * Detects both SPA (pushState/replaceState/popstate) and hard (beforeunload) navigation.
 * Provides a unified callback so VoiceSDK can react to any URL change:
 *   - Re-scan context, invalidate caches, re-attach UI on SPA nav
 *   - Save session state on hard nav for reconnection
 */

export interface NavigationEvent {
  from: string;
  to: string;
  type: 'pushState' | 'replaceState' | 'popstate';
}

export type NavigationCallback = (event: NavigationEvent) => void;
export type BeforeUnloadCallback = () => void;

export class NavigationObserver {
  private onNavigate: NavigationCallback;
  private onBeforeUnload: BeforeUnloadCallback;
  private lastUrl: string;
  private originalPushState: History['pushState'];
  private originalReplaceState: History['replaceState'];
  private abortController = new AbortController();

  constructor(onNavigate: NavigationCallback, onBeforeUnload: BeforeUnloadCallback) {
    this.onNavigate = onNavigate;
    this.onBeforeUnload = onBeforeUnload;
    this.lastUrl = window.location.href;

    this.originalPushState = history.pushState.bind(history);
    this.originalReplaceState = history.replaceState.bind(history);

    this.patchHistory();
    this.addEventListeners();
  }

  private patchHistory(): void {
    const self = this;

    history.pushState = function (
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ): void {
      const from = window.location.href;
      self.originalPushState(data, unused, url);
      const to = window.location.href;
      if (from !== to) {
        self.handleNavigation(from, to, 'pushState');
      }
    };

    history.replaceState = function (
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ): void {
      const from = window.location.href;
      self.originalReplaceState(data, unused, url);
      const to = window.location.href;
      if (from !== to) {
        self.handleNavigation(from, to, 'replaceState');
      }
    };
  }

  private addEventListeners(): void {
    const signal = this.abortController.signal;

    window.addEventListener('popstate', () => {
      const from = this.lastUrl;
      const to = window.location.href;
      if (from !== to) {
        this.handleNavigation(from, to, 'popstate');
      }
    }, { signal });

    window.addEventListener('beforeunload', () => {
      this.onBeforeUnload();
    }, { signal });
  }

  private handleNavigation(from: string, to: string, type: NavigationEvent['type']): void {
    this.lastUrl = to;
    this.onNavigate({ from, to, type });
  }

  destroy(): void {
    this.abortController.abort();
    history.pushState = this.originalPushState;
    history.replaceState = this.originalReplaceState;
  }
}

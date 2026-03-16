import type { ProxySession } from '../ai/ProxySession';
import type { ConnectionStateValue } from '../constants';
import type { VoiceSDKConfig } from '../types';

/** Shared dependencies injected into all coordinators. */
export interface CoordinatorBaseDeps {
  config: VoiceSDKConfig;
  isDestroyed: () => boolean;
  getSession: () => ProxySession | null;
  getConnectionState: () => ConnectionStateValue;
  debug: (...args: unknown[]) => void;
}

/** Dependencies for TTSManager. */
export interface TTSManagerDeps {
  config: VoiceSDKConfig;
  getSession: () => ProxySession | null;
  getA11yTtsRate: () => number | null;
}

/** Dependencies for ContextCoordinator. */
export interface ContextCoordinatorDeps extends CoordinatorBaseDeps {
  getExtraToolDeclarationSources: () => Array<() => import('../types').ToolDeclaration[]>;
  onSendScanData: (scanData: import('../types').PageContext) => void;
  onSendContextUpdate: (pageContext: string, tools: unknown[]) => void;
  onScreenshotUrlChanged: (url: string) => void;
}

/** Dependencies for ToolCoordinator. */
export interface ToolCoordinatorDeps extends CoordinatorBaseDeps {
  getPageContextProvider: () => import('../context/PageContextProvider').PageContextProvider | null;
  getA11yManager: () => import('../accessibility/AccessibilityManager').AccessibilityManager | null;
  onToggle: () => void;
}

/** Dependencies for NavigationCoordinator. */
export interface NavigationCoordinatorDeps extends CoordinatorBaseDeps {
  onContextChange: () => void;
  onSPANavigation: (event: { from: string; to: string; type: string }) => void;
  onBeforeUnload: () => void;
}

// Main SDK export
export { VoiceSDK } from './VoiceSDK';

// Types
export type {
  VoiceSDKConfig,
  AutoContextConfig,
  ActionConfig,
  CustomAction,
  UIConfig,
  ThemeColors,
  ThemePreset,
  ThemeSize,
  ThemeColorScheme,
  ThemeConfig,
  ResolvedTheme,
  ToolDeclaration,
  ToolParameter,
  ContextProvider,
  ContextResult,
  FunctionCall,
  FunctionResponse,
  ToolCallMessage,
  TranscriptEvent,
  ActionEvent,
  ErrorEvent,
  UsageEvent,
  StateChangeEvent,
  VoiceSDKEvents,
  FormFieldInfo,
  PageContext,
  InteractiveElement,
  ElementCapability,
  NbtFunctionDef,
  NbtParameterDef,
  WorkflowStep,
  WorkflowDefinition,
  WorkflowState,
  AccessibilityConfig,
} from './types';

// Additional useful type exports
export type { InputMode } from './ui/FloatingButton';
export type { ConnectionStateValue } from './constants';
export type { DebugEvent, QueueState, QueueItem } from './ai/types';

// Sub-components (for advanced usage)
/** @internal */
export { ContextEngine } from './context/ContextEngine';
export { TextProvider } from './context/TextProvider';
export { PageContextProvider } from './context/PageContextProvider';
export { InteractiveElementScanner } from './context/InteractiveElementScanner';
export { TokenBudget } from './context/TokenBudget';
/** @internal */
export { ContextCache } from './context/ContextCache';
/** @internal */
export { ActionRouter } from './actions/ActionRouter';
/** @internal */
export { NbtFunctionsProvider } from './actions/NbtFunctionsProvider';
export { NavigationObserver } from './NavigationObserver';
export type { NavigationEvent, NavigationCallback, BeforeUnloadCallback } from './NavigationObserver';
/** @internal */
export { AccessibilityManager } from './accessibility/AccessibilityManager';
/** @internal */
export { WorkflowEngine } from './workflows/WorkflowEngine';
/** @internal */
export { WorkflowContextProvider } from './workflows/WorkflowContextProvider';
/** @internal */
export { resolveTheme } from './ui/themes';
/** @internal */
export { buildStyles } from './ui/styles';
/** @internal */
export { EventEmitter } from './events';
export { ConnectionState } from './constants';
/** @internal */
export { UIStateMachine } from './ui/UIStateMachine';
export type { UIState, UIStateListener } from './ui/UIStateMachine';
/** @internal */
export { TranscriptStore } from './ui/TranscriptStore';
export type { StoredTranscriptLine } from './ui/TranscriptStore';

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

// Sub-components (for advanced usage)
export { ContextEngine } from './context/ContextEngine';
export { TextProvider } from './context/TextProvider';
export { PageContextProvider } from './context/PageContextProvider';
export { InteractiveElementScanner } from './context/InteractiveElementScanner';
export { TokenBudget } from './context/TokenBudget';
export { ContextCache } from './context/ContextCache';
export { ActionRouter } from './actions/ActionRouter';
export { NbtFunctionsProvider } from './actions/NbtFunctionsProvider';
export { NavigationObserver } from './NavigationObserver';
export type { NavigationEvent, NavigationCallback, BeforeUnloadCallback } from './NavigationObserver';
export { AccessibilityManager } from './accessibility/AccessibilityManager';
export { WorkflowEngine } from './workflows/WorkflowEngine';
export { WorkflowContextProvider } from './workflows/WorkflowContextProvider';
export { resolveTheme } from './ui/themes';
export { buildStyles } from './ui/styles';
export { EventEmitter } from './events';
export { ConnectionState } from './constants';
export { UIStateMachine } from './ui/UIStateMachine';
export type { UIState, UIStateListener } from './ui/UIStateMachine';
export { TranscriptStore } from './ui/TranscriptStore';
export type { StoredTranscriptLine } from './ui/TranscriptStore';

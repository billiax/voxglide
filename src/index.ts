// Main SDK export
export { VoiceSDK } from './VoiceSDK';

// Types
export type {
  VoiceSDKConfig,
  AutoContextConfig,
  ActionConfig,
  CustomAction,
  UIConfig,
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
} from './types';

// Sub-components (for advanced usage)
export { ContextEngine } from './context/ContextEngine';
export { TextProvider } from './context/TextProvider';
export { PageContextProvider } from './context/PageContextProvider';
export { InteractiveElementScanner } from './context/InteractiveElementScanner';
export { TokenBudget } from './context/TokenBudget';
export { ContextCache } from './context/ContextCache';
export { ActionRouter } from './actions/ActionRouter';
export { EventEmitter } from './events';
export { ConnectionState } from './constants';
export { UIStateMachine } from './ui/UIStateMachine';
export type { UIState, UIStateListener } from './ui/UIStateMachine';
export { TranscriptStore } from './ui/TranscriptStore';
export type { StoredTranscriptLine } from './ui/TranscriptStore';

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
export { ActionRouter } from './actions/ActionRouter';
export { EventEmitter } from './events';
export { ConnectionState } from './constants';

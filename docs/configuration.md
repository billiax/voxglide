# Configuration

## VoiceSDK Options

```typescript
const sdk = new VoiceSDK({
  serverUrl: 'wss://your-server.com',    // Required

  // Context
  autoContext: true,                      // Auto-scan DOM for forms, headings, nav
  context: 'This is a checkout page',    // Developer-supplied context

  // Input
  mode: 'voice',                         // 'voice' | 'text' | 'auto'
  language: 'en-US',                     // Speech recognition language

  // Output
  tts: true,                             // Speak AI responses via browser TTS

  // UI
  ui: {
    position: 'bottom-right',            // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
    showTranscript: true,
    theme: {
      preset: 'dark',                    // 'default' | 'light' | 'dark' | 'minimal'
      size: 'md',                        // 'sm' | 'md' | 'lg'
      colors: { primary: '#8b5cf6' },
    },
  },

  // Features
  autoReconnect: true,                   // Reconnect after page navigation
  accessibility: true,                   // ARIA live regions, keyboard shortcuts
  workflows: [/* ... */],               // Guided conversation flows
  nbtFunctions: true,                    // Auto-discover window.nbt_functions (default: true)
  debug: false,                          // Verbose logging
});
```

## Theming

Use presets for quick setup or customize individual colors:

```typescript
// Preset only
ui: { theme: { preset: 'dark' } }

// Full customization
ui: {
  theme: {
    preset: 'minimal',
    size: 'lg',
    colors: {
      primary: '#8b5cf6',
      background: '#1a1a2e',
      text: '#e0e0e0',
    },
    borderRadius: '16px',
    colorScheme: 'dark',
  },
}
```

**Presets:** `default`, `light`, `dark`, `minimal`

**Sizes:** `sm` (40px button), `md` (56px), `lg` (72px)

## Accessibility

Enable with a boolean for sensible defaults, or configure individually:

```typescript
const sdk = new VoiceSDK({
  serverUrl: 'wss://your-server.com',
  accessibility: true,
  // or fine-grained:
  // accessibility: {
  //   announcements: true,    // ARIA live region announcements
  //   highContrast: true,     // High contrast theme
  //   ttsRate: 0.85,          // Slower TTS rate
  //   keyboardShortcuts: true, // Alt+V toggle, Escape to close
  // },
});
```

When enabled:

- **ARIA live region** announces AI actions to screen readers
- **Keyboard shortcuts**: `Alt+V` toggles SDK, `Escape` returns focus
- **High contrast mode** with enhanced focus indicators
- **AI tools**: `describePage`, `focusElement`, `listLandmarks`, `readHeadings`, `nextFormField`, `prevFormField`

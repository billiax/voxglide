# VoxGlide

**Embeddable voice AI SDK for web pages** — speak to fill forms, click buttons, navigate, and ask questions. Works with any LLM provider.

[![npm](https://img.shields.io/npm/v/voxglide)](https://www.npmjs.com/package/voxglide)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](tsconfig.json)
[![Tests](https://img.shields.io/badge/tests-487%20passing-brightgreen)]()

## Features

- **Voice & text input** — Browser Speech API with automatic text fallback
- **Form filling** — Detects fields, fills values, triggers React/Vue/Angular change detection
- **Smart page scanning** — Auto-discovers forms, headings, navigation, interactive elements
- **Multi-LLM support** — Gemini, OpenAI, Anthropic, Ollama (any OpenAI-compatible API)
- **Themeable UI** — Presets (default/light/dark/minimal), sizes (sm/md/lg), full color control
- **Conversation workflows** — Guided multi-step flows with validation
- **Accessibility mode** — ARIA live regions, keyboard shortcuts, high contrast, screen reader tools
- **Zero dependencies** — Self-contained SDK with Shadow DOM isolation

## Quick Start

### Script Tag (fastest)

```html
<script src="https://your-server.com/sdk/voice-sdk.iife.js"></script>
<script>
  const sdk = new VoxGlide.VoiceSDK({
    serverUrl: 'wss://your-server.com',
  });
</script>
```

### npm

```bash
npm install voxglide
```

```typescript
import { VoiceSDK } from 'voxglide';

const sdk = new VoiceSDK({
  serverUrl: 'wss://your-server.com',
  autoContext: true,
  tts: true,
});
```

### Server Setup

```bash
cd server
npm install

# Pick your LLM provider:
GEMINI_API_KEY=your-key npm run dev
# or
OPENAI_API_KEY=your-key LLM_PROVIDER=openai npm run dev
# or
ANTHROPIC_API_KEY=your-key LLM_PROVIDER=anthropic npm run dev
# or
LLM_PROVIDER=ollama npm run dev
```

## Architecture

```
Browser (SDK)                    Server (proxy)
─────────────                    ──────────────
SpeechRecognition → text ──WS──→ Receives text
Execute DOM actions ←──WS──────← LLM tool calls
SpeechSynthesis (TTS)            LLM API (holds key)
Page context scanning            Session/history mgmt
Shadow DOM UI                    Context caching
```

The server is a thin proxy — the API key never reaches the browser. The SDK handles speech recognition, DOM interaction, and (optionally) text-to-speech. The server relays text to the LLM and streams back responses and tool calls.

## Configuration

```typescript
const sdk = new VoiceSDK({
  // Required
  serverUrl: 'wss://your-server.com',

  // Context
  autoContext: true,              // Auto-scan DOM for forms, headings, nav
  context: 'This is a checkout page', // Developer-supplied context

  // Input
  mode: 'voice',                 // 'voice' | 'text' | 'auto'
  language: 'en-US',             // Speech recognition language

  // Output
  tts: true,                     // Speak AI responses via browser TTS

  // UI
  ui: {
    position: 'bottom-right',    // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
    showTranscript: true,
    theme: {
      preset: 'dark',            // 'default' | 'light' | 'dark' | 'minimal'
      size: 'md',                // 'sm' | 'md' | 'lg'
      colors: { primary: '#8b5cf6' },
    },
  },

  // Features
  autoReconnect: true,           // Reconnect after page navigation
  accessibility: true,           // ARIA live regions, keyboard shortcuts
  workflows: [/* ... */],        // Guided conversation flows
  debug: false,                  // Verbose logging
});
```

## Custom Actions

Register tools the AI can call:

```typescript
const sdk = new VoiceSDK({
  serverUrl: 'wss://your-server.com',
  actions: {
    custom: {
      addToCart: {
        declaration: {
          name: 'addToCart',
          description: 'Add a product to the shopping cart',
          parameters: {
            type: 'OBJECT',
            properties: {
              productId: { type: 'STRING', description: 'Product ID' },
              quantity: { type: 'NUMBER', description: 'Quantity' },
            },
            required: ['productId'],
          },
        },
        handler: async (args) => {
          await cart.add(args.productId, args.quantity ?? 1);
          return { success: true, cartSize: cart.size };
        },
      },
    },
  },
});
```

Or register at runtime:

```typescript
sdk.registerAction('showModal', {
  declaration: { name: 'showModal', description: 'Show a modal dialog', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING', description: 'Modal title' } }, required: ['title'] } },
  handler: (args) => { openModal(args.title); return { success: true }; },
});
```

## Page-Defined Tools (nbt_functions)

Pages can expose tools without modifying SDK config:

```html
<script>
  window.nbt_functions = {
    lookupOrder: {
      description: 'Look up an order by ID',
      parameters: {
        orderId: { type: 'string', description: 'The order ID', required: true },
      },
      handler: async (args) => {
        const order = await fetch(`/api/orders/${args.orderId}`).then(r => r.json());
        return order;
      },
    },
  };
</script>
```

The SDK auto-discovers `window.nbt_functions` and registers them as AI tools.

## Conversation Workflows

Guide the AI through multi-step conversations:

```typescript
const sdk = new VoiceSDK({
  serverUrl: 'wss://your-server.com',
  workflows: [
    {
      name: 'onboarding',
      trigger: 'get started',
      steps: [
        { instruction: 'Ask for the user\'s name', field: 'name' },
        { instruction: 'Ask for their email', field: 'email', validate: (v) => v.includes('@') || 'Invalid email' },
        { instruction: 'Ask which plan they want (free/pro)', field: 'plan' },
      ],
      onComplete: (data) => {
        console.log('Onboarding complete:', data);
        // { name: 'Alice', email: 'alice@example.com', plan: 'pro' }
      },
    },
  ],
});

sdk.on('workflow:start', (state) => console.log('Started:', state.name));
sdk.on('workflow:step', (state) => console.log(`Step ${state.currentStep}/${state.totalSteps}`));
sdk.on('workflow:complete', (state) => console.log('Done:', state.collectedData));
```

## Theming

```typescript
// Preset
ui: { theme: { preset: 'dark' } }

// Custom colors
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

// Available presets: 'default', 'light', 'dark', 'minimal'
// Available sizes: 'sm' (40px button), 'md' (56px), 'lg' (72px)
```

## Accessibility

```typescript
const sdk = new VoiceSDK({
  serverUrl: 'wss://your-server.com',
  accessibility: true, // or fine-grained:
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

## React Integration

```bash
npm install @voxglide/react voxglide
```

### Hooks (build your own UI)

```tsx
import { VoiceProvider, useVoiceSDK, useVoiceTranscript, useVoiceAction } from '@voxglide/react';

function App() {
  return (
    <VoiceProvider config={{ serverUrl: 'wss://your-server.com', autoContext: true }}>
      <MyVoiceUI />
    </VoiceProvider>
  );
}

function MyVoiceUI() {
  const { state, toggle, sendText, isConnected } = useVoiceSDK({
    serverUrl: 'wss://your-server.com',
  });
  const transcript = useVoiceTranscript();

  return (
    <div>
      <button onClick={toggle}>
        {state.isConnecting ? 'Connecting...' : isConnected ? 'Stop' : 'Start'}
      </button>
      <ul>
        {transcript.map((t, i) => (
          <li key={i}><b>{t.speaker}:</b> {t.text}</li>
        ))}
      </ul>
    </div>
  );
}
```

### Drop-in Component (built-in UI)

```tsx
import { VoiceAssistant } from '@voxglide/react';

function App() {
  return <VoiceAssistant config={{ serverUrl: 'wss://your-server.com' }} />;
}
```

### Custom Action Hook

```tsx
import { useVoiceAction } from '@voxglide/react';

function CartButton() {
  useVoiceAction('getCartTotal', {
    declaration: {
      name: 'getCartTotal',
      description: 'Get the current cart total',
      parameters: { type: 'OBJECT', properties: {} },
    },
    handler: () => ({ total: cart.getTotal(), items: cart.itemCount }),
  });

  return <button>Cart ({cart.itemCount})</button>;
}
```

## Multi-LLM Server Setup

The server supports multiple LLM providers. Set environment variables to configure:

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | `gemini`, `openai`, `anthropic`, `ollama` | Auto-detected from API key |
| `LLM_MODEL` | Model override (provider-specific) | Provider default |
| `GEMINI_API_KEY` | Google Gemini API key | — |
| `OPENAI_API_KEY` | OpenAI API key | — |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434/v1` |
| `PORT` | Server port | `3100` |
| `ALLOWED_ORIGINS` | Comma-separated origins | `*` |

Default models: Gemini `gemini-2.5-flash`, OpenAI `gpt-4o`, Anthropic `claude-sonnet-4-20250514`, Ollama `llama3.1`.

Auto-detection: if `LLM_PROVIDER` is not set, the server picks the provider based on which API key is present (Gemini > OpenAI > Anthropic).

## Events

```typescript
sdk.on('connected', () => { /* WebSocket connected */ });
sdk.on('disconnected', () => { /* WebSocket disconnected */ });
sdk.on('transcript', ({ speaker, text, isFinal }) => { /* speech/AI text */ });
sdk.on('action:before', ({ name, args }) => { /* before tool execution */ });
sdk.on('action', ({ name, args, result }) => { /* after tool execution */ });
sdk.on('error', ({ message }) => { /* error occurred */ });
sdk.on('usage', ({ totalTokens, inputTokens, outputTokens }) => { /* token usage */ });
sdk.on('stateChange', ({ from, to }) => { /* connection state change */ });
sdk.on('workflow:start', (state) => { /* workflow started */ });
sdk.on('workflow:step', (state) => { /* workflow step advanced */ });
sdk.on('workflow:complete', (state) => { /* workflow finished */ });
sdk.on('workflow:cancel', ({ name, reason }) => { /* workflow cancelled */ });
```

## Built With

- **TypeScript** — strict mode, zero `any` in public API
- **Rollup** — ESM + IIFE bundles
- **Web Speech API** — browser-native speech recognition and synthesis
- **WebSocket** — real-time bidirectional communication
- **Shadow DOM** — UI isolation from host page styles
- **Vitest** — 487+ tests with jsdom environment

## Contributing

```bash
git clone https://github.com/billiax/voxglide.git
cd voxglide
npm install
npm run check          # typecheck + lint + test
npm run dev            # watch mode build
cd server && npm install && GEMINI_API_KEY=key npm run dev
```

## License

[MIT](LICENSE)

<h1 align="center">VoxGlide</h1>

<p align="center">
  <strong>Embeddable voice AI SDK for web pages</strong><br />
  Speak to fill forms, click buttons, navigate, and ask questions. Works with any LLM provider.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/voxglide"><img src="https://img.shields.io/npm/v/voxglide.svg" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://github.com/billiax/voxglide/actions/workflows/ci.yml"><img src="https://github.com/billiax/voxglide/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="tsconfig.json"><img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript strict" /></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="zero dependencies" />
</p>

---

## Features

- **Voice & text input** — Browser Speech API with automatic text fallback
- **Form filling** — Detects fields, fills values, triggers React/Vue/Angular change detection
- **Smart page scanning** — Auto-discovers forms, headings, navigation, interactive elements
- **Multi-LLM support** — Gemini, OpenAI, Anthropic, Ollama (any OpenAI-compatible API)
- **Themeable UI** — Presets, sizes, full color control
- **Conversation workflows** — Guided multi-step flows with validation
- **Accessibility** — ARIA live regions, keyboard shortcuts, screen reader tools
- **Zero dependencies** — Self-contained SDK with Shadow DOM isolation

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

## Quick Start

### 1. Start the server

The server is a thin proxy that holds your API key — it never reaches the browser.

```bash
cd server && npm install
GEMINI_API_KEY=your-key npm run dev
```

<details>
<summary>Other LLM providers</summary>

```bash
# OpenAI / GPT
OPENAI_API_KEY=your-key LLM_PROVIDER=openai npm run dev

# Anthropic / Claude
ANTHROPIC_API_KEY=your-key LLM_PROVIDER=anthropic npm run dev

# Ollama (local, no key needed)
LLM_PROVIDER=ollama npm run dev
```

</details>

### 2. Add the SDK

**Script tag (IIFE):**

```html
<script src="https://your-server.com/sdk/voice-sdk.iife.js"></script>
<script>
  const sdk = new VoxGlide.VoiceSDK({
    serverUrl: 'wss://your-server.com',
  });
</script>
```

<details>
<summary>ES module import</summary>

```typescript
import { VoiceSDK } from 'voxglide';

const sdk = new VoiceSDK({
  serverUrl: 'wss://your-server.com',
  autoContext: true,
  tts: true,
});
```

</details>

That's it. The SDK auto-discovers forms and interactive elements on the page.

## Configuration

```typescript
const sdk = new VoiceSDK({
  serverUrl: 'wss://your-server.com',  // Required
  autoContext: true,                     // Auto-scan DOM for context
  context: 'This is a checkout page',   // Developer-supplied context
  language: 'en-US',                     // Speech recognition language
  tts: true,                             // Enable browser text-to-speech
  ui: { theme: 'ocean', size: 'md' },   // UI theming
  debug: false,                          // Verbose logging
  autoReconnect: true,                   // Reconnect after navigation
});
```

See [docs/configuration.md](docs/configuration.md) for full configuration reference.

## Custom Tools

Pages can expose tools via `window.nbt_functions` — the SDK auto-discovers them:

```html
<script>
  window.nbt_functions = {
    lookupOrder: {
      description: 'Look up an order by ID',
      parameters: {
        orderId: { type: 'string', description: 'The order ID', required: true },
      },
      handler: async (args) => {
        return await fetch(`/api/orders/${args.orderId}`).then(r => r.json());
      },
    },
  };
</script>
```

You can also register tools via SDK config or at runtime. See the [custom tools docs](docs/custom-tools.md).

## Documentation

| Topic | Link |
|-------|------|
| Configuration & theming | [docs/configuration.md](docs/configuration.md) |
| Custom tools | [docs/custom-tools.md](docs/custom-tools.md) |
| Conversation workflows | [docs/workflows.md](docs/workflows.md) |
| Events reference | [docs/events.md](docs/events.md) |
| Server setup | [docs/server.md](docs/server.md) |
| Architecture overview | [docs/architecture.md](docs/architecture.md) |

## Examples

The [`examples/`](examples/) directory contains demo pages:

- **[basic.html](examples/basic.html)** — Minimal integration
- **[form-filling.html](examples/form-filling.html)** — Form auto-fill demo
- **[custom-actions.html](examples/custom-actions.html)** — Custom tool registration

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code style, and PR guidelines.

```bash
git clone https://github.com/billiax/voxglide.git
cd voxglide && npm install
npm run check    # typecheck + lint + test
```

## License

[MIT](LICENSE)

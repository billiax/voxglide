# VoxGlide - Voice AI SDK

## What This Is
An embeddable voice AI SDK for web pages. Users speak, the browser transcribes via the Web Speech API, text goes to a proxy server that calls Gemini, and the SDK executes tool calls (fill forms, click elements, navigate, answer questions). Optionally speaks AI responses via browser TTS. Built as a TypeScript library, bundled with Rollup into ESM + IIFE formats.

## Architecture

```
Browser (SDK)                    Server (proxy)
─────────────                    ──────────────
SpeechRecognition → text ──WS──→ Receives text
Execute DOM actions ←──WS──────← Gemini tool calls
SpeechSynthesis (optional TTS)   Gemini API (holds key)
Page context scanning            Session/history mgmt
UI (Shadow DOM)                  Auth, rate limiting
```

### Client (src/)
```
src/
  index.ts              - Public exports
  VoiceSDK.ts           - Main orchestrator (entry point)
  types.ts              - All TypeScript interfaces
  constants.ts          - Defaults, system prompt template
  events.ts             - Typed EventEmitter base class
  ai/
    ProxySession.ts     - WebSocket client to proxy server
    SpeechCapture.ts    - Browser SpeechRecognition wrapper
    types.ts            - Session config, callbacks, token usage
  context/
    ContextEngine.ts    - Aggregates context providers into system prompt
    PageContextProvider.ts - Auto-scans DOM (forms, headings, nav, content, meta)
    TextProvider.ts     - Simple developer-supplied text context
    types.ts            - Context-specific types
  actions/
    ActionRouter.ts     - Routes AI tool calls to handlers
    DOMActions.ts       - Built-in DOM actions (fillField, clickElement, readContent)
    NavigationHandler.ts - Page navigation with session persistence
    tools.ts            - Gemini function declarations for built-in tools
    types.ts            - Action-specific types
  ui/
    UIManager.ts        - Shadow DOM container, manages button + transcript
    FloatingButton.ts   - Mic toggle button with state animations
    TranscriptOverlay.ts - Live transcript display
    styles.ts           - CSS for SDK UI components
    icons.ts            - SVG icons
```

### Server (server/)
```
server/
  index.ts              - WebSocket proxy server (Node.js + ws)
  package.json          - Server deps (@google/genai, ws, tsx)
  tsconfig.json         - Server TS config
  admin/                - Admin dashboard (single-page app, served at /admin)
    index.html          - Shell HTML: header, sidebar, main area with Events/Analysis tabs
    css/
      base.css          - Theme system (CSS custom properties, dark default + [data-theme="light"]),
                           reset, layout grid, scrollbar styling
      components.css    - Header, sidebar session list, main area, tab bar, theme toggle button
      events.css        - Event items (color-coded by type), filter bar toggles, event groups
                           (tool-group, nav-group, scan-group), collapsible bodies, context panels
      analysis.css      - Session summary card, vertical page journey, element groups (collapsible),
                           element cards with capability badges, form field data tables, heading tree,
                           search bar with highlighting, cross-scan search results
    js/
      app.js            - Entry point: imports all modules, initializes theme, wires tab switching,
                           auto-scroll detection, starts WebSocket connection
      state.js          - Shared mutable state (sessions Map, selected session, filters, theme,
                           active tab, scan index), renderer registry, cached DOM refs
      utils.js          - Shared helpers: escapeHtml, formatTime, formatElapsed, formatDuration,
                           truncateStr, eventLabel, scrollToBottom, chevronIcon
      theme.js          - Theme manager: auto/light/dark cycling with localStorage persistence,
                           listens to prefers-color-scheme media query, toggle button with SVG icons
      websocket.js      - WebSocket client to /admin endpoint, handles sessions.list, session.new,
                           session.update, session.event, session.disconnected messages
      sidebar.js        - Session list rendering (URL pathname as primary text, session ID demoted,
                           live/dead colored dots, red left border for disconnected), session selection
      events.js         - Events tab: filter bar (User/AI/Tools/Scans/System toggles with counts),
                           event grouping (tool sequences by turnId, navigation sequences,
                           duplicate scan collapse), incremental append into existing groups,
                           color-coded event items, collapsible context panels
      analysis.js       - Page Analysis tab: session summary card (horizontal stats bar),
                           vertical page journey (grouped by URL, clickable to switch scan),
                           interactive elements grouped by UX category (Buttons, Links/Navigation,
                           Switches/Toggles, Form Controls, Other) in collapsible groups with
                           capability badges, form fields table, page outline/headings tree,
                           smart search bar with instant filtering, text highlighting,
                           cross-scan search, and "not found in any scan" detection
```

### Other
```
examples/               - Demo HTML pages
tests/
  setup.ts              - jsdom + browser API mocks
  mocks/                - Shared mock factories
  unit/                 - Unit tests per module
```

## Key Design Decisions
- **Text-based protocol** — browser handles STT/TTS, server handles LLM. No audio streaming.
- **Proxy server** — API key never leaves the server. Thin relay: text in, text + tool calls out.
- **Shadow DOM** for UI isolation — SDK styles never leak into host page
- **MutationObserver** for auto-context — re-scans DOM when it changes
- **SessionStorage** for navigation persistence — reconnects after page nav
- **Native input setter trick** in DOMActions — works with React/Vue/Angular change detection
- **No peer dependencies** — SDK is fully self-contained

## Config (VoiceSDKConfig)
```typescript
{
  serverUrl: string;       // Required: ws://localhost:3100
  autoContext?: boolean;    // Auto-scan DOM for forms, headings, nav
  context?: string;         // Developer-supplied context
  language?: string;        // Speech recognition language (default: en-US)
  tts?: boolean;            // Enable browser TTS for AI responses
  ui?: UIConfig | false;    // UI config or disable
  debug?: boolean;          // Verbose logging
  actions?: ActionConfig;   // Custom tools
  autoReconnect?: boolean;  // Reconnect after navigation
}
```

## Build & Development

### Running the Dev Environment
The user runs the app themselves outside of Claude Code using `start-dev.sh`. **Do not start or restart the dev server** — it is always running in a separate terminal.

The dev script (`./start-dev.sh`) runs two independent watchers:
1. **SDK watcher** (`rollup --watch`) — rebuilds `dist/` when `src/` changes. The server serves SDK files from disk on each request, so no server restart needed.
2. **Server watcher** (`tsx watch`) — restarts only the server when `server/` files change.
This means `src/` changes only trigger a fast SDK rebuild (no server restart), and `server/` changes only restart the server (no SDK rebuild).

### Client SDK
```bash
npm install           # Install deps
npm run build         # Build ESM + IIFE bundles to dist/
npm run dev           # Watch mode build
npm run typecheck     # TypeScript type checking (no emit)
npm test              # Run all unit tests
npm run test:watch    # Watch mode tests
npm run lint          # ESLint check
npm run check         # Run ALL gates: typecheck + lint + test (use before committing)
```

### Server
```bash
cd server
npm install
GEMINI_API_KEY=your-key npm run dev    # Dev with watch
GEMINI_API_KEY=your-key npm start      # Production

# Environment variables:
# GEMINI_API_KEY     - Required
# PORT               - Default: 3100
# GEMINI_MODEL       - Default: gemini-2.5-flash
# ALLOWED_ORIGINS    - Default: * (comma-separated)
```

## Testing

### Test Framework
- **Vitest** with jsdom environment for browser API simulation
- All browser APIs (DOM, sessionStorage, SpeechRecognition) mocked via jsdom + setup file
- Server is not directly tested via unit tests (it's a thin proxy)

### Writing Tests
- Tests go in `tests/unit/` mirroring `src/` structure
- Use `tests/mocks/` for shared mock factories
- Every public method should have at least one test
- Test files: `tests/unit/<ModuleName>.test.ts`

### What Agents Should Do
1. Run `npm run check` before and after changes
2. Add/update tests for any changed behavior
3. Test edge cases: empty inputs, missing elements, disabled fields, error paths
4. For DOM actions: create test DOM fixtures, verify events fire

## Code Conventions
- TypeScript strict mode
- No default exports — use named exports
- Types in `types.ts` files per module group
- Error results: `{ result: JSON.stringify({ error: "..." }) }`
- Success results: `{ result: JSON.stringify({ success: true, ... }) }`
- Event names: camelCase, compound events use colon (e.g., `action:before`)
- CSS class prefix: `vsdk-`
- SDK DOM elements marked with `data-voice-sdk` attribute

## Common Agent Tasks

### Adding a new built-in action
1. Add tool declaration in `src/actions/tools.ts`
2. Add handler function in `src/actions/DOMActions.ts` (or new file)
3. Register in `src/actions/ActionRouter.ts` constructor
4. Add tests in `tests/unit/`
5. Run `npm run check`

### Adding a new context provider
1. Implement `ContextProvider` interface from `src/types.ts`
2. Export from `src/index.ts`
3. Add tests
4. Run `npm run check`

### Modifying the server
1. Server code is in `server/index.ts`
2. WebSocket message protocol: `session.start`, `text`, `toolResult`, `session.stop` (client→server) and `session.started`, `response`, `toolCall`, `usage`, `error` (server→client)
3. Test manually: `cd server && GEMINI_API_KEY=key npm run dev`

### Debugging
- Set `debug: true` in VoiceSDKConfig for verbose client logging
- All debug messages prefixed with `[VoiceSDK:...]`
- Server logs prefixed with `[voxglide]`

## SDK UI Selectors (Browser Testing Reference)

### Host Element
- `[data-voice-sdk]` — SDK host in light DOM (Shadow DOM root)

### Shadow DOM Elements
| Element | Selector | Description |
|---------|----------|-------------|
| Container | `.vsdk-container.bottom-right` | Main positioned container |
| Floating button | `.vsdk-btn` | Mic toggle bubble |
| Transcript panel | `.vsdk-transcript` | Chat/transcript overlay |
| Panel header | `.vsdk-panel-header` | Header bar of transcript |
| Panel title | `.vsdk-panel-title` | Title text in header |
| Test badge | `.vsdk-test-badge` | Test mode indicator |
| Close button | `.vsdk-panel-close` | Close panel button |
| Text input row | `.vsdk-text-input-row` | Input + send container |
| Text input | `.vsdk-text-input` | Message input field |
| Send button | `.vsdk-text-send` | Send message button (→) |

### Testing URLs
- **Admin**: `/admin` endpoint on the proxy server (VoxGlide Admin Dashboard)

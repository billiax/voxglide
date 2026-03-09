# Useful Tools, Frameworks & SDKs for VoxGlide

Research date: 2026-03-07

---

## Priority Summary

| Priority | Tool | Why |
|----------|------|-----|
| High | **websocket-ts** or **reconnecting-websocket** | Drop-in reconnection for ProxySession, tiny footprint |
| High | **vitest-websocket-mock** | Proper WebSocket testing without real servers |
| High | **Zod** | Runtime validation of tool call args, type inference, ecosystem standard |
| Medium | **Vercel AI SDK** | Could replace hand-rolled Gemini integration on server, structured tool calling |
| Medium | **Deepgram JS SDK** | Higher-accuracy STT as an optional speech provider |
| Medium | **Lit** | Cleaner Shadow DOM UI with reactive templating |
| Low | **LiveKit Agents** | Full voice agent framework; relevant if server grows more complex |
| Low | **Whisper.wasm** | Offline/fallback STT; niche use case, heavy download |
| Low | **Shoelace** | Pre-built components; only relevant if UI becomes more complex |

---

## 1. Speech/Voice APIs

### Deepgram
Real-time streaming STT via WebSocket. Nova-2 and Flux models offer sub-300ms latency with built-in turn detection. Official JS SDK (`@deepgram/sdk`) works in browsers via WebSocket to `wss://api.deepgram.com` (REST calls need a proxy for CORS). Architecturally similar to VoxGlide's approach -- could serve as a higher-accuracy, multilingual replacement for Web Speech API.
- https://github.com/deepgram/deepgram-js-sdk

### AssemblyAI
Slam-1 model and Universal-Streaming achieve ~90ms first-word latency. Supports multilingual streaming (6 languages), safety guardrails, and an LLM Gateway. Competitive alternative to Deepgram with speech understanding features beyond raw transcription.
- https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription

### Whisper in the Browser (Transformers.js / whisper.wasm)
OpenAI's Whisper running client-side via WebAssembly or Transformers.js. Fully offline, privacy-preserving transcription. Downsides: slower than server-side, large model download, no true real-time streaming. Useful as a fallback when Web Speech API is unavailable (e.g. Firefox).
- https://github.com/Timur00Kh/whisper.wasm
- https://github.com/xenova/whisper-web

### Web Speech API (current)
Still the simplest zero-cost option. Chrome/Edge/some Safari have solid support. Main limitations: Chrome-only for reliability, requires internet, no fine-grained control, inconsistent across browsers. VoxGlide's current approach is sound for a lightweight SDK.

---

## 2. Voice UI Frameworks

### LiveKit Agents (Node.js / TypeScript)
Framework for building real-time, multimodal voice AI agents. Plugin ecosystem for mixing STT, LLM, TTS providers. Includes semantic turn detection and native MCP tool support. Relevant if VoxGlide wanted a more opinionated agent framework on the server side.
- https://github.com/livekit/agents-js
- https://docs.livekit.io/agents/

### Vuics
PaaS for building and serving Voice User Interfaces for websites and apps. Less relevant as a library, more as a commercial reference.
- https://vuics.com/

### OpenAI Realtime API
GA since August 2025. Low-latency bidirectional audio streaming for speech-to-speech agents. Alternative backend to Gemini, but fundamentally different architecture (audio streaming vs. text-based).
- https://developers.openai.com/blog/openai-for-developers-2025/

---

## 3. WebSocket Libraries

### reconnecting-websocket
Drop-in decorator for native WebSocket that adds automatic reconnection. Under 600 bytes gzipped. Same API as native WebSocket -- near-zero-effort swap in ProxySession.ts.
- https://github.com/pladaria/reconnecting-websocket

### websocket-ts
TypeScript-first WebSocket client with auto-reconnect and message buffering. 2.1 kB gzipped. No dependencies. Configurable backoff strategies (constant, linear, exponential). Built-in message buffering prevents lost messages during reconnection -- useful for navigation persistence.
- https://github.com/jjxxs/websocket-ts

### Socket.IO
Full-featured real-time engine with reconnection, rooms, and HTTP long-polling fallback. Overkill for VoxGlide's 1:1 model and requires server-side adoption too. Not recommended unless multi-client broadcasting is needed.
- https://socket.io/

---

## 4. AI/LLM Integration

### Vercel AI SDK (ai-sdk)
TypeScript SDK for AI applications. v6 unifies tool calling with structured output, introduces Agent abstraction with type-safe streaming, uses Zod schemas for tool parameters. Supports multiple providers including Gemini. Could replace hand-rolled Gemini integration on the server.
- https://ai-sdk.dev/docs/introduction
- https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling

### Zod
TypeScript-first schema validation. Standard for defining LLM tool parameters in the AI SDK ecosystem. VoxGlide currently uses raw JSON objects in `src/actions/tools.ts`. Zod would provide runtime validation of tool call args, automatic type inference, and AI SDK compatibility.
- https://zod.dev/

### Model Context Protocol (MCP)
Emerging standard for tool discovery and invocation across AI agents. If VoxGlide's tools were exposed as MCP tools, any MCP-compatible agent could consume them. Worth watching but probably premature.
- https://composio.dev/blog/ai-agent-tool-calling-guide

---

## 5. DOM Interaction / Automation

### Playwright Selector Strategies
Playwright's selector engine offers role-based selectors (accessibility attributes), text selectors with normalization, and test-ID selectors. Borrowing these strategies (especially role-based and text-based matching) could make VoxGlide's element targeting more robust without importing Playwright.
- https://www.browserstack.com/guide/playwright-selectors-best-practices

### femtoJS
Tiny (<1 kB) DOM manipulation library with jQuery-like selectors. Probably not worth adding as a dependency since VoxGlide's DOM needs are specialized, but useful as a reference.
- https://vladocar.github.io/femtoJS/

---

## 6. Testing Tools

### vitest-websocket-mock
Purpose-built for testing WebSocket interactions with Vitest. Creates mock WebSocket servers that track received messages and can send messages to clients. Supports assertions like `expect(server).toReceiveMessage(...)`. Directly relevant to testing ProxySession.ts.
- https://github.com/akiomik/vitest-websocket-mock

### mock-socket
Underlying library used by vitest-websocket-mock. Full mock WebSocket and Socket.IO implementation. Useful standalone for lower-level control.
- https://github.com/thoov/mock-socket

### MSW WebSocket Support
MSW now supports WebSocket interception (Node.js >= 22). Network-level interceptor rather than mock server. Useful for integration tests intercepting real WebSocket traffic.
- https://egghead.io/lessons/test-web-sockets-in-vitest-with-msw~9h866

---

## 7. Web Components / Shadow DOM

### Lit (v4.0)
Google's library for Web Components. Reactive templating, Shadow DOM encapsulation, ~5 kB. Direct DOM manipulation (no virtual DOM). Could simplify UIManager, FloatingButton, and TranscriptOverlay with reactive properties and declarative templates while keeping Shadow DOM isolation.
- https://lit.dev/
- https://markaicode.com/web-components-2025-shadow-dom-lit-browser-compatibility/

### Shoelace / Web Awesome
Pre-built, framework-agnostic Web Components (buttons, dialogs, overlays) built with Lit. v3 being rebranded as "Web Awesome" with SSR support. VoxGlide could use individual components inside its Shadow DOM.
- https://shoelace.style/

### Stencil
Compiler for standards-compliant Web Components using TypeScript and JSX. Produces lazy-loaded, optimized components. More of a build tool than runtime. Lit is likely a better fit for VoxGlide's simpler UI needs.
- https://stenciljs.com/

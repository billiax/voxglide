# VoxGlide Architecture — How It All Works

This document explains the full internals of VoxGlide: how pages are scanned, what gets sent to the LLM, how tool calls execute, how sessions persist, and how everything is optimized. If you're contributing or building on top of VoxGlide, this is the place to start.

## The Core Idea

VoxGlide is a text-based voice AI SDK for web pages. The browser handles all audio (speech-to-text via Web Speech API, text-to-speech via SpeechSynthesis). The server is a thin proxy that holds the API key and relays text + tool calls to/from Gemini. Audio never leaves the browser.

```
Browser (SDK)                         Server (proxy)
─────────────                         ──────────────
SpeechRecognition ─→ text ──── WS ──→ Receives user text
Execute DOM actions ←── WS ─────────← Gemini tool calls + text
SpeechSynthesis (TTS)                 Gemini API (holds key)
Page context scanning                 Session + history management
UI (Shadow DOM)                       Prompt caching, rate limiting
```

---

## 1. Page Scanning — How Context Is Built

When the SDK initializes with `autoContext: true`, it scans the current page and builds a text snapshot that tells the LLM what's on the page. This is the single most important piece of the system — without good context, the LLM can't act on the page.

### What Gets Scanned

| Section | Priority | What It Extracts |
|---------|----------|-----------------|
| **Header** | 10 | Page title, URL, meta description |
| **Forms** | 10 | Every `<input>`, `<select>`, `<textarea>` with: ID, type, label, current value, placeholder, required/disabled status. Skips password and hidden fields. |
| **Interactive Elements** | 8 | Buttons, links, toggles, tabs, sliders — anything a user can interact with. Each gets an index number, description, CSS selector, and capability tags (clickable, toggleable, editable, navigable, etc.) |
| **Headings** | 6 | h1-h6 outline tree showing page structure |
| **Navigation** | 5 | Links from `<nav>` elements, capped at 30 |
| **Content** | 3 | Main page text content, truncated to 3000 chars |

Sections are prioritized and fit within a **4000-token budget**. High-priority sections (forms, interactive elements) are always included; lower-priority ones (content, navigation) get truncated or dropped if the budget runs out.

### Interactive Element Discovery (Two-Phase Scan)

Finding interactive elements is harder than it sounds. Semantic HTML (`<button>`, `<a>`) is easy, but modern frameworks render clickable `<div>`s with no semantic markup. VoxGlide uses a two-phase approach:

**Phase 1 — Selector-based:** Scans ~19 CSS selectors covering buttons, links, ARIA roles (`[role="button"]`, `[role="tab"]`, `[role="switch"]`, etc.), `[tabindex]`, `[contenteditable]`, `[onclick]`, `[data-action]`, and form controls.

**Phase 2 — Cursor-pointer scan:** Searches up to 500 elements for `cursor: pointer` in computed styles. This catches React/Vue/Angular components that render as `<div>` or `<span>` but are visually and functionally clickable. Filters by minimum size (16px) and finds the outermost clickable ancestor to avoid duplicates.

Each discovered element gets:
- **Index number** — stable within a scan, used by the LLM to reference elements (e.g., "click element 3")
- **Description** — human-readable label derived from: aria-label → title → alt → placeholder → associated label → text content → nearby sibling text → icon context
- **CSS selector** — for actual DOM lookup during execution
- **Capabilities** — what the element can do: `clickable`, `toggleable`, `expandable`, `editable`, `draggable`, `selectable`, `navigable`
- **State** — current checked/expanded/disabled/selected/value state
- **Viewport status** — whether the element is currently visible on screen (viewport elements listed first)

### When Rescanning Happens

The page is not static — content changes, forms get filled, SPAs navigate. VoxGlide re-scans in response to:

1. **MutationObserver on `document.body`** — watches for meaningful DOM changes (child additions/removals, value changes, ARIA state changes). Debounced at 300ms. Ignores noise like style-only attribute changes.

2. **SPA navigation** — `NavigationObserver` patches `history.pushState` and `history.replaceState`, and listens for `popstate`. After detecting navigation, a "watch period" (up to 3 seconds) waits for the DOM to stabilize before scanning. This catches lazy-loaded content and framework hydration.

3. **Post-click URL changes** — after `clickElement` executes, the SDK checks if the URL changed. If so, triggers a rescan.

4. **Manual `scanPage` tool call** — the LLM can explicitly request a rescan when it suspects the page has changed.

### Change Detection — Avoiding Redundant Scans

Not every DOM mutation requires a full rescan. VoxGlide uses multiple layers of change detection:

- **Structural fingerprint** — hash of element counts. If the page structure hasn't changed, skip the full scan.
- **Value fingerprint** — hash of input values and content length. If only form values changed, do a lightweight "value-only refresh" (re-read form values, skip interactive element scan).
- **Per-section content hashing** — each context section (forms, headings, interactive, etc.) gets hashed via `simpleHash()`. Context is only re-sent to the server if at least one section actually changed.
- **SessionStorage cache** — scan results cached by URL + structural fingerprint. Revisiting the same page skips the scan entirely.

### The Formatted Output

After scanning, the context is formatted as plain text:

```
=== PAGE CONTEXT ===
[Header]
Page: Dashboard
URL: https://example.com/dashboard
Description: Admin Dashboard

[Forms]
Form Fields (use these IDs with fillField):
  - id="search" type="text" label="Search" placeholder="Search..."
  - id="status" type="select" label="Status" options: [All, Active, Inactive] value="All"

[Interactive Elements]
  [1] [button] "Create New" — clickable
  [2] [a] "Settings" — clickable, navigable
  [3] [input] "search" — editable
  [4] [select] "status" — editable, selectable
  [5] [button] "Export CSV" — clickable (off-screen)
  (Showing 5 of 5 interactive elements)

[Headings]
Page Outline:
Dashboard
  Active Users
  Recent Activity

[Navigation]
Navigation Links:
  - "Home" → /
  - "Users" → /users
  - "Settings" → /settings
=== END CONTEXT ===
```

This text block is injected into the LLM's system prompt so it understands the page before the user even speaks.

---

## 2. What Gets Sent to the LLM

Each conversation turn sends a structured request to Gemini:

### System Instruction

A fixed prompt from `constants.ts`:

```
You are a tool executor on a web page. You interact with it through tool calls.

{page context inserted here}

Rules:
- Action request → call appropriate tool(s)
- Question about page → answer in 1-2 sentences
- Cannot determine target → ask clarifying question
- Use element index numbers from context
- Click for navigation, never construct URLs
- Never fill password fields
- Never narrate or confirm actions
```

### Tool Declarations

The LLM receives function schemas for all available tools:

**Built-in tools:**
- `fillField(index?, fieldId?, value)` — fill a form field
- `clickElement(index?, description?, selector?)` — click an element
- `readContent(selector)` — read text from a page section
- `scanPage()` — rescan the page for updated context

**Dynamic tools** (registered at runtime):
- Custom developer tools from `config.actions.custom`
- Auto-discovered `window.nbt_functions` (polled every 2s)
- Workflow tools (startWorkflow, workflowStepComplete, etc.) if workflows are enabled
- Accessibility tools (describePage, focusElement, etc.) if accessibility mode is enabled

### Conversation History

The last **20 entries** of conversation history, structured as alternating user/model turns. Each entry can contain:
- `text` — user message or AI response
- `functionCall` — tool the AI wants to call (name + args)
- `functionResponse` — result of a tool execution

Page context is injected as a conversation prefix (a user message with the context text, followed by a minimal model acknowledgment), so it's always fresh — not part of the capped history.

---

## 3. Caching and Token Optimization

VoxGlide uses multiple layers of caching to minimize token usage and cost:

### Gemini Prompt Caching (Server-Side)

The system instruction + tool declarations are often large and rarely change. VoxGlide uses Gemini's native prompt caching:

- On each turn, the server hashes `systemInstruction + tools`
- If the hash matches the existing cache → reuse it (send only `cachedContent: "cachedContents/xyz"` instead of the full text)
- If hash changed (tools updated) → delete old cache, create new one
- Cache TTL: 10 minutes, auto-recreated as needed
- Minimum size: ~2048 tokens (below that, caching overhead isn't worth it)
- **Savings: ~90% token reduction** on the cached portion

### Context Change Detection (Client-Side)

- Per-section fingerprinting prevents re-sending unchanged context to the server
- Structural + value fingerprinting prevents redundant DOM scans
- SessionStorage caching prevents rescanning pages the user revisits

### History Management

- **Entry cap:** 20 entries sent to LLM (older turns dropped)
- **Summarization:** If estimated tokens exceed 25K and history has more than 6 turns, older history is compressed into a single summary via a separate Gemini call. The summary replaces old turns, keeping the last 6 intact.
- **Emergency cap:** If history ever exceeds 200 entries (safety net), hard truncate to last 6.
- **Tool response compaction:** Large results from read-tools (`scanPage`, `readContent`) are replaced with `{compacted: true}` in history after the LLM processes them. This prevents re-sending thousands of tokens on follow-up turns.

### Speech Debouncing (Client-Side)

Browser speech recognition fires multiple "final" results in quick succession. The SDK batches them:
- 150ms debounce timer per final result
- 500ms maximum total delay
- Combined text sent as one message to prevent server queue explosion

---

## 4. Tool Call Lifecycle

When the LLM decides to act on the page, here's the full flow:

```
1. LLM generates function call(s) in its response
   ↓
2. Server extracts calls, assigns UUIDs, sends to browser:
   { type: 'toolCall', functionCalls: [{id, name, args}], turnId }
   ↓
3. Browser receives → ActionRouter looks up handler by name
   ↓
4. Handler executes (e.g., DOMActions.fillField):
   a. Resolve target element: index → id → name → fuzzy text match
   b. Scroll into view, focus
   c. Set value using native input setter (React/Vue compatible)
   d. Dispatch input/change/blur events
   e. Return { result: JSON.stringify({ success: true, field, value }) }
   ↓
5. Browser sends result back:
   { type: 'toolResult', functionResponses: [{id, name, response}], turnId }
   ↓
6. Server feeds result to LLM, which decides:
   - Done → send final text response
   - Need more → generate another tool call (recurse)
   ↓
7. Recursion limit: 5 levels deep (safety cap)
   Recursion logic:
   - Depth 0: always recurse (model may have multi-step plans)
   - Depth 1+: recurse if a "read tool" was called OR any result had an error
   - Stop if all tools were "action tools" and all succeeded
```

**Multiple tool calls in one turn** execute in parallel (`Promise.all`), and results are sent back together.

### Element Resolution

When the LLM says "click element 3" or "fill the email field", the SDK resolves the target:

**For `clickElement`:**
1. By index number (fastest, most reliable — maps directly to scan results)
2. By CSS selector (exact querySelector match)
3. By text description (scored fuzzy matching across all interactive elements — text content, aria-label, title, nearby labels)

**For `fillField`:**
1. By index number
2. By element ID
3. By name attribute
4. By label text, placeholder, aria-label
5. By combobox role
6. Scored fuzzy matching as fallback

If the element isn't found, the SDK waits up to 3 seconds (via MutationObserver) for it to appear, then retries. This handles elements that render asynchronously.

---

## 5. Session Management

### Session Lifecycle

```
Client connects (WebSocket) → session.start { sessionId?, config }
  ↓
Server creates/resumes TrackedSession:
  - history[], systemInstruction, pageContext, tools
  - token counters, cache state
  - WebSocket reference
  ↓
Server responds: session.started { sessionId, resumed? }
  ↓
Conversation happens (text ↔ toolCall ↔ toolResult ↔ response)
  ↓
Client disconnects → 30-minute grace period
  ↓
If reconnected within 30 min → session resumed (history preserved)
If not → session deleted, cache cleaned up
```

### Navigation Persistence

VoxGlide sessions survive page navigation:

**Hard navigation** (link click, form submit, `location.href`):
1. `beforeunload` fires → SDK saves session state to `sessionStorage` (config + sessionId)
2. New page loads → new SDK instance reads saved state
3. SDK reconnects to same server session with same sessionId
4. Server swaps WebSocket reference, preserves history
5. Transcript restored from sessionStorage for visual continuity

**SPA navigation** (pushState, replaceState, popstate):
1. `NavigationObserver` detects URL change
2. No reconnection needed — same WebSocket stays open
3. Element caches invalidated (old DOM references are stale)
4. Watch period starts (wait for DOM to stabilize)
5. Context rescanned and sent to server via `context.update`

**Post-click navigation** (click triggers URL change):
1. After `clickElement` executes, SDK checks if URL changed
2. If yes, triggers same flow as SPA navigation

### Turn Queue

If the user sends multiple messages while the LLM is still processing:
- Messages are queued and processed serially
- Each turn gets a unique `turnId`
- Queued turns can be cancelled before execution
- If user sends text while a turn is already queued, text is merged into the queued turn (prevents redundant LLM calls)

---

## 6. WebSocket Protocol

### Client → Server

| Message | Purpose |
|---------|---------|
| `session.start` | Initialize or reconnect a session |
| `text` | Send user speech/text to LLM |
| `toolResult` | Return tool execution results |
| `context.update` | Send updated page context (after rescan) |
| `turn.cancel` | Cancel a queued turn |
| `session.stop` | End session |
| `scan` | Send page scan data (for admin dashboard) |
| `tool.progress` | Tool execution status (for admin monitoring) |

### Server → Client

| Message | Purpose |
|---------|---------|
| `session.started` | Session ready, here's your sessionId |
| `response.delta` | Streaming text chunk from LLM |
| `response` | Final complete text response |
| `toolCall` | Execute these tools on the page |
| `usage` | Token usage for this turn |
| `queue.update` | Current turn queue state |
| `error` | Something went wrong |
| `context.updated` | Acknowledged context update |

---

## 7. UI System

The SDK renders its UI inside a **Shadow DOM** to prevent style conflicts with the host page:

- **FloatingButton** — mic toggle (voice mode) or message icon (text mode), with state animations (idle, listening, thinking, error)
- **TranscriptOverlay** — chat-like panel showing the conversation, with text input for typing, tool execution status, and queue display with cancel buttons
- **Self-healing** — if SPA frameworks remove the SDK's host element, a MutationObserver + interval guard re-attaches it

All CSS classes are prefixed with `vsdk-` and all SDK elements are marked with `data-voice-sdk`.

---

## 8. Key Design Decisions

| Decision | Why |
|----------|-----|
| **Text-based protocol** | Browser APIs handle STT/TTS well. Streaming audio to the server would add latency, complexity, and cost with little benefit. |
| **Proxy server** | API key never touches the browser. The server is intentionally thin — text in, text + tool calls out. |
| **Index-based element references** | More reliable than CSS selectors (which break on dynamic pages) or text matching (which is ambiguous). The LLM says "click 3", the SDK knows exactly which element. |
| **Shadow DOM for UI** | SDK styles never leak into the host page, host styles don't break the SDK. Essential for an embeddable widget. |
| **Native input setter trick** | `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)` triggers React/Vue/Angular change detection. Without this, framework state wouldn't update when the SDK fills forms. |
| **MutationObserver for auto-context** | Pages change constantly. Polling would be wasteful; mutation observation is efficient and event-driven. |
| **SessionStorage for navigation** | Survives page reloads (unlike memory), scoped to the tab (unlike localStorage), and doesn't require server-side storage. |
| **No peer dependencies** | The SDK must work when dropped into any page via a `<script>` tag. Zero dependency assumptions. |

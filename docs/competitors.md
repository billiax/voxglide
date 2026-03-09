# VoxGlide Competitor Research

Research date: 2026-03-07

---

## VoxGlide's Unique Position

VoxGlide occupies a distinct niche that no single competitor fully covers:

| Capability | VoxGlide | Vapi/ElevenLabs/Retell | LipSurf/Handsfree | Voiceflow/Botpress | Webfuse | Skyvern/Browser Use |
|---|---|---|---|---|---|---|
| Embeddable JS SDK | Yes | Yes | No (extensions) | Yes (widget) | No (proxy) | No (server-side) |
| Voice input | Yes | Yes | Yes | Partial | Yes | No |
| LLM-powered understanding | Yes | Yes | No | Yes | Yes | Yes |
| DOM actions (fill/click/nav) | Yes | No | Yes | No | Yes | Yes |
| Text-based protocol | Yes | No | Yes | N/A | No | N/A |
| API key stays on server | Yes | Yes (cloud) | N/A | Yes (cloud) | Yes | Yes |
| Shadow DOM isolated UI | Yes | No | N/A | No | No | No |

**Closest competitor: Webfuse** -- combines voice + LLM + DOM actions, but requires routing your entire site through their proxy rather than being a drop-in SDK.

---

## Category 1: Voice AI Assistants for Websites

### Vapi
Developer platform for building voice AI agents. JS SDK and embeddable web widget (single line of code). Manages WebSocket connections and audio streaming. Supports mixing AI models (OpenAI, Anthropic, Google, Deepgram, ElevenLabs).
- **Similar:** Embeddable JS SDK, voice interaction, LLM-powered, WebSocket-based
- **Different:** Streams actual audio (not text-based). No DOM actions (form filling, clicking, navigation). Cloud-hosted infrastructure. Focused on phone/voice calls
- **Pricing:** $0.05/min platform fee + provider costs. Real-world $0.15-$0.50+/min. Plans from $500/month
- https://vapi.ai/

### ElevenLabs Conversational AI
Embeddable voice agent widget. Best known for ultra-realistic voice synthesis. Widget supports voice and text modes. Integrates with Webflow, WordPress, Wix, Framer via script tag.
- **Similar:** Embeddable widget, voice interaction, LLM-powered agent
- **Different:** Streams audio (not text-based). No DOM actions. Focused on voice quality/TTS. Requires public agents with auth disabled for widget mode
- **Pricing:** Calls from $0.10/min (~50% recent discount). $0.08/min on annual business. General platform from $5/month
- https://elevenlabs.io/conversational-ai

### Retell AI
AI voice and chat agent platform. Embeddable website widget via single script tag using public key (no backend proxy required). Chat and callback (phone) widget modes.
- **Similar:** Embeddable widget, voice interaction, LLM-powered
- **Different:** No backend proxy needed (public key on client). Primarily customer service/phone. No DOM actions. Audio-based protocol
- **Pricing:** Pay-as-you-go. Voice $0.07+/min, chat $0.002+/message. Real-world $0.13-$0.31/min. 10 free USD
- https://www.retellai.com/

### Picovoice
On-device voice AI SDK running entirely in the browser via WebAssembly. Wake word detection, speech-to-intent, STT, TTS -- all locally, no cloud.
- **Similar:** JS SDK, voice interaction, browser-based speech
- **Different:** Fully on-device (no server, no LLM). Rule-based intent, not conversational. No DOM actions. Privacy-first
- **Pricing:** Free tier with unlimited voice interactions. Starter and Enterprise tiers
- https://picovoice.ai/

---

## Category 2: Voice-Controlled Web Navigation

### LipSurf
Chrome extension for voice-controlled browsing. Dictate, click, navigate, control browser by voice. Plugin architecture for site-specific extensions (YouTube, Gmail).
- **Similar:** Voice-controlled DOM interaction (clicking, forms, navigation). Web Speech API. Extensible
- **Different:** Browser extension, not embeddable SDK. No LLM -- pattern-matching commands only. Users install it, site owners can't embed it
- **Pricing:** Free tier, Plus $3/month, Premium $6/month
- https://www.lipsurf.com/

### Handsfree for Web
Chrome extension and open-source JS library for voice-controlled browsing. Hundreds of built-in commands for scrolling, clicking, form filling, tab management, dictation.
- **Similar:** Voice-controlled DOM actions. Web Speech API. Also available as embeddable JS library
- **Different:** No LLM -- command-based, not conversational. Primarily an accessibility tool
- **Pricing:** Free (open source)
- https://www.handsfreeforweb.com/
- https://github.com/sljavi/handsfree-for-website

### Voxpow
Lightweight JS library (3KB) for speech recognition and custom voice commands on any website. Dictation into text fields, custom commands, search by voice.
- **Similar:** Embeddable JS SDK, voice commands, Web Speech API, tiny footprint, no dependencies
- **Different:** No LLM -- predefined commands only. No DOM action execution beyond dictation. Admin dashboard for config
- **Pricing:** Free registration, 14-day trial. Free and PRO plans
- https://voxpow.com/

---

## Category 3: Conversational AI Widgets

### Voiceflow
No-code platform for conversational AI agents. Embeddable web chat widget with voice and text. Visual drag-and-drop builder. Dialog Manager API for custom UIs.
- **Similar:** Embeddable widget, voice + text, LLM-powered (GPT-4, Claude)
- **Different:** No-code builder focus, not developer SDK. No DOM actions. No form filling or navigation
- **Pricing:** Pro $60/month/editor (10K credits), Business $150/month/editor. 7-day trial
- https://www.voiceflow.com/

### Botpress
Full-stack AI agent platform with visual conversation builder, JS editor for custom actions, embeddable web chat widget.
- **Similar:** Embeddable widget, LLM-powered, JS custom actions
- **Different:** Text-only (no voice). No DOM manipulation. Chatbot/support focused. Plus plan ($89/month) to remove branding
- **Pricing:** Free up to 500 messages/month. Pay-as-you-go from $1/month
- https://botpress.com/

---

## Category 4: Browser Voice Control SDKs

### JSVoice (VoiceUI-js)
Framework-agnostic voice command and captions SDK. Web Speech API with Whisper fallback. Web Components (mic, status, transcript) plus React hooks. Wake word support, command pattern matching, TTS.
- **Similar:** Web Speech API, JS SDK, voice commands, TTS, Web Components, framework-agnostic. Very close in the STT/TTS layer
- **Different:** No LLM -- pattern-based only. No DOM action execution. No proxy server. 32KB bundle
- **Pricing:** Free (open source)
- https://github.com/VoiceUI-js/JSVoice

### Artyom.js
JS library for speech recognition, voice commands, and speech synthesis using Web Speech API.
- **Similar:** Web Speech API, voice commands, browser TTS
- **Different:** No LLM. Simple command matching. Older, less maintained
- **Pricing:** Free (open source)
- https://sdkcarlos.github.io/sites/artyom.html

---

## Category 5: AI Web Agents

### Webfuse (Closest Competitor)
Proxy layer that sits in front of any website and augments it with AI agent "Extensions." Voice agents (via ElevenLabs) can take DOM snapshots, click elements, fill forms, navigate -- all by voice using tool calls.
- **Similar:** Voice-controlled DOM actions (click, type, navigate). LLM-powered tool calls. Proxy architecture. Works on any website
- **Different:** Acts as reverse proxy (not embeddable SDK). Requires routing domain through Webfuse. ElevenLabs for voice (audio streaming). DOM snapshots for LLM analysis. More infrastructure-heavy
- **Pricing:** Not public. Contact sales
- https://www.webfuse.com/

### Skyvern
Open-source AI browser automation using LLMs and computer vision. Screenshots + Vision-LLM to identify interactive elements and execute actions.
- **Similar:** LLM-powered DOM interaction, tool calls, form filling, navigation
- **Different:** Not voice-controlled (API/programmatic). Server-side headless browser. Vision-based (screenshots). Backend automation, not end-user interaction
- **Pricing:** Open source. Cloud hosting pricing not public
- https://github.com/Skyvern-AI/skyvern

### Browser Use
Open-source Python framework giving an LLM full browser control. 89.1% on WebVoyager benchmark.
- **Similar:** LLM-driven DOM interaction, form filling, navigation
- **Different:** Python server-side automation. Not voice-controlled. Autonomous task completion, not real-time user interaction
- **Pricing:** Open source
- https://github.com/browser-use/browser-use

---

## Category 6: Voice Frameworks

### Pipecat (by Daily)
Open-source framework for real-time voice and multimodal conversational AI. Python server with JS/React client SDKs. Orchestrates STT, LLM, TTS into low-latency voice pipeline.
- **Similar:** Voice AI with LLM, JS client SDK, real-time conversation
- **Different:** General-purpose, not web-page-specific. No DOM actions. Audio streaming. Python server. Requires assembling own STT/LLM/TTS stack
- **Pricing:** Open source (framework)
- https://github.com/pipecat-ai/pipecat

# Server Setup

The VoxGlide server is a thin WebSocket proxy between the browser SDK and an LLM provider. It holds the API key so it never reaches the client.

## Quick Start

```bash
cd server
npm install

# Pick your provider:
GEMINI_API_KEY=your-key npm run dev
```

## Environment Variables

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

## Default Models

| Provider | Default Model |
|----------|---------------|
| Gemini | `gemini-2.5-flash` |
| OpenAI | `gpt-4o` |
| Anthropic | `claude-sonnet-4-20250514` |
| Ollama | `llama3.1` |

## Provider Auto-Detection

If `LLM_PROVIDER` is not set, the server picks the provider based on which API key is present, in this order: Gemini > OpenAI > Anthropic. If no key is found and Ollama is reachable, it falls back to Ollama.

## Multiple Providers

Only one provider is active per server instance. To switch, restart with a different API key or `LLM_PROVIDER` value.

## Admin Dashboard

The server includes a built-in admin dashboard at `/admin` for monitoring live sessions, viewing event logs, and analyzing page context scans.

## WebSocket Protocol

Client-to-server messages: `session.start`, `text`, `toolResult`, `session.stop`

Server-to-client messages: `session.started`, `response`, `toolCall`, `usage`, `error`

## SDK Serving

The server serves the SDK bundle files from disk at `/sdk/`. When developing, changes to `src/` trigger a Rollup rebuild and the server serves the updated files on the next request — no server restart needed.

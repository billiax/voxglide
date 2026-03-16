# Contributing to VoxGlide

Thank you for your interest in contributing! This guide will help you get started.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## Prerequisites

- **Node.js** >= 18.0.0
- **npm** (comes with Node.js)
- A Gemini/OpenAI/Anthropic API key (for testing the server)

## Setup

```bash
git clone https://github.com/billiax/voxglide.git
cd voxglide
npm install

# Verify everything works
npm run check
```

## Development Workflow

```bash
npm run build          # Build ESM + IIFE bundles to dist/
npm run dev            # Watch mode build
npm run typecheck      # TypeScript type checking
npm test               # Run all unit tests
npm run test:watch     # Watch mode tests
npm run lint           # ESLint check
npm run check          # Run ALL gates: typecheck + lint + test
```

### Server

```bash
cd server && npm install
GEMINI_API_KEY=your-key npm run dev    # Dev with auto-reload
```

See [docs/server.md](docs/server.md) for full server configuration.

## Project Structure

```
src/                    # SDK source
  ai/                   # WebSocket session, speech capture
  actions/              # DOM action handlers + tool declarations
  context/              # Page context scanning
  ui/                   # Shadow DOM UI components
server/                 # WebSocket proxy server
  admin/                # Admin dashboard
tests/
  unit/                 # Unit tests (mirrors src/ structure)
  mocks/                # Shared mock factories
docs/                   # Documentation
examples/               # Demo HTML pages
```

## Submitting Issues

- **Bugs:** Use the [bug report template](https://github.com/billiax/voxglide/issues/new?template=bug_report.yml)
- **Features:** Use the [feature request template](https://github.com/billiax/voxglide/issues/new?template=feature_request.yml)
- **Security issues:** See [SECURITY.md](SECURITY.md) — do NOT open public issues

## Pull Request Process

1. **Fork** the repository and create a branch from `main`
2. **Branch naming:** `feat/description`, `fix/description`, `docs/description`
3. **Write tests** for any new or changed behavior
4. **Run `npm run check`** — all gates must pass (typecheck, lint, test)
5. **Open a PR** against `main` with a clear description
6. Respond to review feedback

### PR Checklist

- [ ] Read this contributing guide
- [ ] Code follows the project style (see below)
- [ ] Tests added/updated for changed behavior
- [ ] `npm run check` passes
- [ ] Documentation updated if needed

## Code Style

- **TypeScript strict mode** — no `any` unless unavoidable
- **Named exports only** — no default exports
- **Types in `types.ts`** files per module group
- **Event names:** camelCase, compound events use colon (e.g., `action:before`)
- **CSS class prefix:** `vsdk-`
- **SDK DOM elements** marked with `data-voice-sdk` attribute
- **Error results:** `{ result: JSON.stringify({ error: "..." }) }`
- **Success results:** `{ result: JSON.stringify({ success: true, ... }) }`

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(sdk): add new context provider for metadata
fix(server): handle WebSocket reconnection edge case
docs: update configuration guide
test: add unit tests for ActionRouter
refactor(ui): simplify theme switching logic
```

**Scopes:** `sdk`, `server`, `admin`, `ui`, `actions`, `context`, `ai`

## Testing

- Tests live in `tests/unit/` mirroring the `src/` structure
- Use mock factories from `tests/mocks/` for shared stubs
- Test file naming: `tests/unit/<ModuleName>.test.ts`
- Test edge cases: empty inputs, missing elements, disabled fields, error paths
- For DOM actions: create test DOM fixtures, verify events fire

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

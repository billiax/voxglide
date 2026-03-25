# [1.1.0](https://github.com/billiax/voxglide/compare/v1.0.1...v1.1.0) (2026-03-25)


### Features

* **build:** add build mode with tool generation, browser introspection, and UI ([639ce01](https://github.com/billiax/voxglide/commit/639ce01b55abcf5cca4cc2c5914420b436f98d4d))
* **extension:** add build mode settings, CORS bridge, and workspace auto-generation ([88de623](https://github.com/billiax/voxglide/commit/88de6235f3a52edc579fc244fdbccb5a171e71dd))
* **server:** add functions CRUD API, URL matching, and generated tool serving ([3ba3630](https://github.com/billiax/voxglide/commit/3ba36306fc7c9a52dfef5cb8b8b469f3d71d0b58))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-06-01

### Added

- Voice and text input modes with browser Speech API
- Auto-context scanning (forms, headings, navigation, interactive elements)
- Built-in DOM actions: fill fields, click elements, read content, navigate, scan page
- Multi-LLM proxy server supporting Gemini, OpenAI, Anthropic, and Ollama
- Shadow DOM UI with theming presets, sizes, and full color control
- Conversation workflows with guided multi-step flows and validation
- Accessibility mode with ARIA live regions, keyboard shortcuts, and screen reader tools
- Custom tool registration via config, runtime API, and `window.nbt_functions`
- SPA navigation detection with automatic session persistence
- Admin dashboard for real-time session monitoring and page analysis
- ESM and IIFE bundle formats
- Zero runtime dependencies

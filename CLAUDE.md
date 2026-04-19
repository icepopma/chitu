# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chitu (赤兔) is an educational AI Agent system built from scratch, architecturally aligned with OpenAI Codex. It uses GLM-5 (智谱AI) with function calling to implement an autonomous coding agent. The system has a WebSocket backend (Node.js/TypeScript) and a React frontend (Discord-style chat UI).

## Development Commands

```bash
# Backend server (production entry)
npx tsx src/start-server.ts              # WebSocket server on port 8080

# CLI mode (terminal interface, no browser needed)
npm run cli

# Frontend
cd web-ui && npm run dev                 # Vite dev server on port 3000

# Type checking
npx tsc --noEmit                         # backend
cd web-ui && npx tsc -b                  # frontend

# Linting (frontend only)
cd web-ui && npm run lint                # ESLint

# Build
npm run build                            # tsc compile (backend only)
cd web-ui && npm run build               # Vite build (frontend)

# Tests (vitest)
npm test                                 # run all tests
npm run test:watch                       # watch mode
npx vitest run src/tools/apply-patch/apply-patch.test.ts   # single test file

# E2E Tests (Playwright, requires frontend on port 3000)
npm run test:e2e                         # or: npx playwright test
```

**Note:** `npm run dev` references `src/main.ts` which does not exist. Use `npx tsx src/start-server.ts` to run the backend server directly.

Test files live in two locations: `src/**/*.test.ts` (colocated unit tests) and `tests/**/*.test.ts` (integration tests).

### CI Pipeline

GitHub Actions runs on push/PR to `main` and `develop`: backend typecheck + frontend typecheck + frontend lint + `npm test` + backend build + frontend build + Docker build.

## Architecture

4-layer architecture aligned with Codex:

```
Transport (WebSocket/JSON-RPC or CLI readline)
  → Message Processor (JSON-RPC ↔ ThreadManager translation)
    → Thread Manager (create/resume/runTurn/fork)
      → Agent Loop (while loop: LLM → tool_calls → execute → repeat)
```

CLI mode (`npm run cli` → `src/cli/index.ts`) bypasses the first 2 layers, directly instantiating ThreadManager.

### Data Model (`src/types.ts`)

- **Thread** = complete conversation (multi-turn), persisted in PG + JSON
- **Turn** = one round of conversation (a multi-step task)
- **Item** = a single step (user_message, assistant_message, tool_call, tool_result)
- **AppEvent** = event protocol aligned with Codex (thread/started, turn/started, item/started, item/completed, item/delta, etc.)

**Do not modify `AppEvent` type** — it aligns with the Codex protocol.

### Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| Agent Loop | `src/agent/loop.ts` | Core while loop: LLM call → tool_calls → execute → repeat. Builds system prompt via `buildSystemPrompt()`. |
| Agent Spawner | `src/agent/spawn.ts` | Multi-agent collaboration, depth limit 3. `createSpawnTool` factory. |
| LLM Client | `src/llm/client.ts` | GLM-5 API with SSE streaming + 3-attempt retry with exponential backoff. |
| Tool System | `src/tools/` | Plugin-based via `PluginLoader`. New tools must be plugins implementing `Plugin` interface from `src/tools/plugin-types.ts`. |
| Thread Manager | `src/thread/manager.ts` | Orchestrates threads, runs Agent Loop via `runTurn()`, emits events, quota/memory/env handling. |
| Thread Store | `src/thread/store.ts` | Dual persistence: Neon PG (primary) + JSON fallback in `chitu-data/threads/`. |
| Server | `src/server/` | WebSocket + HTTP. `message-processor.ts` translates JSON-RPC ↔ ThreadManager. HTTP endpoints: `/health`, `/metrics`, `/status`, `/dashboard`, `/upload/image`. |
| Auth | `src/auth/` | Zero external deps: API Key (`timingSafeEqual`) + JWT (HMAC-SHA256) + `scryptSync` passwords. |
| Database | `src/db/` | Neon PG via `@neondatabase/serverless`. Migrations are idempotent (`IF NOT EXISTS`). Falls back to JSON if DB unavailable. |
| Hooks | `src/hooks/` | 5 event points (pre_tool_use, post_tool_use, session_start, user_prompt_submit, session_end). Shell commands with JSON stdin/stdout. |
| MCP | `src/mcp/` | Model Context Protocol client, stdio transport. Tool naming: `mcp__{server}__{tool}`. Config: `~/.chitu/mcp.json` + `.chitu/mcp.json`. |
| Sandbox | `src/sandbox/` | macOS: `sandbox-exec` with Seatbelt SBPL. Linux: Docker reserved. |
| Config | `src/config/` | 4-layer: global `~/.chitu/config.json` → project `.chitu/config.json` → env vars → CLI args. |

### Installed Plugins (`src/tools/plugins/`)

`exec`, `files`, `git`, `plan`, `milestone`, `indexer`. Each plugin is a directory with an `index.ts` exporting a `Plugin` object.

### Frontend (`web-ui/`)

React 19 + Vite 8 + TailwindCSS 4 + Zustand 5. Singleton WebSocket hook (`useChituSocket.ts`) — do not create multiple connections. State lives in `web-ui/src/lib/store.ts` (Zustand store).

## Coding Conventions

- **TypeScript + ESM** with `"type": "module"`. Import paths use `.js` suffix.
- **LLM**: GLM-5 via 智谱AI. Requires `ZHIPU_API_KEY`. Endpoint configurable via `ZHIPU_CODING_ENDPOINT`.
- **Tool interface**: All tools follow `Tool` interface in `src/tools/base.ts`. New tools go in `src/tools/plugins/` implementing `Plugin` from `src/tools/plugin-types.ts`. Each plugin directory has its own `index.ts` (e.g., `plugins/exec/index.ts`, `plugins/files/index.ts`, `plugins/plan/index.ts`).
- **Tool registration**: Use `createToolRegistryAsync()` for async init + MCP loading. Core plugins are registered in `src/tools/index.ts`.
- **System prompt**: Built in `buildSystemPrompt()` in `src/agent/loop.ts`. Codex-aligned with Chinese responses.
- **Context window**: Messages compacted when exceeding 80K tokens. System prompt + AGENTS.md re-injected after compaction.
- **Source comments**: Each module has a JSDoc header with purpose and learning focus (学习重点) — this is an educational project.
- **Multimodal**: Images uploaded via HTTP POST to `chitu-data/uploads/`. `ContentPart[]` type supports text + image_url.
- **tsc target**: ES2023, module ES2022, bundler resolution. Tests excluded from compilation (`exclude: ["src/**/*.test.ts"]`).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZHIPU_API_KEY` | Yes | 智谱AI API Key for GLM-5 |
| `ZHIPU_CODING_ENDPOINT` | No | GLM-5 API endpoint override |
| `NEON_DATABASE_URL` | No | Neon PostgreSQL connection string (falls back to JSON files) |
| `CHITU_API_KEY` | No | WebSocket static API Key authentication |
| `CHITU_JWT_SECRET` | No | JWT token signing secret |
| `CHITU_AUTH_DISABLED` | No | Disable auth for development |
| `CHITU_QUOTA_DISABLED` | No | Disable quota checking for development |
| `PORT` | No | Server port (default 8080) |
| `CHITU_MAX_ITERATIONS` | No | Agent loop max iterations (default 10000) |

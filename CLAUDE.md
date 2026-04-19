# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chitu (赤兔) is an educational AI Agent system built from scratch, architecturally aligned with OpenAI Codex. It uses GLM-5 (智谱AI) with function calling to implement an autonomous coding agent. The system has a WebSocket backend (Node.js/TypeScript) and a React frontend (Discord-style chat UI).

## Development Commands

```bash
# Backend (hot reload)
npm run dev                              # tsx watch src/main.ts

# Backend (no reload)
npx tsx src/start-server.ts              # Start WebSocket server (port 8080)

# CLI mode (terminal interface, no browser needed)
npm run cli                              # tsx src/cli/index.ts

# Frontend
cd web-ui && npm run dev                 # Start Vite dev server (port 3000)
cd web-ui && npm run lint                # ESLint

# Build
npm run build                            # TypeScript compile (tsc)

# Tests
npm test                                 # node --experimental-vm-modules --test tests/

# E2E Tests (Playwright, requires frontend running on port 3000)
npx playwright test                      # Run all e2e tests
```

## Architecture

4-layer architecture aligned with Codex:

```
Transport (WebSocket/JSON-RPC or CLI readline)
  → Message Processor (JSON-RPC ↔ ThreadManager translation)
    → Thread Manager (create/resume/runTurn/fork)
      → Agent Loop (while loop: LLM → tool_calls → execute → repeat)
```

CLI mode bypasses the first 2 layers, directly instantiating ThreadManager:

```
CLI (readline)
  → Thread Manager (direct, no JSON-RPC)
    → Agent Loop
```

### Key Data Model (`src/types.ts`)

- **Thread** = complete conversation (multi-turn), persisted in PG + JSON
- **Turn** = one round of conversation (a multi-step task)
- **Item** = a single step (user_message, assistant_message, tool_call, tool_result)
- **AppEvent** = event protocol aligned with Codex (thread/started, turn/started, item/started, item/completed, item/delta, etc.)

### Core Modules

| Module | Path | Purpose |
|--------|------|---------|
| Agent Loop | `src/agent/loop.ts` | While loop: LLM call → check for tool_calls → execute tools → repeat until text-only response or max iterations (10000). Builds Codex-aligned system prompt via `buildSystemPrompt()`. Supports streaming (`onStreamDelta`), multimodal content (`multimodalContent`), file change injection, and env delta. |
| Agent Spawner | `src/agent/spawn.ts` | Multi-agent collaboration. `AgentSpawner` manages child Agent Loop instances with depth limit (3 levels). `AsyncMessageQueue` for inter-agent messaging. `createSpawnTool` factory creates `agent_spawn` tool. |
| Review Prompt | `src/agent/review-prompt.ts` | Review mode: specialized system prompt + read-only tool filtering + read-only command detection (regex-based). Agent only analyzes code, never modifies. |
| Context Compaction | `src/agent/compact.ts` | Summarizes message history when it exceeds 80K tokens, preserving recent context and re-injecting system prompt. |
| Context Builder | `src/context.ts` | Hierarchical AGENTS.md loading (root→CWD, respecting override precedence), environment context, skills injection. |
| LLM Client | `src/llm/client.ts` | GLM-5 API client with SSE streaming (`chatStream`) and non-streaming (`chat`). Supports multimodal `ContentPart[]` (text + image_url). 3-attempt HTTP retry with exponential backoff. Metrics injection via `setMetrics()`. |
| Tool System | `src/tools/` | Plugin-based via `PluginLoader`. `Plugin` groups one or more `Tool` instances with lifecycle hooks (`onLoad`/`onUnload`/`onError`). Dependencies resolved by topological sort. |
| Tool Plugins | `src/tools/plugins/` | Plugin groups: `exec` (shell execution with sandbox), `files` (read/write/edit/patch), `plan` (task planning), `git` (8 tools: status/diff/blame/log/checkpoint/rollback/ghost_commit/ghost_rollback), `milestone` (progress tracking with git checkpoints), `indexer` (code_search tool). |
| Thread Manager | `src/thread/manager.ts` | Orchestrates threads, runs Agent Loop via `runTurn()`, emits events, handles streaming items, quota checking, usage recording, memory extraction, environment snapshots, spawn tool creation. |
| Thread Store | `src/thread/store.ts` | Dual persistence: Neon PostgreSQL (primary, via `NEON_DATABASE_URL`) + JSON file fallback in `chitu-data/threads/`. Auto-migrates on startup. |
| Database | `src/db/` | Neon PostgreSQL via `@neondatabase/serverless`. 10 migrations (threads, rollout_events, memories, active_turns, users, organizations, org_members, usage_logs, quotas). `connection.ts` for pool management, `migrate.ts` for idempotent migrations. |
| Crash Recovery | `src/db/crash-recovery.ts` | `active_turns` table persists turn state (start/complete/fail/interrupt). On startup, `recoverInterruptedTurns()` scans for unfinished turns. Environment snapshots persisted to DB. |
| Auth | `src/auth/` | `index.ts`: WebSocket handshake auth (API Key with `timingSafeEqual` + JWT with self-implemented HS256, zero external deps). `user-store.ts`: User CRUD + `crypto.scryptSync` password hashing + JWT generation + organization management. |
| Server | `src/server/` | `index.ts`: WebSocket + HTTP server. `json-rpc.ts`: JSON-RPC 2.0 parsing/response. `message-processor.ts`: Protocol translation + 30+ method routes (thread/turn/approval/auth/org/usage/quota). `user-handlers.ts`: Auth/org JSON-RPC handlers. `usage-handlers.ts`: Usage/quota JSON-RPC handlers. `dashboard-analytics.ts`: Aggregated analytics. HTTP endpoints: `/health`, `/metrics`, `/status`, `/dashboard`, `/upload/image`, static file serving for uploads. |
| Hooks | `src/hooks/` | 5 event points: `pre_tool_use` (can block/modify), `post_tool_use` (can modify output), `session_start`, `user_prompt_submit` (can modify prompt), `session_end`. Shell commands with JSON stdin/stdout. |
| Memories | `src/memories/` | Extracts learnings from completed turns (5 categories: preference/architecture/convention/failure/fact) and injects into future conversations. PG primary + JSON backup. |
| Skills | `src/skills/` | Skills loading system. Auto-discovers `.agents/skills/*/SKILL.md`. Hot-reload via `SkillsWatcher`. Injects matched skills into Agent context. |
| MCP Integration | `src/mcp/` | Model Context Protocol client. stdio transport + JSON-RPC 2.0 handshake + `tools/list` discovery. Tool naming: `mcp__{server}__{tool}`. Config: global `~/.chitu/mcp.json` + project `.chitu/mcp.json`. Load failure doesn't block core tools. |
| Code Indexer | `src/indexer/` | TypeScript Compiler API AST symbol extraction (9 types: function/class/interface/type/variable/enum/method/property/import). Keyword + camelCase split search with path weight scoring. mtime incremental indexing + lazy loading. |
| Monitoring | `src/monitoring/` | `metrics.ts`: 8 Prometheus metrics (turn histogram, token counter, LLM request timing, active connections gauge, tool call counter). `logger.ts`: StructuredLogger (JSON with timestamp/level/message/requestId/context). `usage.ts`: Usage recording + aggregation queries. `quota.ts`: Plan definitions (free/pro/enterprise) + quota checking + configuration. |
| Config | `src/config/` | 4-layer config: global `~/.chitu/config.json` → project `.chitu/config.json` → env vars → CLI args. 7 files: types/defaults/loader/merge/env/validate/index. `getConfig()` singleton with caching. |
| File Watcher | `src/watcher/` | `file-watcher.ts`: fs.watch recursive, 500ms debounce, noise filter (node_modules/.git/dist). `skills-watcher.ts`: Watches `.agents/skills/` for SKILL.md changes. `file-change-buffer.ts`: Producer-consumer buffer (100 event cap) bridging event-driven watcher and polling-driven Agent Loop. |
| Sandbox | `src/sandbox/` | macOS: `sandbox-exec` with Seatbelt SBPL policy (whitelist: allow read system+project, allow write node_modules/.git/dist/tmp/chitu-data + /tmp, deny network). Linux: Docker interface reserved. Policy written to temp file (-f flag), cleaned up after execution. |
| CLI | `src/cli/index.ts` | Terminal interface using `readline/promises`. In-process architecture (no JSON-RPC). Interactive prompt, streaming output, inline approval, SIGINT graceful exit. |
| Upload | `src/upload/index.ts` | Image upload via HTTP POST (multipart/form-data or application/octet-stream). Saves to `chitu-data/uploads/`. Static file serving with path traversal protection. MIME type validation, 10MB limit. |
| Utils | `src/utils/` | `shell.ts`: Auto-detect user shell (SHELL env → platform default → /bin/sh). `env-diff.ts`: Environment snapshot + diff for inter-turn delta injection. `truncate.ts`: Tool output truncation. |
| Rollout Recorder | `src/rollout/recorder.ts` | JSONL event stream for audit/debug replay, stored in `chitu-data/rollouts/`. |
| Command Policy | `src/tools/policy.ts` | Classifies commands as read/write/dangerous for approval flow. |
| VS Code Extension | `vscode-extension/` | Independent subproject. WebSocket JSON-RPC client connecting to App Server. `extension.ts` (activation), `client.ts` (auto-reconnect JSON-RPC), `chat-provider.ts` (sidebar WebView Chat UI), `diff-provider.ts` (inline diff preview). 4 commands, 3 keybindings, 3 config options. |

### Frontend (`web-ui/`)

React 19 + Vite 8 + TailwindCSS 4 + Zustand 5. Singleton WebSocket hook (`useChituSocket.ts`) — do not create multiple connections.

Key components:
- `ChatInput.tsx` — Message input with image upload (file picker + paste), auto-approve toggle, review mode toggle
- `MessageItem.tsx` — Message rendering with `MessageImages` component for inline image preview + lightbox
- `DashboardPage.tsx` — Monitoring dashboard with server info, metrics, milestone progress, activity feed
- `PlanPanel.tsx` — Real-time plan/milestone progress display

## Coding Conventions

- **TypeScript + ESM** with `"type": "module"`. Import paths use `.js` suffix.
- **LLM**: GLM-5 via 智谱AI. Requires `ZHIPU_API_KEY` env var. Endpoint configurable via `ZHIPU_CODING_ENDPOINT`.
- **Database**: Neon PostgreSQL via `NEON_DATABASE_URL`. Falls back to JSON files if DB unavailable. Migrations are idempotent (`IF NOT EXISTS`).
- **Types in `src/types.ts`**: Do not modify `AppEvent` type — it aligns with the Codex protocol.
- **Tool interface**: All tools follow `Tool` interface in `src/tools/base.ts`. New tools should be implemented as plugins (see `src/tools/plugins/`) implementing the `Plugin` interface from `src/tools/plugin-types.ts`.
- **Plugin structure**: Each plugin in `src/tools/plugins/` groups related tools with metadata (name, version, category) and optional lifecycle hooks. Register via `PluginLoader.register()`.
- **System prompt**: Built in `buildSystemPrompt()` in `src/agent/loop.ts`. Instructions are Codex-aligned with Chinese responses.
- **Tool output truncation**: Tool results are truncated before being added to message history to prevent context overflow.
- **Context window**: Messages are compacted when exceeding 80K tokens. System prompt + AGENTS.md are re-injected after compaction.
- **Data persistence**: Threads in `chitu-data/threads/` (JSON) + PG. Rollouts as JSONL in `chitu-data/rollouts/`. Memories in `chitu-data/memories/` + PG. Uploads in `chitu-data/uploads/`.
- **Auth**: Zero external deps. Passwords hashed with `crypto.scryptSync`. JWT uses HMAC-SHA256. API Key auth uses `crypto.timingSafeEqual`.
- **Sandbox**: macOS uses `sandbox-exec` with `-f` flag (policy from file, not inline). Degradation on failure: direct execution.
- **Hooks config**: Shell commands configured per event point, receive JSON on stdin, return JSON on stdout. See `src/hooks/types.ts` for input/output schemas.
- **Source comments**: Each module has a JSDoc header explaining purpose and learning focus (学习重点), since this is an educational project.
- **Multimodal**: Images uploaded via HTTP POST, stored in `chitu-data/uploads/`. `ContentPart[]` type supports text + image_url. Agent Loop replaces last user message content with multimodal content when images are present.

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

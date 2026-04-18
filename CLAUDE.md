# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chitu (赤兔) is a minimal, educational AI Agent system built from scratch, architecturally aligned with OpenAI Codex. It uses GLM-5 (智谱AI) with function calling to implement an autonomous coding agent. The system has a WebSocket backend (Node.js/TypeScript) and a React frontend (Discord-style chat UI).

## Development Commands

```bash
# Backend (hot reload)
npm run dev                              # tsx watch src/main.ts

# Backend (no reload)
npx tsx src/start-server.ts              # Start WebSocket server (port 8080)

# Frontend
cd web-ui && npm run dev                 # Start Vite dev server (port 3000)
cd web-ui && npm run lint                # ESLint

# Build
npm run build                            # TypeScript compile (tsc)

# Tests — backend (Node built-in test runner, no framework)
npm test                                 # node --experimental-vm-modules --test tests/
# Single test file:
node --experimental-vm-modules --test src/test-agent-loop.ts

# E2E Tests (Playwright, requires frontend running on port 3000)
npx playwright test                      # Run all e2e tests
npx playwright test e2e/plan.spec.ts     # Single e2e test
```

## Architecture

The system follows a 4-layer architecture aligned with Codex:

```
Transport (WebSocket/JSON-RPC)
  → Message Processor (JSON-RPC ↔ ThreadManager translation)
    → Thread Manager (create/resume/runTurn/fork)
      → Agent Loop (while loop: LLM → tool_calls → execute → repeat)
```

### Key Data Model (`src/types.ts`)

- **Thread** = complete conversation (multi-turn), persisted as JSON in `chitu-data/threads/`
- **Turn** = one round of conversation (a multi-step task)
- **Item** = a single step (user_message, assistant_message, tool_call, tool_result)
- **AppEvent** = event protocol aligned with Codex (thread/started, turn/started, item/started, item/completed, item/delta, etc.)

### Core Modules

| Module | Path | Purpose |
|--------|------|---------|
| Agent Loop | `src/agent/loop.ts` | While loop: LLM call → check for tool_calls → execute tools → repeat until text-only response or max iterations. Builds system prompt via `buildSystemPrompt()`. |
| Context Builder | `src/context.ts` | Hierarchical AGENTS.md loading (root→CWD, respecting override precedence), environment context, skills injection. |
| LLM Client | `src/llm/client.ts` | GLM-5 API client with streaming SSE support. Only module that talks to the LLM. |
| Tool System | `src/tools/` | Plugin-based via `PluginLoader`. `Plugin` groups one or more `Tool` instances with lifecycle hooks (`onLoad`/`onUnload`/`onError`). Dependencies resolved by topological sort. |
| Thread Manager | `src/thread/manager.ts` | Orchestrates threads, runs Agent Loop via `runTurn()`, emits events, handles streaming items. |
| Context Compaction | `src/agent/compact.ts` | Summarizes message history when it exceeds 80K tokens, preserving recent context and re-injecting system prompt. |
| Hooks | `src/hooks/` | 5 event points: `pre_tool_use` (can block/modify), `post_tool_use` (can modify output), `session_start`, `user_prompt_submit` (can modify prompt), `session_end`. Shell commands with JSON stdin/stdout. |
| Memories | `src/memories/` | Extracts learnings from completed turns and injects into future conversations. Stored in `chitu-data/memories/`. |
| Skills | `src/skills/` | Skills loading system for injecting specialized capabilities into agent context. |
| Rollout Recorder | `src/rollout/recorder.ts` | JSONL event stream for audit/debug replay, stored in `chitu-data/rollouts/`. |
| Command Policy | `src/tools/policy.ts` | Classifies commands as read/write/dangerous for approval flow. |
| WebSocket Server | `src/server/` | JSON-RPC 2.0 over WebSocket. `index.ts` (transport + HTTP endpoints) → `message-processor.ts` (protocol translation) → `json-rpc.ts` (parsing). HTTP endpoints: `/status` (runtime metrics), `/dashboard` (aggregated status + milestones + rollout events). |
| Monitoring Dashboard | `web-ui/src/components/DashboardPage.tsx` | Discord-style monitoring page with panels for server info, metrics, milestone progress, milestone list, activity feed. Accessible via Activity icon in sidebar. References https://github.com/joeynyc/hermes-hudui for future enhancements (M20). |

### Frontend (`web-ui/`)

React 19 + Vite 8 + TailwindCSS 4 + Zustand 5. Uses a singleton WebSocket hook (`useChituSocket.ts`). Do not create multiple WebSocket connections. Dev server runs on port 3000.

## Coding Conventions

- **TypeScript + ESM** with `"type": "module"`. Import paths use `.js` suffix.
- **LLM**: GLM-5 via 智谱AI. Requires `ZHIPU_API_KEY` env var. Endpoint configurable via `ZHIPU_CODING_ENDPOINT`.
- **Types in `src/types.ts`**: Do not modify `AppEvent` type — it aligns with the Codex protocol.
- **Tool interface**: All tools follow `Tool` interface in `src/tools/base.ts`. New tools should be implemented as plugins (see `src/tools/plugins/`) implementing the `Plugin` interface from `src/tools/plugin-types.ts`.
- **Plugin structure**: Each plugin in `src/tools/plugins/` groups related tools with metadata (name, version, category) and optional lifecycle hooks. Register via `PluginLoader.register()`.
- **System prompt**: Built in `buildSystemPrompt()` in `src/agent/loop.ts`. Instructions are Codex-aligned with Chinese responses.
- **Tool output truncation**: Tool results are truncated before being added to message history to prevent context overflow.
- **Context window**: Messages are compacted when exceeding 80K tokens. System prompt + AGENTS.md are re-injected after compaction.
- **Data persistence**: Threads stored as JSON in `chitu-data/threads/`. Rollouts as JSONL in `chitu-data/rollouts/`. Memories in `chitu-data/memories/`.
- **Hooks config**: Shell commands configured per event point, receive JSON on stdin, return JSON on stdout. See `src/hooks/types.ts` for input/output schemas.

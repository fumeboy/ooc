# OOC-3

OOC (Object Oriented Context) 第 3 代实现——把 OOC Agent 与 Context Window 归一为同一个 OOC Object 概念。

## 当前状态

**spec V2 P1–P10 全部落地。** 285 unit tests pass, 4 real-LLM e2e 场景覆盖 (skip if no API key)。

## 架构概要

- **OOC Object**: 唯一核心概念。Agent 和 ContextWindow 都是 Object。
- **三层持久层**: `stones/`（身份/设计）/ `pools/`（累积产物）/ `flows/`（运行时 session）
- **ooc:// URI**: 1:1 镜像文件系统路径，无映射层。
- **prototype 链**: `extends:` 字段在 registry 内存中解析；method dispatch 走 `findInChain()`。
- **HTTP 控制面**: `POST /api/talk` / `GET /api/health` / `GET /api/objects` (Elysia)
- **web 控制面骨架**: `web/src/uri-resolver.ts` + `web/src/render-spec.ts`（纯 TS，无 React 依赖）
- **super flow**: `promoteEphemeral()` fork ephemeral Object 设计部分到 stones/（原 flows/ 保留）

## Harness

9 个 Agent Object 已落在 `stones/main/objects/`：
- `agent_of_thinkable` / `agent_of_executable` / `agent_of_collaborable` / `agent_of_observable`
- `agent_of_persistable` / `agent_of_reflectable` / `agent_of_programmable` / `agent_of_visible`
- `agent_of_experience`（体验官）

> **Note:** AgentOfX stones (`agent_of_*`) are source-tree harness artifacts. They are loaded into
> the registry at server startup alongside other `stones/main/objects/` entries, and are visible via
> `GET /api/stones?branch=main`. They are not hidden from the API — they live in the same `stones/main`
> branch as any other persistent object.

## 文档

| 文件 | 内容 |
|------|------|
| `docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md` | spec V2 全文 |
| `docs/solutions/ooc-3-rebuild-learnings.md` | 重建 journey、drifts、gate 验证 |
| `meta/object.doc.ts` | OOC 概念权威（8 维度定义） |
| `meta/engineering.harness.doc.ts` | Harness 组织结构 |

## 与 ooc-2 的关系

`ooc-3` 是从空起步的 from-scratch 重建，不是 ooc-2 的 refactor。ooc-2 保留为 legacy reference。

## 启动 / Dev Workflow

### Backend only

```bash
# Start HTTP server on port 3000, world at ./.ooc-world
bun src/app/server/index.ts --world ./.ooc-world
# or via npm script:
bun run server
# custom port / branch:
bun src/app/server/index.ts --world ./.ooc-world --port 3000 --stones-branch main
```

Health check: `curl http://localhost:3000/api/health`

### Backend + Frontend dev (full stack)

```bash
# Start both backend and vite dev server together:
bash scripts/dev-start.sh
# Custom world/port:
bash scripts/dev-start.sh --world ./.ooc-world --port 3000 --vite-port 5173
# UI: http://localhost:5173
# API: http://localhost:3000/api/health

# Or start separately:
bun src/app/server/index.ts --world ./.ooc-world --port 3000
# in another terminal:
cd web && OOC_API_TARGET=http://localhost:3000 bunx vite --port 5173
```

### Tests

```bash
# Unit tests
bun test

# Real-LLM backend e2e (requires API key in .env)
bun run test:e2e:backend

# Frontend Playwright e2e (requires backend + vite running; requires API key)
RUN_FRONTEND_E2E=1 bunx playwright test --config tests/e2e/frontend/playwright.config.ts
```

### Environment

Copy `.env` and set:
- `OOC_API_KEY` — API key for Claude (or set `ANTHROPIC_API_KEY`)
- `OOC_BASE_URL` — Claude proxy URL (optional; defaults to Anthropic direct)
- `OOC_MODEL` — model name (default: `claude-opus-4-7`)

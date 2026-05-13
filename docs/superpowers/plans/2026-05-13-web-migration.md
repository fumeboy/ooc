# Web Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 初始化独立 `web/` React/Vite 控制面，并在 `src/app/server` 增加最小只读 UI API，让用户能浏览 flows/stones、创建/继续 root thread chat、查看 world 文本文件。

**Architecture:** 服务端新增 `modules/ui`，只负责 `GET /api/flows`、`GET /api/tree`、`GET /api/tree/file`，继续复用现有 stones/flows/runtime API 执行写入和 chat。前端采用 `app + domains + transport + shared` 边界，复用旧 Web 的 Logo/FileTree/三栏视觉基调，但不迁移旧 FlowData、SSE、Kanban、Command Palette 等复杂能力。

**Tech Stack:** Bun, TypeScript, Elysia, React, Vite, CSS variables, current OOC app server APIs.

---

## File Structure

### Create

- `src/app/server/modules/ui/model.ts` - tree scope/query schemas and response types.
- `src/app/server/modules/ui/service.ts` - secure world file traversal, flow session listing, text file reads.
- `src/app/server/modules/ui/api.list-flows.ts` - `GET /api/flows` route.
- `src/app/server/modules/ui/api.get-tree.ts` - `GET /api/tree` route.
- `src/app/server/modules/ui/api.get-file.ts` - `GET /api/tree/file` route.
- `src/app/server/modules/ui/index.ts` - module assembly.
- `web/index.html`, `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts` - independent frontend scaffold.
- `web/src/**` - minimal app/domain/transport/shared React implementation described by the spec.
- `meta/app/web/index.doc.js` - app web meta documentation.

### Modify

- `src/app/server/index.ts` - register `uiModule(config)` before `flowsModule(config)` so `GET /api/flows` coexists with `POST /api/flows/`.
- `src/app/server/__tests__/server.routes.test.ts` - add route coverage for list flows, tree, file, missing file, and traversal rejection.
- `meta/app/index.doc.js` - add `web` beside `server` in app tree.

---

### Task 1: Add UI API tests first

**Files:**
- Modify: `src/app/server/__tests__/server.routes.test.ts`

- [ ] **Step 1: Add failing route tests**

Add tests that create temp world files through `node:fs/promises`, then assert:

```ts
const flows = await app.handle(new Request("http://localhost/api/flows"));
expect(flows.status).toBe(200);
expect((await flows.json()).items[0].sessionId).toBe("web-session");

const tree = await app.handle(new Request("http://localhost/api/tree?scope=flows"));
expect(tree.status).toBe(200);
expect((await tree.json()).children[0].marker).toBe("flow");

const file = await app.handle(new Request("http://localhost/api/tree/file?path=flows/web-session/notes.txt"));
expect(file.status).toBe(200);
expect((await file.json()).content).toBe("hello web");

const missing = await app.handle(new Request("http://localhost/api/tree/file?path=missing.txt"));
expect(missing.status).toBe(404);

const escape = await app.handle(new Request("http://localhost/api/tree/file?path=../escape.txt"));
expect(escape.status).toBe(400);
```

- [ ] **Step 2: Run failing tests**

Run: `bun test src/app/server/__tests__/server.routes.test.ts`

Expected: route tests fail because `/api/flows`, `/api/tree`, and `/api/tree/file` are not registered yet.

---

### Task 2: Implement UI API module

**Files:**
- Create: `src/app/server/modules/ui/model.ts`
- Create: `src/app/server/modules/ui/service.ts`
- Create: `src/app/server/modules/ui/api.list-flows.ts`
- Create: `src/app/server/modules/ui/api.get-tree.ts`
- Create: `src/app/server/modules/ui/api.get-file.ts`
- Create: `src/app/server/modules/ui/index.ts`
- Modify: `src/app/server/index.ts`

- [ ] **Step 1: Define route schemas**

Create `model.ts` with `treeQuery = t.Object({ scope: t.Union([...]), path: t.Optional(t.String()) })` and `fileQuery = t.Object({ path: t.String() })`.

- [ ] **Step 2: Implement service safety helpers**

`service.ts` must resolve paths under `baseDir`, reject absolute or `..` paths with `AppServerError("INVALID_INPUT", ...)`, return `AppServerError("NOT_FOUND", ...)` for missing files, and ignore binary preview support.

- [ ] **Step 3: Implement three routes**

Routes call `service.listFlows()`, `service.getTree(query)`, `service.getFile(query.path)` and return service results directly.

- [ ] **Step 4: Register module**

Import `uiModule` in `src/app/server/index.ts` and add `.use(uiModule(config))` before `.use(flowsModule(config))`.

- [ ] **Step 5: Run server route tests**

Run: `bun test src/app/server/__tests__/server.routes.test.ts`

Expected: all route tests pass.

---

### Task 3: Scaffold independent web app

**Files:**
- Create: `web/index.html`
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/src/main.tsx`
- Create: `web/src/styles.css`

- [ ] **Step 1: Add Vite React scaffold**

Use scripts: `dev`, `build`, `preview`; configure Vite proxy `/api -> http://127.0.0.1:3000`.

- [ ] **Step 2: Add base styles**

Copy the old Web theme tokens and panel utilities into `styles.css`, but keep plain CSS so the first build does not depend on Tailwind.

- [ ] **Step 3: Build smoke check**

Run: `cd web && bun install && bun run build`

Expected: initial shell compiles.

---

### Task 4: Build transport and domain queries

**Files:**
- Create: `web/src/transport/http.ts`
- Create: `web/src/transport/endpoints.ts`
- Create: `web/src/transport/errors.ts`
- Create: `web/src/domains/files/model.ts`, `query.ts`, `formatter.ts`
- Create: `web/src/domains/flows/model.ts`, `query.ts`, `adapter.ts`
- Create: `web/src/domains/stones/model.ts`, `query.ts`, `adapter.ts`
- Create: `web/src/domains/sessions/model.ts`, `query.ts`, `policy.ts`
- Create: `web/src/domains/chat/model.ts`, `query.ts`, `policy.ts`, `formatter.ts`

- [ ] **Step 1: Add typed HTTP helper**

`requestJson<T>()` centralizes fetch, JSON parsing, and `{ error: { code, message } }` mapping into `HttpError`.

- [ ] **Step 2: Add query wrappers**

Queries cover stones, flows, tree, file, create session, create object, get thread, continue thread, and poll job.

- [ ] **Step 3: Add simple policies**

Session IDs use `web-${Date.now()}` when the user leaves the ID blank. Default object is the first stone in the list.

---

### Task 5: Build UI shell and components

**Files:**
- Create: `web/src/app/index.tsx`, `shell.tsx`, `state.ts`, `routes.ts`
- Create: `web/src/app/layout/AppLayout.tsx`, `Sidebar.tsx`, `MainPanel.tsx`, `RightPanel.tsx`
- Create: `web/src/shared/brand/OocLogo.tsx`, `MainLogo.tsx`
- Create: `web/src/shared/ui/Button.tsx`, `EmptyState.tsx`, `Loading.tsx`, `MarkdownContent.tsx`
- Create: domain components listed in the design under `web/src/domains/**/components/`

- [ ] **Step 1: Copy and simplify visual assets**

Move old `OocLogo` shape into `shared/brand/OocLogo.tsx`; create a static `MainLogo` without old debug/pause/SSE state.

- [ ] **Step 2: Implement sidebar**

Sidebar shows tabs for flows/stones/world, session list, tree, and session creation form.

- [ ] **Step 3: Implement main panel**

Main panel shows welcome state, selected file content, JSON pretty print, Markdown rendering, and plain text fallback.

- [ ] **Step 4: Implement chat panel**

Right panel displays root thread inbox/events and composer actions for create + continue chat.

- [ ] **Step 5: Run web build**

Run: `cd web && bun run build`

Expected: TypeScript and Vite build pass.

---

### Task 6: Add meta documentation mapping

**Files:**
- Create: `meta/app/web/index.doc.js`
- Modify: `meta/app/index.doc.js`

- [ ] **Step 1: Create web meta doc**

Document Web as an app-layer browsing/manual-operation entrance that does not own core state and only covers the minimum control loop.

- [ ] **Step 2: Link app tree**

Import the web doc in `meta/app/index.doc.js` and expose it beside `server`.

- [ ] **Step 3: Run root tests**

Run: `bun test src/app/server`

Expected: server tests pass.

---

### Task 7: Final verification

- [ ] **Step 1: Server verification**

Run: `bun test src/app/server`


- [ ] **Step 2: Web verification**

Run: `cd web && bun install && bun run build`

- [ ] **Step 3: Inspect git diff**

Run: `git status --short && git diff --stat`

Expected: changes are limited to plan/spec-related web migration implementation files.

---

## Self-Review

- Spec coverage: covers new `web/`, `src/app/server/modules/ui`, existing API reuse, meta docs, and build/test verification.
- Placeholder scan: no TBD/TODO placeholders are required to execute the plan.
- Type consistency: server route names match the design (`GET /api/flows`, `GET /api/tree`, `GET /api/tree/file`); frontend domains match the requested app/domains/transport/shared split.

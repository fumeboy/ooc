# ooc-2 → ooc-3 Web Migration Map

Generated: 2026-05-30. Source of truth: read of both codebases in full.

---

## 1. ooc-2 Web Component Inventory

### 1.1 File count

Total: **107 TypeScript/TSX files** in `web/src/`.

Domain breakdown:
- `app/` — 10 files (shell, state, routing, routes, layout)
- `domains/chat/` — 8 files
- `domains/sessions/` — 29 files (largest single domain)
- `domains/stones/` — 7 files
- `domains/files/` — 12 files
- `domains/flows/` — 6 files
- `domains/objects/` — 4 files
- `domains/clients/` — 3 files
- `shared/ui/` — 12 files
- `shared/brand/` — 2 files
- `transport/` — 3 files

### 1.2 Component tree

```
App (main.tsx)
└── RouterProvider (react-router v7)
    └── AppShell (shell.tsx)          ← single shell, URL is source of truth
        ├── Sidebar
        │   ├── MainLogo
        │   ├── tab buttons (flows/stones/world/pools)
        │   ├── SessionList            ← date-grouped, _test_ toggle
        │   └── FileTree               ← scoped to active tree scope
        ├── MainPanel
        │   ├── Welcome                ← SessionCreator form
        │   ├── FileViewer             ← ContextSnapshotViewer + editable file
        │   ├── UserThreadHome         ← user.root thread + quick-access
        │   ├── SessionThreadsIndex    ← StaffView (five-line-staff grid)
        │   ├── ThreadDetailTabs       ← Context Snapshot + Loop Timeline tabs
        │   └── ClientWithSourceToggle ← stone/flow object client renderer
        └── RightPanel (optional)
            ├── header (displayName + pause + Network + LayoutMode)
            ├── ChatPanel
            │   ├── ThreadTimeline     ← formatThread() → TuiBlock[]
            │   └── ChatComposer
            └── footer (thread status pill + pause button)
```

### 1.3 Data flow: user message → UI update

```
User types in ChatComposer
  → onSend(text) in AppShell.handleSend
  → continueThread(sessionId, text)         POST /api/flows/:sid/continue
  → await waitForJob(result.jobId, fetchJob)  GET /api/runtime/jobs/:id (polling)
  → fetchThread(sessionId, objectId, tid)    GET /api/flows/:sid/objects/:oid/threads/:tid
  → fetchSessionThreads(sessionId)           GET /api/flows/:sid/threads
  → setState({ thread, sessionThreads })
  → ThreadTimeline re-renders with new ThreadContext
      → formatThread(thread) → ChatLine[]
      → TuiBlock per line
```

Parallel: AppShell has a 4-second polling interval (`setInterval`) that polls
`fetchThread` + `fetchFlows` whenever a session is active (shell.tsx:207-235).

### 1.4 Routing model

URL = navigation source. AppShell has zero navigate-state for active session/object/thread — all derived from URL via `useRouteState()` + `parseRoute()`.

Route shapes (routing.ts):
- `/` or `/welcome` → `{ kind: "welcome" }`
- `/flows/index?sessionId=&objectId=&threadId=` → `{ kind: "flowsView", view: "index" }`
- `/flows/thread_context?sessionId=&objectId=&threadId=` → `{ kind: "flowsView", view: "thread_context" }`
- `/stones/:objectId` → `{ kind: "stoneClient", objectId }`
- `/flows/:sid/objects/:oid/pages/:page` → `{ kind: "flowPage" }`
- `/files/*` → `{ kind: "file", path }`
- `/world`, `/stones`, `/flows`, `/pools` → `{ kind: "scope" }`

### 1.5 Key ooc-2 data models (frontend)

**ThreadContext** (`domains/chat/model.ts`):
```typescript
{
  id: string;
  status?: string;
  creatorObjectId?: string;
  inbox?: ThreadMessage[];           // messages sent to this thread
  outbox?: ThreadMessage[];          // messages sent from this thread
  events?: unknown[];                // raw LLM trace events (the big array)
  contextWindows?: ContextWindow[];  // window tree (root/talk/do/file/knowledge/etc)
  hash?: string;                     // content hash for polling change detection
}
```
`events[]` is the primary source for `formatThread()` → `ChatLine[]`. Event
categories: `context_change`, `llm_interaction`, `tool_runtime`, `permission`.

**FlowSession** (`domains/flows/model.ts`):
```typescript
{ sessionId, title, dir, createdAt, updatedAt, paused? }
```

**Stone** (`domains/stones/model.ts`):
```typescript
{ objectId, dir }
```

**ListThreadsItem** (`domains/sessions/types.ts`):
```typescript
{
  objectId, threadId,
  status?, createdAt?, parentThreadId?, creatorObjectId?,
  childThreadIds?, talkPeers?, shares?, isSuperFlow?, title?
}
```

---

## 2. ooc-3 Backend Endpoint Surface

### 2.1 Current endpoint table (http.ts)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check, returns `{ ok, worldRoot }` |
| GET | `/api/world` | World config: `{ ok, worldRoot, branch }` |
| GET | `/api/sessions` | List all sessions: `{ ok, sessions: [{sessionId, createdAt?, threadCount}] }` |
| POST | `/api/sessions` | Create session (body: `{ objectUri, sessionId?, initPrompt?, systemPrompt?, maxTicks? }`), **sync** — blocks until initPrompt thread done |
| GET | `/api/sessions/:sessionId` | Session snapshot: `{ ok, sessionId, threads: [{id, objectUri, status, ticks, maxTicks, lastError, messageCount}] }` |
| GET | `/api/threads/:threadId` | Single thread by ID: `{ ok, thread: ThinkThread }` |
| POST | `/api/sessions/:sessionId/invoke` | Direct method invoke, no LLM (body: `{ objectUri, method, args? }`) |
| GET | `/api/stones` | List stones (query `?branch=main`): `{ ok, branch, stones: [{uri, name, title?, kind}] }` |
| GET | `/api/stones/:branch/:name` | Stone detail: `{ ok, uri, name, branch, paths, self, readme, hasServer, hasClient }` |
| GET | `/api/stones/:branch/:name/self` | self.md: `{ ok, content }` |
| GET | `/api/stones/:branch/:name/readme` | readme.md: `{ ok, content }` |
| GET | `/api/stones/:branch/:name/server-source` | server/index.ts: `{ ok, content }` |
| POST | `/api/stones/:branch/:name/call-method` | Call stone method (body: `{ method, args?, sessionId? }`) |
| GET | `/api/flows/:sessionId/objects` | List session objects: `{ ok, sessionId, objects: [{name, uri, kind}] }` |
| GET | `/api/flows/:sessionId/objects/:objectName` | Object detail: `{ ok, ..., plan, todos, talks, threadIds, activeThreads }` |
| GET | `/api/flows/:sessionId/objects/:objectName/threads/:threadId` | Thread detail: `{ ok, source: "memory"/"disk", thread: ThinkThread }` |
| GET | `/api/tree` | File tree (query `?path=`): `{ ok, path, entries: [{name, type}] }` — non-recursive |
| GET | `/api/file/read` | File content (query `?path=`): `{ ok, content, bytes, truncated }` |
| GET | `/api/objects/:scope/:name/client-source-url` | Client source `/@fs/` URL: `{ ok, url }` |
| POST | `/api/talk` | Sync user→target talk: `{ ok, sessionId, threadId, response, threadStatus }` — **blocks until LLM done** |

### 2.2 ooc-3 data models

**ThinkThread** (`src/thinkable/think-thread.ts`):
```typescript
{
  id: string;
  sessionId: string;
  objectUri: string;           // e.g. "ooc://stones/main/objects/root"
  messages: LlmInputItem[];    // full LLM conversation history
  status: "running" | "done" | "failed" | "paused";
  maxTicks: number;
  ticks: number;
  llmTimeoutMs?: number;
  lastError?: string;
}
```

**LlmInputItem** (`src/thinkable/llm/types.ts`):
```typescript
| { type: "message"; role: "system"|"user"|"assistant"; content: string }
| { type: "function_call"; call_id: string; name: string; arguments: Record<string,unknown> }
| { type: "function_call_output"; call_id: string; name?: string; output: string }
| { type: "reasoning"; text: string }
```

**Worker**: in-memory queue (`Map<threadId, ThinkThread>`). No job IDs. No
async job model. `/api/talk` calls `worker.runUntilThread()` and blocks the
HTTP response until thread completion (up to `maxTicks × llmTimeoutMs + 30s`).

**Disk layout**:
```
flows/<sessionId>/
  .session.json                   { createdAt, objectUri }
  objects/<objectName>/
    threads/<threadId>/
      thread.json                 ThinkThread snapshot (atomic write)
    plan.md
    todos.json
    talks/<peer-slug>.jsonl       { ts, direction: "in"|"out", peer, content }
```

No `contextWindows`. No `events[]`. No `inbox/outbox` in thread. No `hash` field.
No pause/resume support. No per-session job tracking.

---

## 3. Endpoint Migration Table

| ooc-2 endpoint | purpose | ooc-3 equivalent | status |
|---|---|---|---|
| `GET /api/health` | health check | `GET /api/health` | **DIRECT** — same |
| `GET /api/world/config` | world config | `GET /api/world` | **ADAPT** — path changes, shape similar |
| `GET /api/flows` | list sessions with title/paused/createdAt/updatedAt/hash | `GET /api/sessions` | **ADAPT** — ooc-3 shape minimal: no title, no paused, no updatedAt, no hash |
| `POST /api/sessions` | seed session + user.root + talk_window + first message → returns jobId | `POST /api/sessions` | **ADAPT** — ooc-3 sync (blocks), no jobId returned, different body schema |
| `POST /api/flows/:sid/continue` | send user reply to session → returns jobId | N/A — use `/api/talk` | **ADAPT** — ooc-3 sync, no separate job concept |
| `GET /api/runtime/jobs/:jobId` | poll job status | N/A | **BACKEND-ADD** — ooc-3 has no async job layer |
| `GET /api/flows/:sid/threads` | list all (objectId, threadId) with full metadata | N/A | **BACKEND-ADD** — ooc-3 has `GET /api/sessions/:sid` (thread list minimal) + `GET /api/flows/:sid/objects` |
| `GET /api/flows/:sid/objects/:oid/threads/:tid` | get ThreadContext (events, contextWindows, inbox, outbox, hash) | `GET /api/flows/:sid/objects/:oid/threads/:tid` | **ADAPT** — ooc-3 returns `ThinkThread` (messages[], not events[]); shape mismatch is the biggest adaptation |
| `POST /api/flows/:sid/pause` | pause session | N/A | **BACKEND-ADD** — pause-store.ts is STUB |
| `POST /api/flows/:sid/resume` | resume session + returns jobIds | N/A | **BACKEND-ADD** — pause-store.ts is STUB |
| `POST /api/flows/:sid/talk-windows` | add talk window + optional first message | N/A | **BACKEND-ADD** — no equivalent |
| `GET /api/stones` | list stones: `[{ objectId, dir }]` | `GET /api/stones?branch=main` | **ADAPT** — ooc-3 shape is `[{ uri, name, title, kind }]`; no objectId field |
| `POST /api/stones` | create new stone | N/A | **BACKEND-ADD** |
| `GET /api/stones/:objectId/self` | self.md text | `GET /api/stones/:branch/:name/self` | **ADAPT** — path adds branch param; response field `text` vs `content` |
| `GET /api/stones/:objectId/readme` | readme.md | `GET /api/stones/:branch/:name/readme` | **ADAPT** — same as above |
| `GET /api/pools/:oid/knowledge/directories` | create knowledge directory | N/A | **BACKEND-ADD** — ooc-3 has no pool/knowledge concept |
| `POST /api/pools/:oid/knowledge/directories` | create knowledge directory | N/A | **BACKEND-ADD** |
| `POST /api/pools/:oid/knowledge/files` | create knowledge file | N/A | **BACKEND-ADD** |
| `PUT /api/pools/:oid/knowledge/files` | update knowledge file | N/A | **BACKEND-ADD** |
| `GET /api/tree?scope=&path=` | file tree (scoped: world/flows/stones/pools) | `GET /api/tree?path=` | **ADAPT** — ooc-3 does not understand scope param; only non-recursive; ooc-2 returns nested FileTreeNode; ooc-3 returns flat `entries[]` |
| `GET /api/tree/file?path=` | file content (ooc-2 path) | `GET /api/file/read?path=` | **ADAPT** — path changes; ooc-3 response has `truncated` flag |
| `GET /api/file/read?path=` | read any LLM-visible file | `GET /api/file/read?path=` | **DIRECT** |
| `GET /api/objects/stone/:oid/client-source-url` | client index.tsx /@fs/ URL for stone | `GET /api/objects/:scope/:name/client-source-url` | **ADAPT** — ooc-3 scope=branch name not "stone"/"flow" keyword |
| `GET /api/objects/flow/:oid/client-source-url?sessionId=&page=` | client page URL for flow object | N/A | **BACKEND-ADD** — not implemented in ooc-3 |
| `POST /api/flows/:sid/objects/` | create flow object | N/A | **BACKEND-ADD** |
| `GET /api/runtime/global-pause/status` | global pause state | N/A | **BACKEND-ADD** — pause-store stub |
| `POST /api/runtime/global-pause/enable` | enable global pause | N/A | **BACKEND-ADD** |
| `POST /api/runtime/global-pause/disable` | disable global pause | N/A | **BACKEND-ADD** |
| `GET /api/runtime/debug/status` | debug mode status | N/A | **BACKEND-ADD** — no debug file infrastructure in ooc-3 |
| `POST /api/runtime/debug/enable` | enable debug (loop file capture) | N/A | **BACKEND-ADD** |
| `POST /api/runtime/debug/disable` | disable debug | N/A | **BACKEND-ADD** |
| `GET /api/runtime/flows/:sid/objects/:oid/threads/:tid/debug/loops` | list loop debug files | N/A | **BACKEND-ADD** — requires loop file persistence in thinkloop |
| `GET /api/runtime/flows/:sid/objects/:oid/threads/:tid/debug/loops/:idx` | get single loop input/output/meta | N/A | **BACKEND-ADD** |
| `POST /api/runtime/flows/:sid/objects/:oid/threads/:tid/permission` | approve/reject HITL permission | N/A | **BACKEND-ADD** — no permission_ask event system in ooc-3 |
| `POST /api/stones/:oid/call_method` | call stone server method | `POST /api/stones/:branch/:name/call-method` | **ADAPT** — path restructure, same semantics |
| `POST /api/flows/:sid/objects/:oid/call_method` | call flow object method | `POST /api/sessions/:sid/invoke` | **ADAPT** — body schema differs |

---

## 4. Backend Additions Needed

### 4.1 Async Job Layer (MEDIUM)

ooc-2 flow: `POST /continue → { jobId }` then `GET /jobs/:jobId` until `done`.
ooc-3 flow: `POST /api/talk` blocks synchronously.

**Option A (ADAPT approach — recommended for migration)**: Wrap `/api/talk` in a thin
async job layer at the HTTP level. Submit to worker, return `{ jobId }` immediately,
expose `GET /api/runtime/jobs/:jobId`. Worker tick writes status to in-memory job store.
Feasibility: **MEDIUM** — requires a real `job-manager.ts` replacing the current stub.

**Option B (frontend adaptation)**: Rewrite frontend to tolerate sync `/api/talk`
response (show spinner, await full response, no polling). Loses real-time streaming
feel but drastically simpler. Feasibility: **TRIVIAL** — pure frontend change.

Recommended: Option B for Batch 1+2 (ship faster), Option A deferred to Batch 5.

Endpoints:
- `POST /api/flows/:sessionId/continue` — sync wrapper around `/api/talk` that matches ooc-2 body/response shape
- `GET /api/runtime/jobs/:jobId` — returns `{ status: "running"|"done"|"failed" }` (real job-manager OR stub returning "done" after sync wait)

### 4.2 Flows List with Rich Metadata (MEDIUM)

`GET /api/flows` in ooc-2 returns `{ items: FlowSession[], hash }` where each
session has `title`, `paused`, `createdAt (number)`, `updatedAt (number)`.

ooc-3 `GET /api/sessions` returns `{ sessions: [{sessionId, createdAt?: string, threadCount}] }`.

New endpoint needed (or extend existing):
```
GET /api/flows
Response: { items: [{sessionId, title?, paused?, createdAt, updatedAt}], hash }
```
Implementation: scan `flows/*/` directories, read `.session.json` for `createdAt`/title,
derive `updatedAt` from filesystem mtime of latest `thread.json`. Feasibility: **MEDIUM**.

### 4.3 Session Threads List with Full Metadata (MEDIUM)

`GET /api/flows/:sessionId/threads` in ooc-2 returns `ListThreadsItem[]` with
`status`, `talkPeers`, `shares`, `creatorObjectId`, etc.

ooc-3 has `GET /api/sessions/:sid` (threads from worker queue only) and
`GET /api/flows/:sid/objects` (objects list, no threads).

New endpoint:
```
GET /api/flows/:sessionId/threads
Response: { items: [{ objectId, threadId, status?, createdAt? }] }
```
Implementation: scan `flows/:sid/objects/*/threads/*/thread.json` directories.
Minimal shape (objectId + threadId) is sufficient for degraded mode. Full shape
(status, talkPeers) requires parsing thread.json + talks files. Feasibility: **MEDIUM**
for minimal, **HARD** for full (talkPeers requires parsing talks JSONL).

### 4.4 Session Seed (MEDIUM)

ooc-2 `POST /api/sessions` takes `{ sessionId, targetObjectId, initialMessage, title? }`
and returns `{ sessionId, userThreadId, talkWindowId, targetObjectId, targetThreadId, jobId }`.

ooc-3 `POST /api/sessions` takes `{ objectUri, sessionId?, initPrompt? }`.

New endpoint (or adapt existing):
```
POST /api/flows   (keep ooc-2 path to minimize frontend changes)
Body: { sessionId?, targetObjectId, initialMessage, title? }
Response: { sessionId, targetObjectId, targetThreadId, jobId? }
```
Can be a thin wrapper around `/api/talk` + session creation. Feasibility: **MEDIUM**.

### 4.5 Add Talk Window (MEDIUM)

`POST /api/flows/:sessionId/talk-windows` — attach new talk channel to existing session.
No ooc-3 equivalent. Requires the session's "user" context to be extended with a new
talk direction. Feasibility: **MEDIUM** (needs talk routing logic).

### 4.6 Pause / Resume (MEDIUM)

`pause-store.ts` in ooc-3 already has a full interface stub with correct semantics.
Just needs to be wired into the Worker tick loop to gate LLM calls, and exposed via HTTP:
```
POST /api/flows/:sessionId/pause   → { sessionId, paused: true }
POST /api/flows/:sessionId/resume  → { sessionId, paused: false, jobIds: [] }
```
Worker.tick already has `activeTick` guard — add `pauseStore.isSessionPaused()` check.
Feasibility: **MEDIUM** (2–3 hours of work).

### 4.7 Stone Management (TRIVIAL)

`POST /api/stones` — create stone. Just mkdir + write self.md + readme.md.
`GET /api/stones/:objectId/self` — ooc-3 uses `/api/stones/:branch/:name/self`.
Frontend can adapt to the new path, OR backend can add compat alias.
Feasibility: **TRIVIAL**.

### 4.8 Knowledge (pools) CRUD (MEDIUM)

`POST/PUT /api/pools/:oid/knowledge/files` etc. ooc-3 has no pool concept.
These are essentially file CRUD operations under a stone's knowledge directory.
Can be implemented as simple file operations without introducing the pool concept.
```
POST /api/stones/:name/knowledge/directories   { path }
POST /api/stones/:name/knowledge/files         { path, content? }
PUT  /api/stones/:name/knowledge/files         { path, content }
```
Feasibility: **MEDIUM** (need path-safety validation).

### 4.9 File Tree (recursive + scoped) (MEDIUM)

ooc-2 `GET /api/tree?scope=flows|stones|world|pools` returns a fully recursive
`FileTreeNode` tree with `children[]`. ooc-3 `GET /api/tree` returns a flat
non-recursive `entries[]` for a single directory level.

To support Sidebar FileTree:
```
GET /api/tree?scope=&path=
Response: { name, type, path, children? }  // recursive FileTreeNode compatible shape
```
Feasibility: **MEDIUM** (add recursion option + scope-to-path mapping).

### 4.10 Debug Loop Visualizer (HARD)

`GET /api/runtime/flows/:sid/objects/:oid/threads/:tid/debug/loops` requires
loop-level debug files (`loop_NNNN.{input,output,meta}.json`) to be written by
the thinkloop on each LLM call. ooc-3 thinkloop has no such instrumentation.

Required changes:
1. Add `debug-file.ts` to persistable layer (exists in ooc-2)
2. Instrument `think()` in thinkloop.ts to write debug files when enabled
3. Add debug enable/disable flag to Worker config + HTTP endpoints

Feasibility: **HARD** (architectural addition to thinkloop + Worker).

### 4.11 Permission / HITL System (HARD)

ooc-2 has `permission_ask` events that pause thread execution waiting for
approve/reject from the UI. ooc-3 thinkloop has no permission concept — it
runs tools directly without asking. This requires:
1. A permission-ask mechanism in the tool dispatch layer
2. Thread `status: "paused"` + HITL resume logic
3. Event storage in thread.events[]
4. HTTP endpoint for decision

Feasibility: **HARD** (significant thinkloop + worker architectural addition).

### 4.12 Feasibility Summary

| Addition | Feasibility |
|---|---|
| Async job layer (thin sync wrapper) | TRIVIAL |
| `/api/flows` rich sessions list | MEDIUM |
| `/api/flows/:sid/threads` session threads list (minimal) | MEDIUM |
| Session seed endpoint | MEDIUM |
| Add talk window | MEDIUM |
| Pause / resume | MEDIUM |
| Stone CRUD | TRIVIAL |
| Knowledge CRUD | MEDIUM |
| File tree recursive+scoped | MEDIUM |
| Flow object client-source-url | TRIVIAL |
| Debug loop visualizer | HARD |
| Permission / HITL | HARD |

---

## 5. Component Migration Batches

### Batch 1 — Foundation (no domain logic)

Goal: ooc-3 web can boot, route, and render layout with correct API calls.

Files to port/rewrite:
- `transport/http.ts` → adapt ooc-2's `requestJson` + `qs` helpers (ooc-3 already has `api.ts`; keep or unify)
- `transport/endpoints.ts` → new endpoint constants mapped to ooc-3 paths
- `transport/errors.ts` → `HttpError` class + `messageFromError`
- `shared/ui/*` — all 12 files: `Button`, `card`, `input`, `label`, `select`, `textarea`, `EmptyState`, `Loading`, `MarkdownContent`, `OocLink`, `oocText`, `oocUri`
- `shared/brand/*` — `MainLogo`, `OocLogo`
- `shared/ui/InlineUiContent.tsx` — renders `ooc://` URIs inline
- `shared/ui/ChatSendContext.tsx` — send context provider
- `shared/world-root.ts`
- `app/state.ts` — AppState type (adapt for ooc-3 models)
- `app/routing.ts` + `app/routes.tsx` — full ooc-2 routing model
- `app/layout/AppLayout.tsx` — three-column layout shell
- `app/layout/LayoutModeToggle.tsx` — two/three column toggle
- `app/layout/Sidebar.tsx` — tabs + FileTree + SessionList
- `app/layout/MainPanel.tsx` — main content area routing
- `app/layout/RightPanel.tsx` — right chat column
- `app/layout/ThreadHeader.tsx` — thread switcher header
- `app/layout/Welcome.tsx` — welcome + session creator
- `app/layout/threadDisplay.ts`
- `app/shell.tsx` — full AppShell (requires backend additions 4.2, 4.3 for full function; can start with stub data)

**Backend needed**: `/api/flows` (rich sessions list, 4.2), health, world config.

### Batch 2 — Core Chat (critical path)

Goal: User can send messages and see thread rendered in TUI style.

Files to port:
- `domains/chat/model.ts` — add ooc-3 message-model types alongside existing
- `domains/chat/formatter.ts` — NEW: ooc-3 message formatter (see §6)
- `domains/chat/policy.ts`
- `domains/chat/query.ts` — adapt `continueThread` → POST `/api/talk` (sync) or async wrapper
- `domains/chat/use-polling-thread.ts`
- `domains/chat/components/TuiBlock.tsx` — port with ooc-3 message model adaptation
- `domains/chat/components/ThreadTimeline.tsx` — port
- `domains/chat/components/ChatPanel.tsx` — port
- `domains/chat/components/ChatComposer.tsx` — port

**Backend needed**: `/api/flows/:sid/continue` (or adapt to `/api/talk`), thread
endpoint (4.1 job wrapper), `/api/flows/:sid/objects/:oid/threads/:tid`.

### Batch 3 — Sessions Domain (navigation)

Goal: Full session browsing, thread switching, SessionThreadsIndex StaffView.

Files to port:
- `domains/sessions/model.ts`
- `domains/sessions/types.ts` — ListThreadsItem, ListThreadsResponse
- `domains/sessions/query.ts`
- `domains/sessions/policy.ts`
- `domains/sessions/components/SessionList.tsx`
- `domains/sessions/components/SessionCreator.tsx`
- `domains/sessions/components/SessionThreadsIndex.tsx`
- `domains/sessions/components/ThreadDetailTabs.tsx`
- `domains/sessions/components/ThreadNode.tsx`
- `domains/sessions/components/UserThreadHome.tsx`
- `domains/sessions/components/session-threads-index.helpers.ts`
- `domains/objects/query.ts` — `useDisplayName`, `useDisplayNames`, `fetchSelfFirstLine`
- `domains/objects/model.ts`
- `app/layout/ThreadHeader.tsx`

**Backend needed**: `/api/flows/:sid/threads` (4.3), `/api/flows` (4.2),
stone self endpoint (ooc-3 path adaptation).

### Batch 4 — Stones / Files / World (secondary tabs)

Goal: Stone browsing, file tree, knowledge editing, object client renderer.

Files to port:
- `domains/stones/*` — 7 files
- `domains/files/*` — 12 files
- `domains/flows/*` — 6 files (adapter + query)
- `domains/clients/*` — 3 files (ClientWithSourceToggle, ObjectClientRenderer, StoneFallback)

**Backend needed**: Stone CRUD (4.7), Knowledge CRUD (4.8), File tree recursive+scoped (4.9),
flow object client-source-url (4.10).

### Batch 5 — Advanced Features (deferred, depends on backend work)

Goal: Loop visualizer, permission UI, pause/resume, full StaffView with relations.

Files to port:
- `domains/sessions/components/LoopTimeline.tsx`
- `domains/sessions/components/LoopNavigator.tsx`
- `domains/sessions/components/LoopMiniTimeline.tsx`
- `domains/sessions/components/LoopEventBadge.tsx`
- `domains/sessions/components/LoopActionPopover.tsx`
- `domains/sessions/components/LoopDiffView.tsx`
- `domains/sessions/components/loop-types.ts`
- `domains/sessions/components/window-diff-renderers/*` — 12 files
- `domains/sessions/components/WindowDiffRow.tsx`
- `domains/sessions/components/RelationOverlay.tsx`
- `domains/files/components/ContextSnapshotViewer.tsx`
- `domains/files/components/LLMInputJsonViewer.tsx`

**Backend needed**: Debug loop infrastructure (4.10, HARD), Permission/HITL (4.11, HARD),
Pause/Resume (4.6, MEDIUM).

---

## 6. Key Adaptation: Chat Timeline Window-Model → Message-Model

This is the **hardest single adaptation** in the migration.

### ooc-2 model

Thread data:
```typescript
ThreadContext.events = [
  { category: "context_change", kind: "inbox_message_arrived", msgId: "..." },
  { category: "llm_interaction", kind: "text", text: "Hello" },
  { category: "llm_interaction", kind: "function_call", toolName: "open", callId: "...", arguments: {...} },
  { category: "tool_runtime", kind: "function_call_output", callId: "...", output: "..." },
  { category: "permission", kind: "permission_ask", toolCallId: "...", command: "..." },
]
ThreadContext.contextWindows = [ { type: "talk", id: "w_1", target: "user", ... } ]
ThreadContext.inbox = [ { id, content, fromObjectId, createdAt, ... } ]
ThreadContext.outbox = [ { id, content, windowId, createdAt, ... } ]
```

`formatThread()` in `formatter.ts` converts this 569-line function into `ChatLine[]`.
It handles: inbox message lookup, outbound say detection (open+say tool merging),
callId-based pairing of function_call + function_call_output, permission cards,
thinking blocks, and consecutive open→refine→submit→close folding into followUps.

### ooc-3 model

Thread data:
```typescript
ThinkThread.messages = [
  { type: "message", role: "system", content: "..." },
  { type: "message", role: "user", content: "..." },
  { type: "function_call", call_id: "c1", name: "talk", arguments: { target: "...", content: "..." } },
  { type: "function_call_output", call_id: "c1", output: '{"ok":true}' },
  { type: "message", role: "assistant", content: "..." },
  { type: "reasoning", text: "..." },
]
```

No `events[]`. No `contextWindows`. No `inbox/outbox`. No OOC-specific window protocol.

### Adaptation strategy

**Write a new `formatOoc3Thread()` formatter** that converts `LlmInputItem[]` into the
same `ChatLine[]` type. This preserves TuiBlock rendering entirely.

Mapping:
```
LlmInputItem type="message", role="user"       → ChatLine { kind: "message", role: "user" }
LlmInputItem type="message", role="assistant"  → ChatLine { kind: "message", role: "assistant" }
LlmInputItem type="message", role="system"     → ChatLine { kind: "notice", tone: "info", title: "system" }
LlmInputItem type="function_call"              → ChatLine { kind: "tool", toolName: name, pending: no_output_yet }
LlmInputItem type="function_call_output"       → pair with preceding function_call by call_id
LlmInputItem type="reasoning"                 → ChatLine { kind: "notice", tone: "warning", title: "Thinking" }
```

Key differences from ooc-2 formatter:
1. **No window protocol**: ooc-3 tools are plain method names (talk, todo_add, plan_set,
   grep, open_file, write_file, exec_command, end, ...). The OOC-2 special-case logic
   for open/refine/submit/close windows does NOT apply.
2. **call_id pairing**: Same approach — pre-scan for function_call_output by call_id,
   pair with function_call. Already done in ooc-2 formatter, can reuse logic.
3. **No permission cards**: Permission system not in ooc-3 (Batch 5 deferred feature).
4. **No inbox/outbox merging**: No cross-object message threading in ooc-3 at this level.
5. **System messages visibility**: In ooc-3, system messages carry OOC context snapshots
   (`[OOC context snapshot]...[/OOC context snapshot]`). These should be rendered as
   collapsible notices (default collapsed), not as inline messages.

**Preserved from ooc-2**: TuiBlock component renders `ChatLine` regardless of source.
The visual style (tui-user, tui-assistant, tui-tool, tui-notice, tool cards, copy
buttons, expand/collapse) is fully reusable. Only the data-to-ChatLine conversion
layer changes.

**New formatter location**: `src/domains/chat/formatter-ooc3.ts` alongside existing
`formatter.ts`. The `ThreadTimeline` component receives either ooc-2 `ThreadContext` or
ooc-3 `ThinkThread`, passes to the appropriate formatter, gets `ChatLine[]`.

### Hash / polling

ooc-2 `ThreadContext.hash` lets polling skip re-renders when content unchanged.
ooc-3 `ThinkThread` has no hash field. Adaptation: compute a hash client-side
from `thread.ticks + thread.status + thread.messages.length`, or derive from the
last `function_call_output.output` timestamp. Simple `messages.length` comparison
is sufficient as a change detector for polling purposes.

---

## 7. Recommended Execution Order + Risk Notes

### Execution order

```
Phase 0 (backend prep, parallel with frontend):
  - Implement /api/flows (rich sessions list)
  - Implement /api/flows/:sid/threads (minimal shape)
  - Implement /api/flows/:sid/continue (sync talk wrapper)
  - Wire pause-store into Worker + expose pause/resume HTTP endpoints

Phase 1 — Batch 1 (foundation):
  Risk: LOW. Pure UI + transport. ooc-3 has a working skeleton to build on.
  Entry point: start with transport/ + shared/ui, then layout/ components.

Phase 2 — Batch 2 (core chat):
  Risk: MEDIUM. The formatter adaptation (§6) is the hardest single task.
  Strategy: write formatOoc3Thread() with unit tests first, then wire into
  ThreadTimeline → ChatPanel → RightPanel.
  Blocker: /api/flows/:sid/continue endpoint must be available.

Phase 3 — Batch 3 (sessions):
  Risk: MEDIUM. SessionThreadsIndex StaffView requires /api/flows/:sid/threads
  to return ListThreadsItem shape. Can degrade gracefully if backend returns
  minimal {objectId, threadId} — SessionThreadsIndex already handles this case
  (the `degraded` state + banner).

Phase 4 — Batch 4 (secondary tabs):
  Risk: LOW-MEDIUM. Stones mostly DIRECT/ADAPT. Files require tree-recursion
  backend fix. Knowledge CRUD is new but straightforward.

Phase 5 — Batch 5 (advanced, post-launch):
  Risk: HIGH. Debug loop visualizer and permission/HITL both require significant
  thinkloop + worker architectural additions.
  Decision: Ship without LoopTimeline tab initially — ThreadDetailTabs can show
  only "Context Snapshot" tab (degraded) until HARD backend work is done.
```

### Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| ooc-3 `/api/talk` sync blocks HTTP for entire LLM run time (up to minutes) | HIGH — UI hangs | Add thin async wrapper (job-manager) or use frontend timeout + polling |
| `formatOoc3Thread()` system message noise — ooc-3 injects large context snapshots as system messages | MEDIUM — clutters timeline | Default-collapse system messages in TuiBlock |
| ooc-3 stones path `/api/stones/:branch/:name` vs ooc-2 `/api/stones/:objectId` — branch param not known to frontend | MEDIUM — 404s | Hardcode `main` branch (same as ooc-2 did internally) |
| No `hash` field on ThinkThread — polling cannot skip no-op updates | LOW — extra renders | Use `messages.length + status` as synthetic change key |
| `ThreadContext.contextWindows` not in ooc-3 — context snapshot tab shows nothing | MEDIUM — visible blank tab | Derive display from `thread.messages` (system prompt content) OR hide tab until Batch 5 |
| Session list `updatedAt` not in ooc-3 `.session.json` | LOW — sort order may be wrong | Derive from filesystem mtime of latest thread.json |
| ooc-3 `GET /api/tree` is non-recursive — Sidebar FileTree needs deep tree | HIGH | Must add recursive option to ooc-3 `/api/tree` endpoint in Phase 0 |

### Files count by batch

| Batch | ooc-2 files | Notes |
|---|---|---|
| 1 (foundation) | ~35 | Heaviest layout work |
| 2 (core chat) | ~10 | Formatter is the risk |
| 3 (sessions) | ~20 | StaffView complexity |
| 4 (secondary) | ~30 | Mostly straightforward port |
| 5 (advanced) | ~18 | HARD — deferred |
| **Total** | **~113** | 107 source + 6 new (formatters, etc.) |

---

## Appendix: ooc-3 Existing Web Files (starting point)

Current ooc-3 web at `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/web/src/`:

| File | Status |
|---|---|
| `App.tsx` | Keep routes structure, update paths |
| `AppShell.tsx` | Rewrite — port ooc-2 `shell.tsx` logic |
| `api.ts` | Keep + extend — already mirrors `transport/http.ts` pattern |
| `main.tsx` | Keep |
| `uri-resolver.ts` | Keep (ooc:// URI resolution) |
| `render-spec.ts` | Keep (spec types) |
| `components/chat/ThreadTimeline.tsx` | Replace with ooc-2 TuiBlock approach |
| `components/chat/ChatComposer.tsx` | Port from ooc-2 |
| `components/chat/ChatPanel.tsx` | Port from ooc-2 |
| `components/sessions/SessionList.tsx` | Replace with ooc-2 version (richer) |
| `components/files/FileTreeSidebar.tsx` | Replace with ooc-2 FileTree |
| `components/brand/*` | Keep |
| `views/SessionsView.tsx` | Merge into ooc-2 SessionThreadsIndex |
| `views/SessionDetailView.tsx` | Merge into ooc-2 session detail |
| `views/SessionObjectView.tsx` | Merge into ooc-2 thread detail |
| `views/StonesListView.tsx` | Port ooc-2 stones domain |
| `views/StoneDetailView.tsx` | Port ooc-2 stone client |
| `views/FilesView.tsx` | Port ooc-2 FileViewer |
| `views/WorldView.tsx` | Keep + enhance |

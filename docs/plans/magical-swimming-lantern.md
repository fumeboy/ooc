# Plan: Update `packages/@ooc/meta/object.doc.ts` to reflect recent OOC-6 changes

## Context

The last 8 commits on the `ooc-6` branch introduced significant architecture changes — from WorldRuntime encapsulation and hot-reload, through path rename finalization (server→executable, client→visible, readme→readable), to stone flat layout, thread query routing across views, and data boundary contracts. `object.doc.ts` (the conceptual authority for OOC's 8 capability dimensions) only partially reflects these; many new contracts, layouts, and components are entirely undocumented there.

Goal: bring `object.doc.ts` into alignment with the current codebase, adding nodes at the right tree levels (children for sub-concepts, patches for supplementary notes), with `sources:` anchors to real code.

## Approach

Add **9 new nodes** and **update 2 existing nodes** across the tree. All changes are additive (no content removal) to preserve the design reasoning chain.

### 1. New: `children.persistable.children.stone.children.stone_registry`
**Insert after** `seed_knowledge` child (end of `stone.children`, around line 2834).

Documents StoneRegistry, the canonical stone discovery mechanism:
- Scans `stones/*/package.json` (flat) + `stones/<branch>/objects/*/package.json` (versioning) + `node_modules/@ooc/builtins/*`
- Priority: flat layout → versioning layout → deprecated `packages/` → builtins (first-seen wins)
- Allows user override of builtin ids (supervisor/user) via local `stones/<id>/`
- `resolveStoneDir` 3-path fallback
- `stoneRegistry.invalidate(id, files)` for hot-reload integration

Sources: `packages/@ooc/core/persistable/stone-registry.ts`, `packages/@ooc/core/persistable/stone-object.ts:resolveStoneDir`

### 2. Update: `children.persistable.children.world_layout` (content addition + new patch)
**Modify** content after the `objects/` middle-layer paragraph (line ~2728) to document:

**Content addition**: The **flat layout** `stones/<objectId>/` is the new canonical (not versioning layout). Versioning `stones/<branch>/objects/<objectId>/` exists for metaprog git workflows. Both layouts are resolved by StoneRegistry; flat takes priority.

**New patch** `world_layout.patches.stone_path_resolution`:
- 3-path fallback: flat → versioning → deprecated `packages/`
- Reader fallback chain: `executable/` → `server/`, `visible/` → `client/`, `readable.md` → `readme.md`
- Writer contract: **only canonical paths are written** (dual-write migration ended in `7cea77bc`)

### 3. Update: `children.programmable.children.loader` (new patch)
**Insert as new patch** `loader.patches.watcher_driven_invalidation` alongside existing `mtime_resolution_caveat` (line ~3588).

Documents the proactive invalidation pipeline:
- `HotReloadWatcher` does recursive `fs.watch` on `stones/` with 50ms debounce
- `parseStoneChange()` classifies `{objectId, kind}` supporting flat + versioning layouts
- Emits `stone:changed` event → WorldRuntime calls `stoneRegistry.invalidate(id, files)` → ServerLoader cache cleared → next `import()` uses `?t=<newMtime>`
- This is tier 1 of a planned 3-tier hot-reload architecture

Sources: `packages/@ooc/core/runtime/hot-reload.ts`, `packages/@ooc/core/runtime/WorldRuntime.ts`, `packages/@ooc/core/executable/server/loader.ts`

### 4. New: `children.visible.patches.frontend_security_boundary`
**Insert in visible.patches** between existing children and the `sources/todo/warnings` block (line ~4357).

Documents the Vite @fs security boundary:
- Vite dev server serves stones via `/@fs/<worldPath>/stones/*`
- `oocHotReload` plugin returns **403** for executable paths: `stones/*/{executable,server,knowledge,database,files}/**`
- Only `visible/` content is served to the frontend
- This is a hard security boundary — executable code must never leak to the browser

Sources: `packages/@ooc/web/vite.config.ts:oocHotReload`

### 5. New: `children.visible.patches.file_link_to_rendered_flow`
**Insert alongside frontend_security_boundary.**

Documents the file-link → rendered preview interaction pattern:
- FileViewer detects visible entry `.tsx` files via `normalizeClientFilePath()` (4 combos: flat/versioning × visible/client)
- Dispatches to `ClientWithSourceToggle` — a split view showing the **rendered React component** + a source toggle
- Guarded with `_allowClientPreview` flag to prevent recursion
- Navigation from a raw file path to a shortcut URL: `stones/<id>` (flat) or `/files/stones/.../visible/index.tsx` → rendered preview

Sources: `packages/@ooc/web/src/domains/clients/client-path.ts`, `packages/@ooc/web/src/domains/files/components/FileViewer.tsx`

### 6. New: `children.visible.patches.thread_context_routing`
**Insert alongside above patches.**

Documents that thread context (sessionId/objectId/threadId) propagates via URL query params across **all** route kinds:
- `flowsView`: canonical (documented previously)
- `file`: already documented
- **`stoneClient`**: `/stones/<id>?sessionId=...&objectId=...&threadId=...` activates RightPanel chat
- **`flowPage`**: `/flows/<s>/objects/<o>/pages/<p>?sessionId=...&objectId=...&threadId=...` same
- `parseRoute` has fallback regex parsing (works outside react-router params for tests/direct calls)
- `toPath` round-trips the query on stoneClient/flowPage
- AppShell derives `activeSessionId/ObjectId/ThreadId` from all 4 route kinds

Sources: `packages/@ooc/web/src/app/routing.ts`, `packages/@ooc/web/src/app/shell.tsx`

### 7. Update: `children.collaborable.children.messages` (new patch)
**Insert as patch** `messages.patches.field_alias_compat` after the ThreadMessage field list (line ~1756).

Documents the data boundary contract for ThreadMessage:
- **Canonical fields** (write always): `content`, `createdAt` (number, ms), `fromObjectId`, `toObjectId`, `source`, `windowId`
- **Legacy aliases** (read-only, tolerated): `text` (alias for `content`), `targetObjectId` (alias for `toObjectId`), `createdAt` as ISO string
- **Reader contract**: all read boundaries use `content ?? text`; formatter uses `windowId` → `targetObjectId` fallback for outbox target resolution
- **Writer contract**: seeds/demos/tests must use canonical fields. Legacy aliases exist only for backward compat with pre-`0492cf6` data.

Sources: `packages/@ooc/core/thinkable/context/render.ts:messageBody()`, `packages/@ooc/web/src/domains/chat/formatter.ts`, `packages/@ooc/meta/storybook/_seed_visible_demo.ts`

### 8. New: `children.thinkable.children.context.patches.xml_null_safety`
**Insert in thinkable.context.patches** (find existing patches on context_budget and add sibling).

Documents the rendering boundary null-safety contract:
- All XML text helpers (`escapeXml`, `wrapCdata`, `renderXmlTextValue`, `xmlText`, `xmlComment`) accept `string | undefined | null`
- `null/undefined` → empty string (no crash)
- Rationale: TS types at the rendering boundary are unreliable — data comes from disk JSON, cross-Agent messages, user input — any of which can violate the nominal type
- This is the **last line of defense**; upstream normalization should happen at data load boundaries

Sources: `packages/@ooc/core/thinkable/context/xml.ts`

### 9. Update: Root content and named dictionary
**Small correction**: The root content (line 91) lists `readable` as a 9th dimension ("自我塑造四件套"), but `readable` only exists as `patches.readable_concept`, not as a `children.readable`. **No structural change** (adding a root child is out of scope), but **add a note** in `root.patches.readable_concept` content clarifying: readable is conceptually the 4th self-shaping dimension, but it's currently documented here as a patch rather than a full child because its implementation footprint is smaller than the other three. This resolves the documentation inconsistency without restructuring the tree.

Add to named dictionary entry: `"readable": "OOC 第 9 个概念维度（自我塑造第四件）：Object 可被其他 Agent 阅读/了解的自我介绍面；实现为 readable.md（静态）或 readable.ts（动态渲染）。当前作为 root patch 记录，未单独列为 children。"`

## Verification

After each file edit, run:
```bash
bunx tsc --noEmit packages/@ooc/meta/object.doc.ts
```
Per the project rule: verify immediately after each doc file change (don't batch).

Final sanity check:
```bash
# Confirm DocTreeNode.sources type shape (single [[any, string]] entry per node)
# Confirm no new node has empty content or missing title
# Confirm tree shape still parses (no missing commas, proper nesting)
grep -c 'children: {' packages/@ooc/meta/object.doc.ts  # count consistency
```

No runtime tests needed — this is purely documentation.

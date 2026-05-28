# OOC-3 Rebuild Learnings

> Distilled journey from orphan branch bootstrap to full spec V2 coverage.
> Audience: future maintainers, Supervisor, AgentOfX owners.

## 1. Rebuild Premise

OOC-3 was started as a from-scratch orphan branch (not a refactor of ooc-2) to implement one key unification from spec V2: **OOC Agent and ContextWindow are the same concept — an OOC Object**.

The central change: eliminate the `Window/ContextWindow` abstraction layer. Every agent _is_ an Object with three layers of storage (stones/pools/flows), a prototype chain, and server methods.

## 2. Phase-by-Phase Design Decision Tree

### P1: Concept skeleton
- Defined `ObjectRecord` type (uri, paths, kind, self frontmatter)
- Defined `ObjectKind`: builtin / persistent / ephemeral
- Defined `ObjectPaths`: stone / pool / flow (three-layer trinity)
- Decision: `ooc://` URI scheme 1:1 mirrors filesystem paths — no mapping layer needed

### P2: Persistable / thinkable / observable foundation
- Implemented flow-paths (talks, threads, todos, plan), uri.ts, object-record.ts
- **Drift caught in cleanup**: P2 initially left `Window`-era field names in observable/persistable — cleaned in `clean(p2)` commit
- Decision: B-class fields collapse directly into flow Object dir (no separate file types)

### P3: Executable loader + registry + prototype chain
- `loadObjects()` scans stones/_builtin + stones/<branch> + flows/<session>
- `resolveChain()` walks `extends` pointers, detects cycles
- `findInChain()` first-match traversal for method inheritance
- Decision: prototype chain resolution is purely in-memory; no disk access needed

### P4: Root builtin prototype + defaultContext
- `stones/_builtin/objects/root/` is the ground prototype for all Objects
- `defaultContext()` assembles: plan, todos, threads, talks, relations
- Decision: root methods live in `src/executable/_builtin/` (not in stones/ themselves) for hot-reload safety

### P5: B-class collapse field method body
- Implemented actual method bodies for todo_add/check/uncheck/remove/list, plan_set/plan_clear
- Each method is a pure function: reads flow dir → mutates (new copy) → writes

### P6: Thinkloop + worker + HTTP + real-LLM e2e
- HTTP control plane: POST /api/talk, GET /api/health, GET /api/objects
- Worker-based job queue for async thinkloop execution
- **Drift 1 caught**: `/api/talk` endpoint was missing — test e2e bypassed via `app.handle()` and would PASS while the real HTTP route didn't exist; added explicit route
- **Drift 2 caught**: `LlmToolName` was too narrow (enum literal) — widened to `string` so dynamic server methods from Object.serverPublic could be dispatched
- **Drift 3 caught**: grep/glob commands created no files on disk — fixed to actually write ephemeral Object to `flows/<session>/objects/`
- Harness milestone: bug-fix e2e PASS with real Claude API

### P7: Web layer skeleton (minimal viable)
- Pure-TS `uri-resolver.ts` + `render-spec.ts` — no React/DOM dependency
- `resolveUri(uri)` → `{ layer, name, sessionId? }`
- `renderObject(record, slices)` → generic UI description JSON
- Decision: visible architecture's pure-function core is testable + SSR-ready before React wiring

### P8: Super flow fork snapshot
- `promoteEphemeral(opts)` copies design files (self.md, readme.md, client/, server/) from flows/ to stones/
- Pool files (pool.json) copied to pools/ (optional)
- Runtime files (talks/, threads/, todos.json) intentionally NOT copied
- Original flows/ preserved as archaeological chain
- Decision: super flow is a **fork snapshot**, not a move — ephemeral Object survives for audit

### P9: Harness landing
- 8 AgentOfX + 1 AgentOfExperience created as persistent Objects in `stones/main/objects/`
- Each has `extends: root` + dimension-scoped responsibility description
- AgentOfExperience: routes Issues, does not modify src/ directly

### P10: Sweep + gate verification
- Spec V2 merge gates verified (§7.4)
- Learning doc + README update

## 3. Drifts Caught and Fixed

| Drift | Phase detected | Fix |
|-------|---------------|-----|
| Window/ContextWindow field names leaked into observable/persistable | P2 cleanup | `clean(p2)` commit removed them |
| `/api/talk` HTTP route missing (e2e app.handle() false-positive) | P6 drift fix | Added explicit Elysia route `post("/api/talk", ...)` |
| `LlmToolName` too narrow — dynamic Object methods not dispatchable | P6 drift fix | Widened to `string` type |
| ephemeral A-class Object not actually written to flows/ | P6 drift fix | grep/glob commands now write real Object dirs |
| P2 stubs for stone-versioning / runtime/* left as dead code | P6 cleanup | Removed stubs, added doc references |

## 4. Harness Validation Milestones

| Milestone | Commit | Tests |
|-----------|--------|-------|
| Persistable + thinkable + observable unit tests | `2b261fc6` (P2) | ~30 tests |
| Prototype chain + loader + registry | `41bc2f97` (P3) | ~50 tests |
| Thinkloop + HTTP control plane | `5c3fd1f0` (P6) | ~150 tests |
| Real-LLM harness e2e PASS (bug-fix) | `a1a334ad` (P6f) | 4 real-LLM e2e |
| Web layer skeleton | `a03cfce6` (P7) | +13 tests |
| Super flow unit tests | `32e01d48` (P8) | +9 tests |
| **Final total** | | **285 pass, 2 skip, 0 fail** |

## 5. Spec V2 Coverage Table (§8.3)

| Phase | Description | Status |
|-------|-------------|--------|
| P1 | Concept skeleton (meta docs) | DONE |
| P2 | Persistable / thinkable / observable foundation | DONE |
| P3 | Executable loader + registry + prototype chain | DONE |
| P4 | Root builtin prototype + defaultContext | DONE |
| P5 | B-class collapse field method body | DONE |
| P6 | Thinkloop + worker + HTTP + real-LLM e2e | DONE |
| P7 | Web layer skeleton (uri-resolver + render-spec) | DONE |
| P8 | Super flow ephemeral → persistent fork snapshot | DONE |
| P9 | Harness landing (9 Agent Objects in stones/main/) | DONE |
| P10 | Sweep + learning doc | DONE |

## 6. Merge Gate Verification (§7.4)

All 7 gates verified at P10:

1. **HTTP routes exist**: POST /api/talk, GET /api/health, GET /api/objects registered in Elysia — verified by `src/app/server/__tests__/http.test.ts` + e2e tests
2. **Prototype chain resolve**: `prototype-resolver.test.ts` — 100% pass (resolveChain, findInChain, cycle detection)
3. **talks/threads/flow writes**: `appendTalkEntry`, thread dir creation verified in e2e + unit tests
4. **talk/do回路**: `POST /api/talk` → thinkloop → LLM response → talk back — verified by `api-talk-real-llm.test.ts` (skip if no ANTHROPIC_API_KEY)
5. **ephemeral落盘**: grep/glob commands create real `flows/<session>/objects/` entries — verified by `dispatcher.test.ts` + e2e
6. **super flow升格**: `super-flow.test.ts` — 9 tests PASS (design files copy, runtime files excluded, pool optional, original preserved)
7. **tsc meta/*.doc.ts**: `bunx tsc --noEmit meta/*.doc.ts` → 0 errors

## 7. Key Architectural Lessons

1. **URI 1:1 to filesystem = zero mapping layer**: No routing table to maintain; path conventions are the API.
2. **Prototype chain in-memory resolve**: Scanning happens at load time; runtime dispatch is a simple `findInChain()` call.
3. **Three-layer trinity is the contract**: stones (identity), pools (accumulation), flows (runtime). Any code that writes outside this trinity is a drift.
4. **False-positive e2e blind spot**: `app.handle()` in tests can PASS even when a route isn't registered at the Elysia router level. Always add an explicit HTTP route test alongside the handle() test.
5. **super flow = fork, not move**: The flows/ directory is an archaeological record. Promoting to stones/ is additive, never destructive.

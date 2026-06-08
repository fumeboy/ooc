# Plan: Make Each Object Actually "Itself" via `self.md` Injection

## Context

OOC is designed to support multiple intelligent Objects interacting within the
same Session, but today every Object's `think` loop runs through the same
LLM client with no per-Object identity in the prompt. `self.md` already exists
as the documented "identity.innerSelf" file (per
`meta/object/persistable/index.doc.ts:233`) but is never read at runtime —
`stoneSelf` only exposes `readSelf` / `writeSelf` and nothing in the think
path calls them.

Effect: even if two Objects (e.g. `supervisor` and `critic`) exist as stones
with different `self.md`, they behave identically when scheduled because the
LLM receives the same system context and the same empty `instructions` field.

This plan is the **minimum viable slice** that unlocks "multiple Objects with
distinct identities in one Session". It does not introduce any new persistence
schema, new window type, or new persona/displayName field — it just wires the
existing `self.md` into the existing `instructions` channel that
`buildInputItems` already promises to return (`src/thinkable/context/index.ts:282`
returns `{ instructions?: string; input: ... }`, but no caller ever sets it).

Out of scope for this slice (deferred to follow-ups):
- per-Object model/provider routing (would go in `data.json` later)
- session participants directory / `readme.md` exposure to peers
- multi-party `group_talk` window
- UI multi-target chat

---

## Approach

Three small changes, all on the read path of `think` — no new files, no
schema migration:

### 1. `self.md` enters context via `instructions`

**File:** `src/thinkable/context/index.ts` (function `buildInputItems`,
line ~280)

- After `executableState` is computed, derive a `StoneObjectRef` from
  `thread.persistence` using the existing
  `deriveStoneFromThread(thread.persistence)` helper
  (`src/persistable/common.ts:60`) — note it returns `{ baseDir, objectId }`
  which is exactly what `readSelf` wants.
- Call `readSelf(stoneRef)` (`src/persistable/stone-self.ts:11`) — returns
  `string | undefined` if `self.md` doesn't exist.
- If a non-empty string is returned, populate the already-typed
  `instructions` return field with it.
- If `thread.persistence` is missing (in-memory test mode) or `self.md`
  is missing, omit `instructions` — current behavior preserved.

### 2. `<self>` segment appears in the XML system context

**File:** `src/thinkable/context/render.ts`

- Add a small `<self object_id="…">` element at the very top of the rendered
  XML (before any window).
- `object_id` comes from `thread.persistence?.objectId`; omit the whole
  element if no persistence (preserves the in-memory test contract).
- This makes the Object's own name visible inside the system context so
  multi-Object talks render coherently — distinct from `instructions`,
  which carries the longer narrative `self.md` body.
- No `<readme>` here — `readme.md` is for peers, not self. Exposing peers'
  readmes is a separate follow-up.

### 3. `think` passes `instructions` to the LLM client

**Check:** `src/thinkable/thinkloop.ts:32-36` — already does
`instructions: llmInput.instructions`. **No change needed.** Both Claude
and OpenAI providers already thread `instructions` through
(`src/thinkable/llm/providers/openai.ts:171,222`).

This is the load-bearing reason the slice is small: the wiring slot exists,
it's just never filled.

---

## Critical files

| Path | Change |
|---|---|
| `src/thinkable/context/index.ts` | `buildInputItems`: call `readSelf` + return `instructions` |
| `src/thinkable/context/render.ts` | `renderContextXml`: prepend `<self object_id="…">` element |
| `src/persistable/index.ts` | confirm `readSelf` is re-exported (it already is via stone-self barrel — verify) |

**Reused, do not re-implement:**
- `readSelf(ref)` — `src/persistable/stone-self.ts:11`
- `deriveStoneFromThread(threadRef)` — `src/persistable/common.ts:60`
- `instructions` parameter on `LlmGenerateParams` — `src/thinkable/llm/types.ts:68`

**Hard-coded "supervisor" references** found during exploration that this
slice does NOT touch but that follow-up work should generalize:
- `src/app/server/runtime/worker.ts:16` — `USER_OBJECT_ID = "user"`, keep
- `src/app/server/modules/flows/service.ts:28` — same constant, keep
- (No literal `"supervisor"` string in `src/` — the bias is in the
  collaborable doc, not in code. Good: nothing blocks N Objects today.)

---

## Verification

### Unit
- Add a test under `src/thinkable/__tests__/` (or extend
  `context.test.ts`) that:
  1. Sets up a thread with `persistence.objectId = "alice"` and writes
     `stones/alice/self.md = "I am Alice, a careful reviewer."`
  2. Calls `buildInputItems(thread)` and asserts
     `result.instructions === "I am Alice, a careful reviewer."`
  3. Asserts the XML in `result.input[0].content` contains
     `<self object_id="alice">`.
- Add a negative test: thread with no `persistence` → `instructions`
  undefined, no `<self>` element rendered, prior snapshot tests still pass.

### Integration
- Existing tests in `src/thinkable/__tests__/single-object-runtime.test.ts`
  and `src/app/server/__tests__/real-app-server.test.ts` should pass
  unchanged (they don't write `self.md`, so the new code path is inert).

### Manual end-to-end (smoke)
1. Create two stones under `.ooc-world-test/stones/`:
   - `supervisor/self.md` — "你是 supervisor，会把任务分配给合适的对象"
   - `critic/self.md` — "你只会用挑刺的口吻反驳"
2. Run the app server with `--world /Users/bytedance/x/ooc/ooc-2/.ooc-world-test`
   (per the memory rule about world dir).
3. Seed a session with `targetObjectId=supervisor` and ask it to consult
   `critic`. Expect supervisor's `talk("critic", …)` to wake a critic thread
   whose LLM call has `critic/self.md` as `instructions` (verify in
   `flows/<sid>/objects/critic/threads/<tid>/debug/llm.input.json` —
   `debugFile` already records the full request).
4. Critic's reply tone should differ from supervisor's — proves the per-Object
   identity actually reaches the model.

### TS verify-as-you-go (per memory)
After each file edit: `bun tsc --noEmit`.

---

## Doc follow-up (same PR, not a blocker)

The change makes `self.md` a **live runtime input**, not just a documented
artifact. Add one short sentence to
`meta/object/persistable/index.doc.ts` `stoneSelf` source description (or the
`stoneLayout` self.md line) noting that `self.md` is injected as LLM
`instructions` on every `think` tick. This keeps meta docs honest and lets
future agents discover the binding via the meta concept graph.

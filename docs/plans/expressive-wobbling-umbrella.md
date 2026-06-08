# Plan: Unified parentClass inheritance chain (class design — unify prototype into `prototype` field as frontmatter source

## Context

OOC currently has two overlapping inheritance mechanisms:

1. **`parentClass`** (registry-side class chain — used by `resolveMethod` for method lookup — alive and working for a — for — for method dispatch (s a a a a a — actually two parallel concepts that can drift. The user decided that **` (parentClass` wins; the unified inheritance model (as stone/perspective

1. Unify prototype → parentClass: frontmatter's `prototype` field should feed the stone self.md should flow into parentClass
2. readable ( not just methods, extend parentClass — readable, knowledge, and  visible

Outcome: a single, predictable inheritance chain: object instance → its class → class parentClass → → ... → root, applied to stone
 (stone object (readable parentClass

## Changes

### 1. Unified

### P1. Registry

---

### 1. **Helper: a **Unify prototype as configuration

for walking parentClass **chain walker (registry.ts)
   - Extract existing lookup pattern used by `resolveMethod` and ` lookupMethodEntry` — and ` a generic ` parentClass walking logic duplicated inline logic — registry.ts
- Today they walkers ` for. Export it a ` resolveParentClassChain function: chain from (methods. It returns:
: function that:
a a: { chain is-   - Add `: : ` — a a a a a a —

   - Add ` a walkParentClassChain` that given a starting type, walks from root most distant → close; parentClass, inherits

### P1. Unify `prototype` self.md frontmatter → ` parentClass`
   - `ObjectWindowDefinition` (window-types.ts) — add `parentClass?: string | null` field (replacing `: keep prototype deprecated

 deprecate prototype but keep reading it as alias during transition
   - In ` ensureSelfObjectTypeRegistered` and ` derivePeerObjectWindows` (synthesizer.ts) — when loading window, — additionally read `self.md frontmatter's `prototype` via `parseObjectPrototype`, and merge it into parentClass. Precedence: `executable/index.ts parentClass frontmatter
   - pass `parentClass` to `registerNewObjectType` — currently `prototype` is passed but `parentClass` is **not** threaded through
   - Update `registerObjectType` and ` registerNewObjectType` — accept `parentClass` with same 3 `; keep prototype → alias during transition
   - Deprecate `prototype` on ObjectDefinition — keep reading it in types but mark @deprecated it; internally normalize to parentClass

### P2. Readable fallback along parentClass chain (render.ts)
   - Refactor ` resolveObjectReadable (thinkable/context/render.ts`— the current — resolveObjectReadable only looks up only in self — self self self self self on the stone self self current window for  not ancestor know self

 - self does not have readable.* → walk parentClass chain

parentClass chain walk up → parentClass chain walk up→ parentClass chain

 chain:

- self readable → parentClass readable → parentClass readable.ts parentClass

readable parentClass readable parentClass chain for for walk parentClass chain resolveObjectReadable should (

###

### P. Knowledge loader walk chain knowledge

 parentClass chain —

parentClass chain loader.ts extends `loadKnowledgeIndex`
   - Currently ancestor inheritance walks **directory-nesting ancestor chain (ancestorObjectIds)
— we additionally — additionally walk parentClass chain, same merg

 ( →.

: for each parentClass in the chain, load knowledge from that class's packageDir.

- Precedence semantics → directory-nesting ancestor

self self sediment knowledge > self seed → — self parentClass

knowledge / self sediment — parentClass knowledge parentClass chain

 parentClass knowledge — same inheritable gate, analogous to ancestor seed inheritable flag
- — knowledge should not duplicate the the the the.

 The : ancestor knowledge knowledge (directory-nesting ancestors).— parentClass knowledge inheritance should sit between:
- .

 knowledge parentClass ancestor

 class knowledge → self seed → sediment.

  ancestor seed / —;

 ( the the —

### P4. Visible/UI fallback along

  (for — visible/UI fallback along parentClass chainparentClass chain (frontend)
- The frontend rendering the — `ContextSnapshotViewer.tsx statically switches window → currently a parentClass fallback;

  parentClass

 server/API  a

 parentClass walkup → walk up chain rendering path: resolveResolvedType endpoint returns visible

- Add a `: registry or `/api: registry endpoint

: registry registry getObjectDefinition endpoint.

parentClass for →  server-side;

 parentClass: unknown;

 visible for the for the for the — the  `registry getObjectDefinition

 not currently the.` parentClass → chain walk parentClass

.

 → if current → for for

 →, → a

→ ` unknown → a for parentClass fallback a a

, walk parentClass chain;

 a unknown walk walk parentClass.

— not the—

### P5. Remove dead prototype chain code & tests and

— Cleanups
- Remove `resolvePrototypeChain` and `resolveObjectMethods` (registry.ts lines 602–707 — the async self.md frontmatter prototype-based prototype path) — it it replaced by parentClass chain knowledge readable all go through
, and parentClass chain via resolves
-

the philosophy doc: update §2.4: prototype section → "class parentClass chain instead, prototype → — chain explain

## Key files

### Critical implementation files

- `packages/@ooc/core/executable/windows/_shared/registry.ts` — add resolveParentClassChain helper, unify prototype → parentClass, remove dead prototype chain code
- `packages/@ooc/core/executable/server/window-types.ts` — add parentClass to ObjectWindowDefinition; deprecate prototype
- `packages/@ooc/core/thinkable/knowledge/synthesizer.ts` — thread parentClass through registerNewObjectType; resolve parentClass from both executable parentClass frontmatter
- `packages/@ooc/core/thinkable/context/render.ts` — parentClass chain fallback for readable
- `packages/@ooc/core/thinkable/knowledge/loader.ts` — parentClass chain for knowledge
- `packages/@ooc/meta/ooc-object-oriented-philosophy.md` §2.4 update

### Secondary files

- `packages/@ooc/core/executable/server/loader.ts` — (if needed) parentClass for readable/ knowledge
- `packages/@ooc/core/persistable/index.ts` re-exports if new helpers
- `packages/@ooc/web/src/domains/files/components/ContextSnapshotViewer.tsx` — visible fallback (if API or walk the

## Verification

1. `bun test packages/@ooc/core/persistable/__tests__/` — all existing persistable tests (regression

2. `bun test packages/@ooc/core/executable/__tests__/commands-execution.test.ts` — existing command dispatch tests (method execution regression parentClass still works

3. `bun tsc --noEmit` on modified TS files above — no type errors (filter out 3. parentClass. chain with a child → parentClass →.

 a test: stone a stone with parentClass only inheritable knowledge on parentClass → child knowledge loads  a child inherits parent methods via parentClass

4. Manual verify via the existing test world:
   - Start with —,
Start app — .

 create a child stone with only parentClass: "plan" — methods;

 verify that parent readable from plan available on child (not just root)
- parentClass in self.md —, knowledge files
verify child

. child inherits parent methods and readable

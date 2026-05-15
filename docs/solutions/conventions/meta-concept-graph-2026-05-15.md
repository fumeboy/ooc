---
title: meta concept graph — every design point is a named JS object linked to its source module
date: 2026-05-15
category: conventions
module: meta
problem_type: convention
component: documentation
severity: high
applies_when:
  - Adding a new design concept to meta/
  - Adding or removing a window type, command, or major architectural piece in src/
  - Bringing a new top-level meta module (thinkable, collaborable, web, ...) under the same structure
  - Reviewing whether a meta doc accurately reflects the source it describes
tags: [meta, doc-graph, concept, source-binding, fail-loud, codeagent]
---

# meta concept graph — every design point is a named JS object linked to its source module

## Context

`meta/**/*.doc.js` used to be organized as one big versioned object per module, with most of the substance packed into a `index: \`...\`` markdown blob. That made two failure modes routine:

1. **Code drift**: someone added a window type, renamed a tool field, or changed a protocol — and forgot to update the corresponding sentence buried inside a 100-line markdown blob. Tests passed, the meta description drifted out of date, and nothing in the build flagged it.
2. **Concepts couldn't be referenced singly**: "ContextWindow" and "渐进式披露" both lived inside `executable.index`. To cite either in a brainstorm, commit message, or LLM-context selector, you had to paste the whole blob, and any fix made in one citation never propagated to the others.

The 2026-05-15 plan (`docs/plans/2026-05-15-001-refactor-meta-concept-graph-executable-plan.md`) extracted the executable module into a "concept graph": each design point is now a **named JavaScript object** that **imports the source module(s) it describes**. The schema is enforced by a bun test (`meta/__tests__/concept-links.test.ts`), so deleting or renaming a referenced source file fails the build immediately.

This convention captures the pattern so the next module (thinkable / collaborable / web / ...) can reuse the same structure deliberately rather than reinventing it.

## Guidance

### Concept schema

Every concept object in `meta/` has exactly three required fields:

```js
export const some_concept_v<YYYYMMDD>_<n> = {
  name: "PascalCaseName",      // human-readable label
  description: "...",          // multiline markdown explaining the concept
  sources: { foo, bar },       // Record<string, ModuleNamespace> — see below
};
```

Optional but conventional fields:
- `get parent() { return ... }` — back-link into a parent aggregator, behind a getter to break circular init
- `index` — same string as `description`, kept temporarily as a legacy alias for downstream code that reads `.index`. Remove on the next sweep when nothing references it.

### `sources` rule — code-level imports, never strings

`sources` is a `Record<string, ModuleNamespace>`. Each value is the result of `import * as ns from "@src/..."`. **No string paths, no symbol-name strings.** The reason is the entire point of the convention: TypeScript's `tsc --noEmit` validates the import path, and deleting the file at the other end fails the build.

```js
// ✅ correct
import * as talk from "@src/executable/windows/talk";
import * as talkDelivery from "@src/executable/windows/talk-delivery";

export const talk_window_v20260515_1 = {
  name: "TalkWindow",
  description: `...`,
  sources: { talk, talkDelivery },
};
```

```js
// ❌ wrong — string path, tsc cannot validate
sources: { talk: "src/executable/windows/talk.ts" }

// ❌ wrong — symbol name as string, equally fragile
sources: { say: "TalkWindowSayCommand" }
```

When a concept maps to multiple source modules (e.g., `talk` and `talk-delivery`), include each as a named entry. The key names carry semantics ("this concept is expressed in `talk` and supported by `talk-delivery`").

### Concept naming and versioning

- **Variable name**: `<snake_case_concept_name>_v<YYYYMMDD>_<n>`, matching the existing meta convention (`tools_v20260506_1`, `executable_v20260504_1`). Bump `n` when the concept is materially restructured, or roll a new date when the underlying source module is rewritten.
- **`name` field**: PascalCase, no underscores — `ContextWindow`, `TalkWindow`, `ProgressiveDisclosure`. For aggregator concepts that wrap a directory (`tools/index.doc.js`), use the directory name (`Tools`) rather than the literal filename (`Index`).

### Where to put the file

Use this rule: **directory complexity drives layout.**

- A module with **3+ independent concepts**: extract them into a `concepts/` subdirectory under that module — e.g., `meta/object/executable/concepts/{context-window,window-manager,...}.doc.js`.
- A module with **per-type variations** of the same concept family (e.g., one entry per window type): use a sibling subdirectory named after the family — e.g., `meta/object/executable/windows/{talk,do,todo,program,file,knowledge}-window.doc.js`.
- Single-concept files (one tool / one command per file) stay flat in their existing location — no need to nest.

Whatever the layout, the concept object must be importable from the module's top-level `index.doc.js` so it appears in the walked tree.

### Aggregator concepts

A concept can also be the parent of other concepts. The walker (`walkConcepts`) records the matching object as a concept *and* descends into its non-`SKIP_KEYS` fields. So this is correct:

```js
export const executable_v... = {
  name: "Executable",            // optional — only if executable itself is a concept
  description: "...",
  sources: { ... },
  concepts: {
    contextWindow: context_window_v...,
    windowManager: window_manager_v...,
    windows: {
      talkWindow: talk_window_v...,
      doWindow: do_window_v...,
    },
  },
};
```

Note: `parent` and `sources` are skipped during traversal (parent is a back-edge, sources holds module namespaces, not child concepts).

### CI enforcement

Two layers, both already wired:

1. **`bun tsc --noEmit`** — every `import * as ns from "@src/..."` in a doc.js is type-checked. Renaming or deleting the source module fails compilation.
2. **`bun test meta/__tests__/concept-links.test.ts`** — walks the meta tree from the relevant module root and asserts every collected concept satisfies the schema (non-empty name + description + non-empty sources Record with object values).

Run both before commit. The `bun test` half is automatically picked up by the existing `"test": "bun test"` package.json script.

## Why This Matters

- Documentation drift was the main failure mode of the old structure. With this convention, you cannot delete or rename a source module without the build telling you which meta file references it.
- Concepts as named JS paths (e.g., `executable_v20260504_1.concepts.windowManager`) are the right primitive for everything downstream: brainstorm citations, commit messages, LLM context wells, future docs-graph UI.
- The migration cost per new module is small (~10–20 concept files, mostly content copy) and one-time. The maintenance cost forever after is bounded — every change runs through the same schema check.

## When to Apply

- **New design concept introduced in src/**: add a concept doc at the same time as the implementation. Pre-merge check: `bun test meta/__tests__` and `bun tsc --noEmit` both green.
- **Source module renamed / deleted**: tsc breaks the meta import; either update the meta `sources` entry or remove the orphaned concept.
- **New top-level meta module migrating to this convention** (e.g., thinkable, collaborable, web): mirror the executable module's layout — `<module>/concepts/` for cross-cutting concepts, `<module>/<family>/` for per-variant concepts; aggregator at `<module>/index.doc.js` exposes them under `.concepts.{...}`.

## Examples

### Cross-module migration checklist (thinkable example)

1. Pick a target module: `meta/object/thinkable/`
2. Read `meta/object/thinkable/index.doc.js`'s current `index` blob; identify discrete concepts inside it (likely candidates from the existing layout: `ThreadTree`, `ThreadLifecycle`, `ContextEngineering`, `KnowledgeIndex`, `LlmClient`, `ThinkLoop`)
3. For each concept, create `meta/object/thinkable/concepts/<name>.doc.js` with `{ name, description (carved from the blob), sources: { ... } }`
4. Rewrite `meta/object/thinkable/index.doc.js` to import them all and expose under `.concepts`
5. Run `bun tsc --noEmit && bun test meta/__tests__` — fix any failures
6. Update any downstream readers that accessed `.index` directly (or leave a `legacyIndex` alias as the executable module did)

### Adding a new concept (e.g., a new window type)

```js
// 1. Implement the new window in src/executable/windows/<name>.ts
// 2. Add a meta concept binding it:

// meta/object/executable/windows/<name>-window.doc.js
import * as <name> from "@src/executable/windows/<name>";

export const <name>_window_v<YYYYMMDD>_1 = {
  name: "<Name>Window",
  description: `...`.trim(),
  sources: { <name> },
};

// 3. Wire into meta/object/executable/index.doc.js:
//    import { <name>_window_v... } from "./windows/<name>-window.doc";
//    concepts: { ..., windows: { ..., <name>Window: <name>_window_v... } }

// 4. Verify: bun tsc --noEmit && bun test meta/__tests__
```

### Anti-pattern: bypassing the schema

```js
// ❌ Don't do this — schema test will pass (no concept fields), but the
//    file becomes invisible to the concept graph and drifts silently.
export const my_thing_v... = {
  // Just a markdown blob; no name/description/sources.
  text: `...`,
};
```

If something genuinely belongs outside the concept graph (a worked example, a glossary), put it in a non-`*.doc.js` file or under a directory the walker doesn't enter. Don't half-comply.

## Related

- `docs/plans/2026-05-15-001-refactor-meta-concept-graph-executable-plan.md` — the plan that drove this work
- `docs/brainstorms/2026-05-15-meta-concept-graph-requirements.md` — the brainstorm that established WHY
- `docs/solutions/conventions/llm-tool-handlers-fail-loud-2026-05-15.md` — same session's other lesson; the meta concept graph is the structural realization of that fail-loud principle for documentation
- `docs/solutions/conventions/agent-doc-work-verify-as-you-go-2026-05-15.md` — execution discipline for agents doing doc-graph work
- `meta/__tests__/walk-concepts.ts` — the walker implementation
- `meta/__tests__/concept-links.test.ts` — the schema-enforcement test
- `meta/object/executable/` — the first module fully converted; use as the reference shape

---

## Field notes from the first migration (executable, 2026-05-15)

Lessons surfaced while doing the first module conversion. Read before tackling the next module (thinkable / collaborable / web / ...).

### Don't trust the walker without testing on the real tree

The first walkConcepts implementation treated "concept = leaf": once a node satisfied the schema, descent stopped. This worked perfectly on the mini fixture in U1's tests. It failed silently on the real meta tree, where many nodes are **aggregators that are also concepts** (e.g., `tools_v...` carries `name + description + sources` AND wraps the per-tool concepts). Concepts buried under aggregator-shaped concepts never got walked.

Surfaced only at U3 (~3 commits in), when the actual collected count `13` didn't match the expected `~17`. Fix was a one-line change to `walkConcepts` (always descend after recording), but the design issue should have been caught at U1.

**Rule for next migration**: when writing the walker, immediately run it against the real target module tree (not just a fixture) and eyeball the collected concepts. The fixture proves the rule works on the cases you imagined; the real tree proves you imagined the right cases.

### Codemod for `name`: special-case `index.doc.js`

A small node script derived `name` field from filename via PascalCase. For `index.doc.js` files this produced `name: "Index"` — wrong, because aggregators should be named after their **directory**, not the literal filename. The actual right names are `Tools`, `Commands`, `Server`, `Client`.

Surfaced when reviewing the diff visually right after the batch ran. Cost: one extra commit's worth of edits to fix.

**Rule for next migration**: when running a name-derivation codemod, special-case `index` to use the parent directory's basename instead. Pseudocode:

```
basename = path.basename(file, ".doc.js")
name = basename === "index"
  ? pascalCase(path.basename(path.dirname(file)))
  : pascalCase(basename)
```

### Leaf concepts not reachable from the aggregator are invisible to the schema test

`actions/tools/open.doc.js` etc. were retrofitted with `name + description + sources` in U4. Schema-correct on paper. But none of them are listed as fields on `tools_v...` — the leaf docs import their parent, the parent doesn't enumerate them back. Result: `walkConcepts(executable_v...)` never sees them. The schema test passes vacuously for those files.

This was discovered post-hoc and explicitly deferred — not a bug introduced by this work, but a coverage gap the migration didn't close.

**Rule for next migration**: if you want leaf docs guarded by the schema test, the aggregator must enumerate them explicitly:

```js
export const tools_v... = {
  // ... aggregator fields
  children: {
    open:    open_v...,
    refine:  refine_v...,
    submit:  submit_v...,
    // ...
  },
};
```

Otherwise, leaf docs are first-class JS exports that other code may import directly, but their `sources` field has no automated guarantee. Decide per-module whether this matters; for executable's tool/command leaves, it likely does (these are the most-frequently-edited docs).

### Plan must carry "Patterns to follow" with the level of specificity that survives a fresh agent

The executable migration relied on `get parent() { return ... }` getters to break circular init between sibling doc.js files (e.g., `executable/index.doc.js` ↔ `tools/index.doc.js`). U2 / U4 both touched files with this pattern, and I almost dropped it twice via muscle memory; the plan's "Patterns to follow" field said `get parent() getter pattern` but didn't *show* the pattern. A fresh agent without my context would likely have re-introduced the circular import.

**Rule for next plan**: the plan's "Patterns to follow" should include the actual code pattern when it exists for a non-obvious reason. For meta concept files specifically:

```js
// REQUIRED: parent must be a getter to break circular init when sibling
// doc.js files import each other. Direct assignment causes ReferenceError.
get parent() { return parent_v...; }
```

Cite the exact concern (circular init / TDZ) so the next reader knows what they break by removing it.

### `description` getter aliasing `index` is the right migration shim

For files that already had `index: \`...\``, the U4 batch added `get description() { return this.index; }` rather than duplicating the string. This kept the schema test happy (description present) without forcing a content rewrite, and lets the next sweep delete `.index` everywhere by deleting just the field (not the body).

This pattern is reusable: when migrating an old field name to a new one and downstream code may still read the old name, prefer a getter alias over duplicating the value. One source of truth, no risk of drift.

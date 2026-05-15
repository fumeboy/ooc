---
title: Agent doc-graph work — verify each link as you create it, not at the end
date: 2026-05-15
category: conventions
module: docs
problem_type: convention
component: documentation
severity: high
applies_when:
  - Agent is doing a batched migration that adds or modifies cross-file links (imports, references, schema bindings)
  - Agent is writing meta concept docs, plan docs, or any artifact that imports source modules by path
  - Agent is running a codemod or templated batch edit across many files
tags: [agent-execution, doc-work, verify-as-you-go, fail-loud, codemod, meta]
---

# Agent doc-graph work — verify each link as you create it, not at the end

## Context

When an agent does batched documentation work — especially work that creates or rewires references between docs and source code (imports, schema bindings, plan→file path references) — there's a very specific failure mode:

The agent writes a wrong-path import or stale reference into one file, moves to the next, accumulates 5-10 more changes, then runs the type-checker / link-checker once at the end. The first error surfaces, the agent fixes it, runs again, the next error surfaces, fixes that. Each iteration is cheap individually but compounds: a 5-file batch with 3 silent errors becomes 3 round-trips of context-load → fix → re-verify, when verifying after each individual file would have caught each error within seconds of writing it.

This happened concretely during the 2026-05-15 meta concept graph migration: while doing U4, I wrote `import * as thinkloop from "@src/thinkable/thinkloop/index"` for `compress.doc.js` — but `thinkloop` is a file (`thinkable/thinkloop.ts`), not a directory. Didn't run tsc immediately; only caught it later when validating the broader U4 commit. The irony is sharp: this is the *exact* class of silent drift the meta concept graph convention exists to prevent, and the agent doing the work bypassed the guard because it batched the verification.

## Guidance

When doing doc-graph work that creates cross-file references:

1. **Run the verification command immediately after each file you edit** when the verification is cheap (≤5s). Examples:
   - After adding any new `import` in a meta `*.doc.js`: `bun tsc --noEmit` (3-4s)
   - After modifying any test file: `bun test <that-file>` (sub-second)
   - After editing a markdown doc that links to source files: spot-check at least one referenced path exists

2. **Run the broader test suite at every natural milestone**, not just at the end. For implementation units, every unit completion. For codemod batches, after every ~5 files written.

3. **If a codemod runs, immediately diff-review the result before the next batch**. Codemods almost always have a special case the author missed. Catching it before commit is one tiny edit; catching it after commit is a fix-up commit polluting history.

4. **Treat your own success channel skeptically**. If a build is "green" but a sub-suite was skipped (e.g., `bun test src/` passed but you didn't run `bun test`), the result isn't actually green — it's "green for what I bothered to check". Either narrow the success claim or expand the check.

5. **Watch for "almost done" momentum**. The strongest pull to skip verification comes 80% through a batch when the remaining work feels mechanical. That's the most likely time to introduce a silent error.

## Why This Matters

The cost asymmetry is identical to the LLM-tool-handler case but applied to the agent itself:

- **Per-step verification cost**: 3-5 seconds × N files = trivial
- **Batch verification cost when something fails**: full suite run + locate-the-bad-file + fix + re-run + repeat for cascade failures. Easily 10× more than per-step.
- **Worst case**: silent error survives commit, lands in main, only surfaces hours/days later when someone reads the doc and follows a broken reference.

The meta concept graph convention exists *precisely* to make this class of bug impossible by binding docs to type-checked source imports. An agent ignoring the same principle while building that convention is — as we discovered live — exactly the failure mode worth naming.

## When to Apply

- **Always for cross-file reference work**: meta doc imports, plan→file path references, link-rich markdown
- **Always for codemods or batched scripted edits**: diff-review the first few outputs before letting the rest run
- **Especially when working in unfamiliar source territory**: a new module, an area you haven't navigated before, anywhere your "this looks right" intuition is weak

Skip the per-step rigor only for: pure prose edits (no cross-references), single-file changes, areas with strong existing local patterns you're confident about.

## Examples

### Anti-pattern: batched verification with silent drift

```
[agent writes meta/object/executable/concepts/context-window.doc.js — import OK]
[agent writes meta/object/executable/concepts/window-manager.doc.js — import OK]
[agent writes meta/object/executable/concepts/progressive-disclosure.doc.js — import OK]
[agent writes meta/object/executable/actions/tools/compress.doc.js — import points to nonexistent path]
[agent writes meta/object/executable/actions/tools/mark.doc.js — import OK]
[agent commits the batch]
[agent finally runs bun tsc --noEmit]
=> error: cannot find module @src/thinkable/thinkloop/index
[agent reads error, locates compress.doc.js, fixes path, re-runs tsc, commits fix]
```

Five edits, three minutes wasted, one polluted commit history.

### Right pattern: per-step verification

```
[agent writes meta/object/executable/actions/tools/compress.doc.js]
[agent immediately runs: bun tsc --noEmit  → 3.5s, fails on compress.doc.js]
[agent fixes path before moving on]
[agent runs: bun tsc --noEmit  → 3.5s, clean]
[agent moves to mark.doc.js]
```

Same number of edits, no fix-up commit, error caught at the moment of authorship when context is fully loaded.

### Codemod example: catch the special case immediately

```
[agent writes name-derivation script: filename → PascalCase]
[agent runs script on first 3 files, eyeballs output]
=> sees "name=Index" for tools/index.doc.js — wrong, should be "Tools"
[agent fixes script special-case for index.doc.js BEFORE running on remaining 13 files]
```

Versus running on all 16 files, catching the bug at review time, and either editing 4 `name: "Index"` lines manually or re-running the script.

## Related

- `docs/solutions/conventions/llm-tool-handlers-fail-loud-2026-05-15.md` — the same fail-loud principle applied to LLM tool handlers; this convention applies it to the agent's own execution discipline
- `docs/solutions/conventions/meta-concept-graph-2026-05-15.md` — the meta convention this lesson surfaced from, including a "Field notes from first migration" appendix with concrete migration gotchas

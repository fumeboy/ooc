---
title: "feat: file edit/write + glob/grep — Claude Code parity (phase 1)"
date: 2026-05-15
status: completed
type: feat
origin: docs/brainstorms/2026-05-15-oocable-codeagent-fs-search-requirements.md
depth: standard
---

# feat: file edit/write + glob/grep — Claude Code parity (phase 1)

> **Origin**: `docs/brainstorms/2026-05-15-oocable-codeagent-fs-search-requirements.md`. Brainstorm fixed WHAT (4 capabilities — Edit / Write / Glob / Grep — to make OOC self-sufficient on code tasks; strictly via command + window, never new tools) and WHY (today any real code task forces falling back to `program(shell, sed/rg)` and degrades OOC into a shell wrapper). This plan defines HOW.

---

## Summary

- **edit** as a new command on `file_window` (single + array MultiEdit form, atomic-or-fail)
- **write_file** as a new root command (creates / overwrites + auto-spawns file_window)
- **glob** + **grep** as new root commands → produce a new `search_window` type
- `search_window` registers `open_match(index)` to spawn a file_window at any matched path
- Append "prefer file_window.edit / write_file over shell" anti-pattern note to `program` command knowledge
- Meta concept docs added per the 2026-05-15 concept-graph convention

5 原语 unchanged. No new LLM tools. Permission model out of scope.

---

## Problem Frame

Today every real code task in OOC forces `program(language=shell)` for grep/sed/echo-redirect, which is fragile (sed quoting), discards window-level structure (LLM re-parses bare text), and bypasses OOC's own discipline (open_file followed by program(shell, sed) is two unrelated abstractions for one operation). This phase closes the gap for the four most-common operations so OOC objects can complete code tasks without退化 into a shell wrapper.

---

## Scope Boundaries

### In scope (this plan)

- `file_window.edit` (oldString → newString; supports `{ edits: [...] }` MultiEdit, atomic-or-fail)
- `root.write_file` (path + content → write + auto-spawn file_window)
- `root.glob` → `search_window`
- `root.grep` → `search_window`
- `search_window` new ContextWindow type with commands `open_match` + `close`, `basicKnowledge`, render layer support
- Anti-pattern note appended to `program` KNOWLEDGE
- Meta concept docs for the new commands + window

### Deferred to follow-up work

- `search_window.next_page` / `refine_query` (not needed for v1)
- Buffered draft state on file_window (edits commit to disk immediately)
- AST-aware search

### Outside this product's identity (from origin)

- New LLM tools — 5+mark+compress unchanged forever
- task list upgrade (TodoWrite-style task_window)
- Web fetch / search
- Background processes
- worktree / cron / NotebookEdit
- Permission/审批 model
- "Wrap OOC into Claude Code-replacement" positioning work
- Image / PDF support

---

## Key Technical Decisions

| 决策 | 选择 | 理由 |
|---|---|---|
| **edit attaches to file_window, not root** | `file_window.edit` (origin user choice) | "open the file then edit it" is the OOC-native shape; mirrors how `set_range` / `reload` already work |
| **write_file is a root command** | New root command `write_file` that auto-spawns file_window | Asking the LLM to first "open" a file that doesn't exist is awkward; root.write_file owns "create or overwrite" + spawns file_window so subsequent edits use uniform path |
| **MultiEdit semantics via array form** | edit args accept `{ old, new }` (sugar) or `{ edits: [{ old, new }, ...] }` (atomic batch). All `old`s must match exactly once on first read; if any fails, no writes happen | Matches Claude Code's MultiEdit atomic-or-fail; single form is the common case |
| **search_window has `kind: "glob" \| "grep"`** | Single window type with discriminator (no per-kind type) | Both share matched-path list shape; commands identical; future kinds (ast-grep) extend by union |
| **search_window first-cut command set** | `open_match(index)` + `close`. Defer `next_page` / `refine_query` | Smallest set proving "search → act → close" loop. Pagination only matters past the truncation cap |
| **edit failure shape** | Sync error string returned via standard exec-result-as-error path. No new failure window | Keeps model simple. Error names file, the failing oldString (or array index), and reason (not found / not unique) so LLM can self-correct |
| **Edit applies immediately to disk** | No buffered draft state on file_window | Adding draft state would create rollback questions out of scope; sync write matches existing patterns and Claude Code |
| **Edit matches Claude Code's "exact unique substring" rule** | oldString must appear exactly once in the file; otherwise reject | Same precision Claude Code provides; prevents accidental partial edits |
| **Glob uses Bun's `Glob`; grep uses `rg` if available, else fallback** | Bun's built-in glob; rg JSON output when available, JS recursive-walk + RegExp fallback | Avoids new dependencies; rg gives best UX; fallback ensures portability |
| **No path safety boundary in v1** | edit / write_file / glob / grep accept any path the worker can touch | OOC is single-tenant developer tool today; permission model tracked separately. Documented limitation |
| **Anti-pattern note in program knowledge** | One paragraph: "to modify or create files, prefer file_window.edit / root.write_file. Use program(shell) only for transient computation that doesn't mutate the worktree" | LLM has demonstrated propensity to revert to shell habits; explicit note in protocol KNOWLEDGE prevents that |

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Data flow** for the four new commands:

```
LLM open(command="glob", args={ pattern: "src/**/*.ts" })
  ↓ root.glob.exec → Bun's Glob.scanSync → matched paths
  ↓ WindowManager.insertTypedWindow(search_window with results)
  ↓ search_window appears in next render:
    <window type="search" kind="glob">
      <pattern>src/**/*.ts</pattern>
      <matches count="42" truncated="false">
        <match index="0" path="src/foo.ts" />
        ...
      </matches>
    </window>
  ↓ LLM open(parent_window_id="<sw>", command="open_match", args={ index: 5 })
  ↓ search_window.open_match.exec → spawn file_window at matched path
```

**file_window.edit shape**:

```
edit(file_window, args={ old: "...", new: "..." })
  → read file → confirm `old` appears exactly once → replace → write
  → return undefined OR error string

edit(file_window, args={ edits: [{old:A,new:A'}, {old:B,new:B'}] })
  → read file once into buffer
  → for each edit: confirm `old` appears exactly once in CURRENT buffer (post prior edits) → apply
  → if any edit fails: don't write, return error naming the failing index
  → otherwise: write entire result
```

**search_window structure**:

```ts
interface SearchWindow extends BaseContextWindow {
  type: "search";
  status: "open" | "closed";
  kind: "glob" | "grep";
  query: string;             // pattern for glob, regex/literal for grep
  matches: SearchMatch[];    // truncated at 200
  truncated: boolean;
}
interface SearchMatch {
  index: number;             // stable index for open_match(index)
  path: string;
  line?: number;             // grep only
  snippet?: string;          // grep only, trimmed to 200 chars
}
```

---

## Output Structure

```
src/executable/windows/
├── search.ts                            # NEW: search_window type registration + close + open_match commands + basicKnowledge
├── file.ts                              # MODIFY: add `edit` command
├── types.ts                             # MODIFY: add SearchWindow + SearchMatch; add "search" to WindowType + generateWindowId
└── root/
    ├── write-file.ts                    # NEW
    ├── glob.ts                          # NEW
    ├── grep.ts                          # NEW
    ├── program.ts                       # MODIFY: append anti-pattern note to KNOWLEDGE
    └── index.ts                         # MODIFY: register write_file/glob/grep in ROOT_COMMANDS; update ROOT_KNOWLEDGE table
src/thinkable/context/
└── render.ts                            # MODIFY: add renderSearchWindowChildren branch
src/executable/__tests__/
└── fs-search.test.ts                    # NEW: U1–U6 unit + integration tests
meta/object/executable/
├── windows/search-window.doc.js         # NEW
├── actions/commands/
│   ├── write-file.doc.js                # NEW
│   ├── glob.doc.js                      # NEW
│   ├── grep.doc.js                      # NEW
│   └── index.doc.js                     # MODIFY: rows for new commands
└── index.doc.js                         # MODIFY: register concepts.windows.searchWindow
```

---

## Implementation Units

### U1. SearchWindow type + render + basicKnowledge

**Goal**: Land the new window type (no commands creating it yet) so subsequent units have a stable target.

**Requirements**: origin §Goal; §Success criteria 2 & 3

**Dependencies**: none

**Files**:
- `src/executable/windows/types.ts`
- `src/executable/windows/search.ts` (new)
- `src/thinkable/context/render.ts`
- `src/executable/__tests__/fs-search.test.ts` (new)

**Approach**:
- Add `"search"` to WindowType; add SearchWindow + SearchMatch interfaces; extend ContextWindow union; add `search` prefix to generateWindowId
- search.ts: registerWindowType with `{ commands: { close }, basicKnowledge, onClose: undefined }`. close is no-op exec
- render.ts: `case "search": children.push(...renderSearchWindowChildren(window))`
- renderSearchWindowChildren emits `<window type="search" kind=...><query>...</query><matches count="N" truncated="...">…</matches></window>`. Matches truncated at 200; snippets trimmed to 200 chars
- basicKnowledge text covers: when search_window appears, available commands (close in U1; open_match noted as coming in U4), match index → open_match flow

**Patterns to follow**:
- `src/executable/windows/talk.ts` — registerWindowType + basicKnowledge shape
- `src/executable/windows/file.ts` — minimal window with close
- `src/thinkable/context/render.ts:248-296` — renderProgramWindowChildren / renderFileWindowChildren

**Test scenarios**:
- Happy: `getWindowTypeDefinition("search")` returns definition with non-empty commands and basicKnowledge
- `generateWindowId("search")` returns id starting with `w_search_`
- Render: search_window with 3 grep matches → `<window type="search" kind="grep">` with `<matches count="3">` and 3 child match elements
- Edge: empty matches → `<matches count="0" truncated="false">`
- Edge: 250 matches → `count="200" truncated="true"` (only first 200 emitted)
- close: WindowManager.close on a search_window removes it

**Verification**: bun test fs-search.test.ts U1 group passes; bun tsc --noEmit clean

---

### U2. file_window.edit command

**Goal**: Add `edit` command to file_window — single + array form, atomic-or-fail, exact-unique match.

**Requirements**: origin §Success criteria 1 (rename across files via file_window.edit)

**Dependencies**: none (independent of U1 but landed after for natural ordering)

**Files**:
- `src/executable/windows/file.ts` — add editCommand + EDIT_KNOWLEDGE
- `src/executable/__tests__/fs-search.test.ts`

**Approach**:
- editCommand.exec validates parentWindow.type === "file"; reads ctx.parentWindow.path
- Accept either `args.old + args.new` (single) OR `args.edits: [{old,new}, ...]` (array)
- For array: apply sequentially against in-memory buffer; each `old` must match exactly once in current buffer state
- On any failure: no write; return error string naming the file, edit index (for array form), and reason
- On success: writeFile back; return undefined
- EDIT_KNOWLEDGE text: explains both forms, atomic semantics, exact-unique rule, examples, "this is the right way to modify files"

**Patterns to follow**:
- `src/executable/windows/file.ts` setRangeCommand
- `src/executable/windows/root/program.ts` error result conventions

**Test scenarios** (single edit + multi-edit atomic-or-fail):
- Happy: single old→new, file content updated on disk
- Happy: array of 2 edits applies both; final file contains both replacements
- Edge: oldString not found → error contains "not found", file untouched
- Edge: oldString matches multiple times → error contains "matches" + count, file untouched
- Edge: array form, edit #2 fails after edit #1's transformation → none applied (atomic)
- Edge: parentWindow type is not file → error "未挂载在 file_window 上"
- Edge: missing args.old AND missing args.edits → error names missing field
- Error: file does not exist on disk → fs surface error
- Edge: `new === old` → no-op replace, succeeds
- Edge: array form, edit #2's `old` is a substring only present *after* edit #1 ran (sequential application)

**Verification**: 10 scenarios pass; bun tsc clean

---

### U3. root.write_file command

**Goal**: Add root.write_file — create / overwrite a file + auto-spawn file_window pointing at it.

**Requirements**: origin §Goal (Write equivalent)

**Dependencies**: U2 (auto-spawned file_window must support .edit immediately)

**Files**:
- `src/executable/windows/root/write-file.ts` (new)
- `src/executable/windows/root/index.ts` — register; update ROOT_KNOWLEDGE table
- `src/executable/__tests__/fs-search.test.ts`

**Approach**:
- Args: `path` (required), `content` (required); mkdir parents if missing
- match: `["write_file"]`
- knowledge: KNOWLEDGE text + INPUT prompt when args missing
- exec: write file; on success, spawn file_window via ctx.manager.insertTypedWindow with path set; return undefined
- On failure (permission etc.): return error string with surface message

**Patterns to follow**:
- `src/executable/windows/root/open-file.ts` — same shape (KNOWLEDGE + match + knowledge + exec spawning file_window)

**Test scenarios** (create + overwrite + auto-spawn):
- Happy: { path, content } writes to disk; file_window appears in thread.contextWindows pointing at path
- Happy: overwriting existing file replaces content
- Edge: parent dir doesn't exist → mkdir -p creates it
- Edge: missing path → error
- Edge: missing content → error
- Edge: empty string content → 0-byte file written successfully
- Auto-spawn: exactly one new file_window with `path === args.path` after success

**Verification**: 7 scenarios pass; bun test green; bun tsc clean

---

### U4. root.glob + search_window.open_match

**Goal**: root.glob produces search_window; open_match makes results actionable by spawning file_window at a matched path.

**Requirements**: origin §Goal (Glob); §Success criteria 2

**Dependencies**: U1, U3 (file_window auto-spawn pattern reused)

**Files**:
- `src/executable/windows/root/glob.ts` (new)
- `src/executable/windows/root/index.ts`
- `src/executable/windows/search.ts` — add openMatchCommand
- `src/executable/__tests__/fs-search.test.ts`

**Approach**:
- globCommand.exec: args `pattern` (required), optional `cwd` (default process.cwd()); use Bun `new Glob(pattern).scanSync({ cwd, onlyFiles: true })`
- Sort matches; truncate at 200; create SearchWindow `kind: "glob"`, `query: pattern`, matches with `index + path` only (no line/snippet)
- openMatchCommand.exec: validates parentWindow.type === "search"; reads `args.index`; looks up match; spawns file_window at matched path
- Errors: invalid glob → error string; index out of range → error; missing index → error

**Patterns to follow**:
- `src/executable/windows/root/open-file.ts`
- U3's write-file.ts once written

**Test scenarios** (find files + open matched):
- Happy: glob `*.ts` in tempdir with 3 .ts files → search_window with 3 sorted matches
- Happy: glob `**/*.ts` recursive
- Edge: no matches → empty matches array, truncated false
- Edge: 250 matches → truncated to 200, flag true
- Edge: invalid glob pattern → error string
- open_match happy: 3 matches, open_match(index: 1) spawns file_window at second match's path
- open_match edge: index 99 with 3 matches → "match index out of range" error
- open_match edge: missing index → error
- Integration: glob → open_match → file_window in place; no shell invoked

**Verification**: 9 scenarios pass; bun test green; bun tsc clean

---

### U5. root.grep command

**Goal**: root.grep content search → search_window with `kind: "grep"`, populated with line + snippet.

**Requirements**: origin §Goal (Grep); §Success criteria 2

**Dependencies**: U4 (search_window infra fully wired; open_match ready)

**Files**:
- `src/executable/windows/root/grep.ts` (new)
- `src/executable/windows/root/index.ts`
- `src/executable/__tests__/fs-search.test.ts`

**Approach**:
- Args: `pattern` (regex string, required); `path` (optional, default cwd); `glob` (optional file filter); `case_insensitive` (optional bool)
- Try `rg --json --no-heading [-i] [-g GLOB] PATTERN PATH` via Bun.spawnSync; parse JSON-lines output
- Fallback when rg not available: recursive walk path; for each file, read line-by-line; RegExp test
- Each match → SearchMatch with path, line, snippet (matched line trimmed to 200 chars)
- Sort by path then line; truncate at 200; flag truncated
- Errors: invalid regex → error string

**Patterns to follow**:
- U4's glob.ts
- `src/executable/windows/program-runtime.ts` — Bun.spawn usage if needed

**Test scenarios** (find usages + truncation + fallback):
- Happy: grep `function foo` in tempdir with one match → 1 match including line + snippet
- Happy: across multiple files → matches sorted by path then line
- Happy: case_insensitive matches both Foo and foo
- Edge: no matches → empty
- Edge: invalid regex → error string naming the regex error
- Edge: 300 matches → truncated to 200, flag true
- Edge: path is a single file (not dir) → still works
- Integration: grep → open_match (cross-test confirming no break)
- Fallback parity: when shelling rg disabled (test forces fallback), JS path returns equivalent shape on a small corpus

**Verification**: 9 scenarios pass; bun test green; bun tsc clean

---

### U6. Anti-pattern note in program command knowledge

**Goal**: Append a paragraph to program KNOWLEDGE telling LLM to prefer file_window.edit / write_file over shell file mutation.

**Requirements**: origin §Open question 5 (resolved: yes)

**Dependencies**: U2 + U3

**Files**:
- `src/executable/windows/root/program.ts` — append paragraph to KNOWLEDGE
- `src/executable/__tests__/fs-search.test.ts` — substring guard

**Approach**: Append a "## 建议" section to the existing KNOWLEDGE constant. Content names file_window.edit + root.write_file as preferred, marks shell sed/awk/cat-redirect as anti-pattern.

**Patterns to follow**: talk_window basicKnowledge "**关键提醒**" callout shape from earlier this week

**Test scenarios**:
- Assertion: program command's knowledge() output for some args contains substring "file_window.edit" — regression guard against silent deletion

**Verification**: 1 assertion passes

---

### U7. Meta concept docs for new commands and search_window

**Goal**: Add meta concept files mirroring new command/window so `bun test meta/` enforces binding (per the 2026-05-15 concept-graph convention).

**Requirements**: origin §Related; convention from `docs/solutions/conventions/meta-concept-graph-2026-05-15.md`

**Dependencies**: U1, U3, U4, U5 (concept docs reference the source modules these create)

**Files**:
- `meta/object/executable/windows/search-window.doc.js` (new) — sources: `windows/search`
- `meta/object/executable/actions/commands/write-file.doc.js` (new) — sources: `windows/root/write-file`
- `meta/object/executable/actions/commands/glob.doc.js` (new) — sources: `windows/root/glob`
- `meta/object/executable/actions/commands/grep.doc.js` (new) — sources: `windows/root/grep`
- `meta/object/executable/index.doc.js` — register `concepts.windows.searchWindow`
- `meta/object/executable/actions/commands/index.doc.js` — add table rows for write_file / glob / grep

**Approach**:
- Each new doc.js: { name, description, sources: { ... } } per concept schema
- search-window.doc.js mirrors talk-window.doc.js shape
- Per `docs/solutions/conventions/agent-doc-work-verify-as-you-go-2026-05-15.md`: run `bun tsc --noEmit` after each new doc.js before moving to the next

**Patterns to follow**:
- `meta/object/executable/windows/talk-window.doc.js`
- `meta/object/executable/actions/commands/talk.doc.js`

**Test scenarios**:
- `bun test meta/__tests__/concept-links.test.ts` collects 18 concepts (was 17; +1 for searchWindow)
- `executable_v....concepts.windows.searchWindow.sources.search` accessible at runtime
- Manual experiment (not automated): mv src/executable/windows/search.ts /tmp; bun tsc --noEmit fails in search-window.doc.js; restore

**Verification**: meta concept-links test green; tsc clean

---

## Risks / Mitigations

| 风险 | 缓解 |
|---|---|
| edit's "exact unique substring" rule can frustrate LLM when oldString accidentally non-unique | Error message names occurrence count + suggests adding more surrounding context. LLM has been observed to recover from similar Claude Code feedback |
| MultiEdit atomic-or-fail can silently mask intent if the LLM expects partial-apply semantics | EDIT_KNOWLEDGE explicitly documents atomic-or-fail; failure error names the failing index so LLM knows which edit broke the batch |
| rg JSON parsing differs across rg versions | Pin a minimum rg version in fallback heuristic (if first row of JSON output doesn't parse, fall back to JS); add to KNOWLEDGE |
| search_window match limit of 200 may surprise users on very large grep results | `truncated: true` flag visible to LLM; basicKnowledge mentions it; refining the query is the V1 answer |
| Path safety: file_window.edit / write_file accept any path including outside cwd | Documented limitation; user accepts it for v1 (single-tenant dev tool); permission model is its own future plan |
| Interference with existing file_window users (set_range / reload) | edit is purely additive; existing commands unchanged; tests cover both |

---

## System-Wide Impact

- **5 原语**: zero change
- **Existing 8 root commands**: zero change to behavior; ROOT_KNOWLEDGE table grows by 3 rows; program KNOWLEDGE gains a paragraph
- **WindowType union**: gains `"search"`; ContextWindow union extends; SearchWindow + SearchMatch types added
- **Render layer** (`src/thinkable/context/render.ts`): one new switch arm
- **bun test**: ~50 new test scenarios across U1-U6; meta test count climbs from 17 → 18
- **bun tsc --noEmit**: should remain clean (only pre-existing ui/service.ts Dirent noise)
- **No frontend impact**: web UI doesn't currently render search_window specially; the generic ContextSnapshotViewer will display it as another window with type=search until a custom renderer is added (out of scope; tracked as natural future work)

---

## Open Questions Resolved

From origin §Open questions for /ce-plan:

1. **write_file form** → root command + auto-spawn file_window. Reasoning: forcing open of a non-existent file is awkward
2. **MultiEdit support** → yes, via array form `{ edits: [...] }`, atomic-or-fail
3. **search_window first-cut commands** → `open_match` + `close` only. Defer next_page / refine_query
4. **edit failure form** → sync error string via standard exec-result-as-error path. No new failure window
5. **shell-as-edit anti-pattern** → yes, append note to program KNOWLEDGE recommending file_window.edit / write_file

---

## Verification (overall)

- `bun test` overall green (existing + ~50 new scenarios pass)
- `bun tsc --noEmit` clean (only pre-existing ui/service.ts Dirent noise)
- `bun test meta/` 7 pass (one new test count for searchWindow concept)
- Manual smoke: in a tempdir, `glob` finds files → `open_match` spawns file_window → `edit` modifies in place → on-disk file matches expected content; entire flow uses zero shell calls
- Manual smoke: `write_file` creates a file in a fresh subdirectory; subsequent edit on the auto-spawned file_window works
- Manual experiment: rename `src/executable/windows/search.ts` → `bun tsc --noEmit` immediately breaks `meta/object/executable/windows/search-window.doc.js`

# Agent of Programmable

I am responsible for the programmable dimension: all capabilities that allow an OOC Object to reprogram itself. This includes the metaprog command flow for writing server/index.ts methods, the write_file gated mechanism for safe stone modifications, client/index.tsx slot injection for custom UI slices, and server hot-reload after self-modification.

## repo_* Self-Iteration Capability (Round 10)

The root prototype exposes seven `repo_*` methods that grant full read/write access to the OOC-3 source tree. These enable an OOC Agent to modify the system it runs on.

### Available methods

| Method | Purpose |
|--------|---------|
| `repo_read({ path })` | Read any file relative to repo root (truncates at 50KB) |
| `repo_write({ path, content })` | Write any file relative to repo root; auto-creates parent dirs; appends audit entry to `flows/<s>/objects/<self>/repo-writes.jsonl` |
| `repo_run_tsc()` | Run `bunx tsc --noEmit` from repo root; returns `{ ok, exit_code, errors_count, output }` |
| `repo_run_tests({ pattern? })` | Run `bun test [pattern]` from repo root (120s timeout); returns `{ ok, exit_code, stdout, stderr }` |
| `repo_git_diff({ path? })` | `git diff [path]`; returns `{ ok, diff }` (truncated at 16KB) |
| `repo_git_status()` | `git status --short`; returns `{ ok, status }` |
| `repo_git_commit({ message, files? })` | Stage and commit; forces `[ooc-iteration]` prefix + `Iterated-By:` footer; does NOT push |

### Recommended iteration workflow

```
1. repo_read(target file)           — understand current state
2. repo_write(target, new content)  — apply change
3. repo_run_tsc()                   — check for type errors (exit_code must be 0)
4. repo_run_tests(pattern?)         — confirm tests still pass
5. repo_git_status()                — confirm only expected files changed
6. repo_git_commit(message)         — commit with [ooc-iteration] prefix
```

Never commit if `repo_run_tsc` or `repo_run_tests` return a non-zero exit code.

### Safety constraints

- All paths are validated to stay within REPO_ROOT (walk-up `.git` detection at module load).
- Every `repo_write` is audit-logged to `flows/<sessionId>/objects/<self>/repo-writes.jsonl`.
- `repo_git_commit` never pushes — a human reviews before pushing.
- Do not write to `.git/` directly; do not modify `bun.lock` during an iteration.

### When to use vs metaprog / write_file

- `metaprog` + `write_file`: scoped to the Object's own stone dir (`stones/<branch>/objects/<self>/`).
- `repo_*`: full repo scope — use when the change spans `src/`, `web/src/`, `meta/`, `stones/`, or config files.
- Prefer the narrower tool when possible; escalate to `repo_*` when the scope requires it.

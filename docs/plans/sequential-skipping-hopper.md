# OOC Bun Workspace Monorepo Plan

## Context

### Why this change
The current persistence design uses a custom `stones/` directory hierarchy with git bare repo + worktree management. The user wants to replace this entirely with **bun workspace (monorepo)** as the persistence layer. Each OOC object becomes a standard bun package, and the object tree hierarchy maps directly to workspace glob patterns.

### Explicit requirements
1. **Workspaces config**: `"workspaces": ["packages/**", "packages/**/children/**"]` in root `package.json`
2. **Every OOC object → bun package**: objects previously in `stones/` become packages
3. **Reorganize both source AND world objects**: not just runtime data, but the OOC source code itself becomes a monorepo
4. **Object tree mapping**: `children/` physical marker for nested objects maps to `packages/**/children/**` glob
5. **Forget current design**: clean-slate redesign, no dual-read/migration patterns

### Key constraints identified
- No existing bun workspaces configuration
- Current stones are gitignored (in `.ooc-world/`), runtime-only
- Nested object IDs use `/` separator → physical `children/` directories between segments
- Bun workspaces support full glob syntax, including `**` and negative patterns
- Nested workspaces are handled via root-level glob patterns (not nested `workspaces` fields)
- Workspace packages need `package.json` with at least `name` and `version`
- Bun `workspace:*` protocol allows cross-package dependencies

---

## Final Design: Single Workspace Root

One monorepo workspace root contains **both** source packages (git-tracked) and world object packages (gitignored runtime data).

### Directory Structure

```
<workspace-root>/                      # e.g., repo root, or --world directory
├── package.json                       # workspaces: ["packages/**", "packages/**/children/**"]
├── bun.lock                           # single lockfile for all packages
├── tsconfig.json                      # references all packages
├── .gitignore                         # ignores packages/* (but !packages/@ooc/)
│
├── packages/
│   │
│   ├── @ooc/                          # Source packages (git-tracked)
│   │   ├── core/                      # ← moved from src/
│   │   │   ├── package.json           # name: "@ooc/core"
│   │   │   ├── thinkable/
│   │   │   ├── executable/
│   │   │   ├── observable/
│   │   │   ├── persistable/
│   │   │   ├── app/
│   │   │   └── extendable/
│   │   │
│   │   ├── web/                       # ← moved from web/
│   │   │   ├── package.json           # name: "@ooc/web"
│   │   │   └── src/
│   │   │
│   │   ├── meta/                      # ← moved from meta/
│   │   │   ├── package.json           # name: "@ooc/meta"
│   │   │   └── *.doc.ts
│   │   │
│   │   ├── tests/                     # ← moved from tests/
│   │   │   ├── package.json           # name: "@ooc/tests"
│   │   │   ├── e2e/
│   │   │   └── integration/
│   │   │
│   │   ├── builtin-root/              # Builtin objects (git-tracked)
│   │   ├── builtin-do/                # Each is a full package with
│   │   ├── builtin-talk/              # executable/ visible/ readable/ self.md
│   │   ├── builtin-knowledge/
│   │   ├── builtin-file/
│   │   ├── builtin-command-exec/
│   │   ├── builtin-plan/
│   │   ├── builtin-program/
│   │   ├── builtin-search/
│   │   ├── builtin-skill-index/
│   │   ├── builtin-todo/
│   │   └── builtin-custom/
│   │
│   ├── supervisor/                    # World objects (gitignored, runtime)
│   │   ├── package.json               # name: "@ooc-obj/supervisor"
│   │   ├── self.md
│   │   ├── readable.md
│   │   ├── executable/index.ts
│   │   ├── visible/index.tsx
│   │   └── knowledge/
│   │
│   ├── user/                          # name: "@ooc-obj/user"
│   ├── sentry/                        # name: "@ooc-obj/sentry"
│   │   └── children/
│   │       ├── sentry_factor_dev/     # name: "@ooc-obj/sentry-factor-dev"
│   │       └── sentry_event_factor/   # nested via children/ marker
│   │
│   └── agent_of_thinkable/            # All 8 AgentOfX objects
│       └── ...
│
├── flows/                             # Runtime session state (was .ooc-world/flows/)
│   └── <sessionId>/
│       └── objects/
│           └── <objectId>/            # uses children/ for nesting
│               ├── context/           # runtime-created objects
│               └── threads/
│
└── pools/                             # Cross-session sediment (was .ooc-world/pools/)
    └── objects/
        └── <objectId>/
            ├── data/
            ├── files/
            └── knowledge/
```

### Package.json for Object Packages

Every object package (builtin or world) has a `package.json`:

```json
{
  "name": "@ooc-obj/sentry-factor-dev",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "ooc": {
    "objectId": "sentry/sentry_factor_dev",
    "type": "agent",
    "parent": "sentry"
  }
}
```

### Root package.json

```json
{
  "name": "ooc-workspace",
  "private": true,
  "type": "module",
  "workspaces": ["packages/**", "packages/**/children/**"],
  "scripts": {
    "test": "bun test",
    "dev": "bun run packages/@ooc/core/app/server/index.ts"
  },
  "dependencies": {
    "@ooc/core": "workspace:*",
    "@ooc/web": "workspace:*"
  }
}
```

### .gitignore

```
# Ignore all world object packages (runtime-only)
packages/*
!packages/@ooc/

# Runtime state
flows/
pools/

# Existing ignores
node_modules/
*.log
web/dist/
```

### World Directory Concept Redefined

The `--world` flag still exists but now points to **any directory containing `packages/`, `flows/`, and `pools/` subdirectories**. This could be:
- The repo root itself (for development)
- A separate directory like `./ooc-world-prod/` (for production)
- A temporary directory (for tests)

The server config's `baseDir` = the world directory = workspace root.

---

## Implementation Plan (13 phases)

### Phase 1: Root workspace setup
- Add `workspaces` field to root `package.json`
- Update `.gitignore` to ignore runtime packages but keep `@ooc/` source packages
- Run `bun install` to initialize workspace

### Phase 2: Source code → packages/@ooc/
- Move `src/` → `packages/@ooc/core/`
- Move `web/` → `packages/@ooc/web/`
- Move `meta/` → `packages/@ooc/meta/`
- Move `tests/` → `packages/@ooc/tests/`
- Create `package.json` for each source package
- Update all import paths (`@src/` → `@ooc/core/`, etc.)
- Update `tsconfig.json` paths and includes

### Phase 3: Builtin objects → packages/@ooc/builtin-*
- Move contents of `src/extendable/base/<type>/` → `packages/@ooc/builtin-<type>/`
- For each builtin (12 types):
  - Create `package.json` with appropriate `ooc.objectId`
  - Keep `executable/index.ts`, `visible/index.tsx`, `types.ts`
  - Add `self.md`, `readable.md` (minimal)
- Update `registerObjectType()` to load from workspace package paths
- Update `src/extendable/base/` to be thin re-exports from builtin packages (backward compat)

### Phase 4: Persistence layer rewrite (stoneDir → packageDir)
- **Rewrite** `src/persistable/common.ts`:
  - `stoneDir(ref)` → `packageDir(ref)`: resolves to `<baseDir>/packages/<nestedPath(objectId)>/`
  - Remove `STONE_OBJECTS_SUBDIR` (was `"objects"`)
  - Keep `nestedObjectPath()` (unchanged logic, still inserts `children/`)
  - Keep `STONE_CHILDREN_SUBDIR = "children"` (now matches workspace glob)
- **Rewrite** all path functions:
  - `readableFile(ref)` → `packageDir(ref)/readable.md`
  - `executableDir(ref)` → `packageDir(ref)/executable`
  - `visibleDir(ref)` → `packageDir(ref)/visible`
  - `stoneKnowledgeDir(ref)` → `packageDir(ref)/knowledge`
  - `stoneChildrenDir(ref)` → `packageDir(ref)/children`
- **Remove**: `stoneMetadataFile()`, `createStoneObject()`'s `.stone.json` creation (replaced by `package.json`)
- **Update**: `createStoneObject()` → `createObjectPackage()` - creates minimal package skeleton with `package.json`, `self.md`, `readable.md`

### Phase 5: Object discovery rewrite
- **Rewrite** `discoverStoneHierarchicalPeers()` → `discoverPeerPackages()`
  - Scan `<baseDir>/packages/` for directories containing `package.json` with `ooc.objectId`
  - Siblings: same parent level, excluding `@ooc/` and `children/`
  - Children: scan `packageDir(ref)/children/` for packages
- **Update** `derivePeerObjectWindows()` to use new discovery
- **Update** flows service `walkObjectDir()` to scan `packages/` for `package.json` markers

### Phase 6: Builtin object loading
- **Rewrite** `loadObjectWindow()` to import from workspace package paths
- Builtins can be referenced by `@ooc/builtin-<type>` (via `workspace:*` dependencies)
- Update `loader.ts` to handle both `@ooc/builtin-*` imports and dynamic imports from world packages

### Phase 7: Flows & Pools restructure
- Move flows persistence from `.ooc-world/flows/` → `<baseDir>/flows/`
- Move pools persistence from `.ooc-world/pools/` → `<baseDir>/pools/`
- Update all path references in:
  - `src/persistable/flow-context.ts`
  - `src/persistable/thread-json.ts`
  - `src/app/server/modules/flows/service.ts`

### Phase 8: Stone bootstrap removal
- Remove `stone-bootstrap.ts` and all bare repo / worktree management code
- Remove `_builtin/` special branch (builtins are now regular packages in `@ooc/`)
- Remove `stonesBranch` concept entirely (no more git branches for stones)
- **Simplify** `ServerConfig`: remove `stonesBranch` field

### Phase 9: Skills & branch-level concepts
- Branch-level `skills/` → `packages/@ooc/skills/<name>/` (git-tracked)
- Branch-level `pkgs/` → `packages/@ooc/pkgs/<name>/` (git-tracked)
- Branch-level `knowledge/` → `packages/@ooc/knowledge/` (git-tracked)
- Update all skill loading paths in `stone-skills.ts`

### Phase 10: Runtime object persistence (context/)
- Update `flow-context.ts` paths to work with new structure
- `contextDir()` resolves to `<baseDir>/flows/<sessionId>/objects/<nestedPath>/context/`
- Keep dual-write pattern but simplify paths (no `objects/` intermediate dir)

### Phase 11: Import path updates across codebase
- Update all `@src/*` imports → `@ooc/core/*`
- Update all relative imports that cross package boundaries
- Update `tsconfig.json` paths:
  ```json
  "paths": {
    "@ooc/core/*": ["packages/@ooc/core/*"],
    "@ooc/web/*": ["packages/@ooc/web/src/*"],
    "@ooc/meta/*": ["packages/@ooc/meta/*"],
    "@ooc/builtin-*": ["packages/@ooc/builtin-*/*"]
  }
  ```

### Phase 12: Scripts & CI
- Update root `package.json` scripts to use workspace package paths
- Update `scripts/check-*.sh` to scan `packages/`
- Update `tsconfig.json` includes to cover all packages

### Phase 13: Verification & cleanup
- Run `bun install` to validate workspace setup
- Run `bun tsc --noEmit` to validate types
- Run `bun test` to validate all tests pass
- Run e2e tests to validate full stack
- Remove old `src/extendable/base/` re-export shims (final cleanup)

---

## Critical Files to Modify (Patterns)

### Path resolution (all in `src/persistable/`)
- `common.ts` - `stoneDir()` → `packageDir()`, remove `STONE_OBJECTS_SUBDIR`
- `stone-object.ts` - `createStoneObject()` → `createObjectPackage()`, discovery rewrite
- `stone-readme.ts` - path functions update
- `stone-server.ts` - path functions update
- `stone-client.ts` - path functions update
- `stone-skills.ts` - skill path updates
- `flow-context.ts` - flows path updates
- `thread-json.ts` - thread path updates

### Discovery & loading
- `src/executable/server/loader.ts` - load from workspace packages
- `src/thinkable/knowledge/synthesizer.ts` - peer discovery update
- `src/app/server/modules/flows/service.ts` - flows path updates

### Configuration
- Root `package.json` - add workspaces, update scripts
- `tsconfig.json` - update paths and includes
- `.gitignore` - update for new structure
- `src/app/server/bootstrap/config.ts` - remove `stonesBranch`, update `baseDir` semantics

---

## Verification Plan

### Unit tests (bun test)
1. `packages/@ooc/core/persistable/__tests__/common.test.ts` - test `packageDir()` with nested paths
2. `packages/@ooc/core/persistable/__tests__/flow-context.test.ts` - context IO with new paths
3. `packages/@ooc/core/thinkable/knowledge/__tests__/peer-object-derive.test.ts` - peer discovery
4. All existing tests should pass with new paths

### Integration test
```bash
# Create test world in temp dir
mkdir -p /tmp/ooc-test/packages/test-agent
echo '{"name":"@ooc-obj/test-agent","version":"0.1.0","ooc":{"objectId":"test-agent"}}' > /tmp/ooc-test/packages/test-agent/package.json

# Start server with test world
bun run packages/@ooc/core/app/server/index.ts --world /tmp/ooc-test

# Verify API returns objects from packages/
curl http://localhost:3000/api/objects/_shared/types
```

### E2E tests
- `tests/e2e/backend/` - run with `--world` pointing to test workspace
- `tests/e2e/frontend/` - verify UI loads object packages correctly

### Manual checks
- `bun pm ls` should list all workspace packages
- `bun install` completes without errors
- Cross-package imports work (`import { x } from "@ooc/core/..."`)

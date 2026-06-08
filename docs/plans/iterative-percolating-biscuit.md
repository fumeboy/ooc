# Plan: OOC World/Core 接口、CLI 与热更新基础设施

## Context

当前 OOC 源码仓（`ooc-2`）是一个 monorepo，包含 runtime（`@ooc/core`）、内置对象（`@ooc/builtins/*`）、前端（`@ooc/web`）和文档（`@ooc/meta`）。启动方式分散：`bun run packages/@ooc/core/app/server/index.ts --world ./.ooc-world` 启动后端，另开终端 `OOC_WORLD_DIR=... bunx vite` 在 `packages/@ooc/web/` 启动前端。

下一步 OOC Core 将发布到 npm，用户在本地创建独立的 OOC World 目录。这需要：
1. 清晰的 World/Core 接口契约（World 是一个 Bun workspace monorepo，用 `stones/` 目录放用户 Agent）。
2. `@ooc/cli` 提供 `ooc init/dev/build/start` 作为唯一入口。
3. Stone 热更新（executable/visible/readable/knowledge 变更即时生效，身份变更走懒迁移）。
4. Core 内部消灭 module-level singleton，用 `WorldRuntime` 封装（支持多 World，也方便测试）。

完整设计见 `packages/@ooc/meta/world-core-interface-and-hot-reload.md`（已产出）。

## 命名澄清：`stones/` 目录

`.ooc-world/stones/` 已经存在，但它目前承载的是元编程版本化系统（`stones/main/objects/<id>/` 按 git branch 分层；`_stonesBranch` 为 undefined 时 `packageDir()` 仍然回退到 `{baseDir}/packages/`）。本计划的 M2 要做的是：**默认路径也走 `stones/`（扁平的 `stones/<objectId>/`，不嵌套 branch/objects），`packages/` 作为兼容 fallback 至少一个版本后删除。** 版本化分支路径（`stones/<branch>/objects/`）保留，不与扁平路径冲突。

---

## Phase M0：@ooc/cli 骨架（纯包装，不改架构）

**目标**：`ooc dev` 作为一条命令同时启动后端和前端。证明 CLI 包形态能跑通。

**创建**：
- `packages/@ooc/cli/package.json` — `bin: { "ooc": "src/index.ts" }`，`type: module`，`private: true`。
- `packages/@ooc/cli/src/index.ts` — shebang `#!/usr/bin/env bun`，argv dispatch。
- `packages/@ooc/cli/src/commands/dev.ts`。

**dev.ts 做什么**：
1. 解析 `--world` / `OOC_WORLD_DIR`（默认 `.`），resolve 为绝对路径。
2. spawn 子进程 A：`bun run <repo-root>/packages/@ooc/core/app/server/index.ts --world <absWorld>`。
3. spawn 子进程 B：在 `<repo-root>/packages/@ooc/web` 目录下执行 `bunx vite`，环境变量 `OOC_WORLD_DIR=<absWorld>` 透传。
4. 两者 stdio inherit；SIGINT/SIGTERM 时 kill 两个子进程。

**验证**：
```bash
bun install
OOC_WORLD_DIR=$PWD/.ooc-world bun run packages/@ooc/cli/src/index.ts dev
# 浏览器访问 Vite 默认端口 → 页面正常；/api/health 由代理返回 200；能创建 thread 并跑通一轮 thinkloop
```

---

## Phase M1：`WorldRuntime` 封装——消灭 module-level singleton（地基，最高风险）

**目标**：所有 per-world 状态进入 `WorldRuntime` 实例。所有现有调用点通过 backward-compat 包装函数继续工作，**零破坏**。

**创建**：
- `packages/@ooc/core/runtime/world-runtime.ts` — `WorldRuntime` 类 + `createWorldRuntime({ worldPath, config? })` 工厂。
- `packages/@ooc/core/runtime/object-registry.ts` — `ObjectRegistry` 类（从 registry.ts 抽出）。
- `packages/@ooc/core/runtime/observable-store.ts` — `ObservableStore` 类（从 observable/index.ts 抽出）。

**修改**（统一模式：抽类 → module-level 保留默认实例 → 导出包装函数）：

1. **`packages/@ooc/core/executable/windows/_shared/registry.ts`**
   - 抽出 `ObjectRegistry` 类，持有 REGISTRY Map 和所有 register/get/resolve 方法。
   - module-level 保留 `const defaultRegistry = new ObjectRegistry()`，预填 base types（root、command_exec、method_exec…）。
   - 所有现有导出函数（`registerWindowType`、`getObjectDefinition` 等）变成 defaultRegistry 上方法的 thin wrapper。
   - 新增 `export function createObjectRegistry(): ObjectRegistry`（deep-copy 默认条目或重放 builtin 注册）。

2. **`packages/@ooc/core/observable/index.ts`**
   - 抽出 `ObservableStore` 类，持有 `latestLlmObservation`、`debugEnabled`、`loopCounters`、`pauseChecker`、`permissionDecider`、`threadActivationNotifier`。
   - 现有 `enableDebug`、`setPauseChecker` 等导出函数转成 default store 上的方法 wrapper。
   - 新增 `createObservableStore()`。

3. **`packages/@ooc/core/persistable/serial-queue.ts`**
   - 抽出 `SerialQueue` 类（`enqueue(key, task)`、`reset()`）。
   - 保留 `enqueueSessionWrite` 和 `__resetSerialQueueForTests` wrapper。
   - 新增 `createSerialQueue()`。

4. **`packages/@ooc/core/executable/server/loader.ts`**
   - 抽出 `ServerLoader` 类（cache Map + `loadObjectWindow` / `loadUiServerMethods` / `loadObjectReadable` / `clearCache`）。
   - 保留现有命名导出作为 default loader 的 wrapper。
   - 新增 `createServerLoader()`。

5. **caches（低优先级，可放到 M1 末尾）**
   - `persistable/world-config.ts` → `WorldConfigStore` 类。
   - `persistable/stone-skills.ts` → `StoneSkillsStore` 类。
   - `thinkable/knowledge/loader.ts` → `KnowledgeLoader` 类。

6. **`packages/@ooc/core/runtime/world-runtime.ts`**
   ```typescript
   export interface WorldRuntime {
     readonly worldPath: string;
     readonly objects: ObjectRegistry;
     readonly observable: ObservableStore;
     readonly serialQueue: SerialQueue;
     readonly serverLoader: ServerLoader;
     // 后续 M2/M3 在这儿追加 stoneRegistry、worker、httpHandler
     dispose(): Promise<void>;
   }
   ```
   - `createWorldRuntime()` 调所有 `create*()` 工厂返回组合实例。
   - 保留 module-level 的 `let _defaultRuntime: WorldRuntime`，由 `buildServer()` 设置；新增 `getDefaultRuntime()` getter。

7. **`packages/@ooc/core/app/server/index.ts`**
   - `buildServer(config)` 调用 `createWorldRuntime({ worldPath: config.baseDir })`，挂到 Elysia state：`.state("runtime", runtime)`。
   - 当前直接用 module-level 函数（如 `setPauseChecker`）的地方，暂时不改（wrapper 已处理）。迁移到 per-runtime 调用延后到 M2/M3。

**风险与缓解**：
- 大约 50+ 个调用点使用 module-level singleton。——wrapper 模式保证**零调用点修改**，现有行为完全不变。
- Side-effect imports（`extendable/index.ts`）在模块加载时调 `registerWindowType` 写入 default registry。——保留 default registry；每个新 WorldRuntime 创建时从 default registry clone 一份作为基线。
- 测试里的 `__reset*ForTests` helper 仍然存在并作用于 default 实例，测试不受影响。

**验证**：
```bash
bun run verify   # tsc + core tests + 检查脚本
# 手动：ooc dev 创建 thread + 跑几轮 think，行为和 M0 完全一致
```

---

## Phase M2：World/Stone 契约——`stones/` 目录 + StoneRegistry

**目标**：默认 stone 路径从 `packages/` 改为 `stones/<id>/`（扁平）；`StoneRegistry` 统一扫描 builtin（`node_modules/@ooc/builtins/*`）和 user stones（`stones/*`），解析 `package.json#ooc` 元数据。

**创建**：
- `packages/@ooc/core/runtime/stone-registry.ts` — `StoneRegistry` 类。

**修改**：

1. **`packages/@ooc/core/persistable/common.ts`**
   - `packageDir(ref)`：user stone 路径从 `"packages"` 改为 `"stones"`。
   - 双路径兼容：`stones/<id>/` 不存在时 fallback 到 `packages/<id>/`，并 `console.warn`。
   - 职能交换：`stoneDir()` 成为 canonical，`packageDir()` 标注 `@deprecated` 作为 alias。
   - Builtin 路径不变（`_builtin/<type>` 及 supervisor/user 路由），追加对 `stones/_builtin/` 的支持（dogfooding world 镜像用）。

2. **`packages/@ooc/core/runtime/stone-registry.ts`（新）**
   - 扫描两个根：`{worldPath}/stones/` 和 `{worldPath}/node_modules/@ooc/builtins/`。
   - 读取每个候选目录的 `package.json`，过滤含 `ooc.objectId` 且 `ooc.kind ∈ {"stone", "builtin"}` 的条目。
   - 维护 `Map<objectId, StoneDefinition>`，其中 `StoneDefinition = { objectId, kind, dir, pkg, mtime }`。
   - 方法：`getDef(id)`、`list()`、`rescan()`、`on("stone:changed", cb)`、`invalidate(id, files)`。
   - 构建时把发现的 builtins 注册进 `runtime.objects`（长期替换 extendable/index.ts 的 side-effect import；M2 阶段保留两条路径，按 objectId dedup）。
   - 把 peer discovery 的目录扫描逻辑（原 `stone-object.ts:discoverStoneHierarchicalPeers`）迁进来，统一入口。

3. **`packages/@ooc/core/app/server/modules/stones/service.ts`**
   - `listStones()` 改为调用 `stoneRegistry.list()`，不再自己扫 `{baseDir}/packages/`。

4. **`packages/@ooc/core/thinkable/knowledge/synthesizer.ts`**
   - `ensureSelfObjectTypeRegistered` 和 `derivePeerObjectWindows`：先查 `stoneRegistry.getDef(id)`，命中则直接用预加载定义；未命中才 fallback 到懒加载（兼容运行时新建 stone 的场景）。

5. **`.ooc-world/` dogfooding 目录**
   - 若存在 `.ooc-world/packages/` 用户 stone，迁移到 `.ooc-world/stones/<id>/`。
   - 创建 `.ooc-world/package.json`：`workspaces: ["stones/*"]`，`dependencies` 用 `workspace:*` 指向本地 `packages/@ooc/*`。

6. **根 `package.json`**
   - workspaces 追加 `".ooc-world/stones/**"`。

**风险与缓解**：
- `packageDir/stoneDir` 被几十处调用，路径变更可能破坏 IO。——双路径 fallback + warn，至少保留一个 release。
- builtin 注册从 side-effect import 迁移到 runtime discovery 可能有顺序依赖。——M2 阶段两条路径并存，side-effect 仍然执行；StoneRegistry 发现重复 objectId 时跳过不覆盖。

**验证**：
```bash
bun run verify
# 手动：GET /api/stones 返回数量与 M1 相同；已存在 thread 的 thinkloop、peer discovery 正常；
# 新创建一个 stone 对象（通过 metaprog 或直接 mkdir）后能被 listStones 发现
```

---

## Phase M3：热更新（第一档——code/view/knowledge 即时生效）

**目标**：编辑 stone 的 `executable/`、`visible/`、`readable.(md|ts)`、`knowledge/` 无需重启即时生效。

**创建**：
- `packages/@ooc/core/runtime/fs-watcher.ts` — fs watcher。
- `packages/@ooc/web/vite-plugin-ooc-stones.ts` — Vite 插件。

**修改**：

1. **fs-watcher.ts + StoneRegistry**
   - 用 bun 原生 `fs.watch(recursive: true)`（bun 1.1+ 支持 Darwin/Linux）watch `stones/*/`。
   - 按文件路径映射事件：
     - `executable/**/*.ts` / `readable.ts` → `{ kind: "code" }`
     - `visible/**/*.{ts,tsx,css}` → `{ kind: "view" }`
     - `readable.md` / `knowledge/**/*.md` → `{ kind: "knowledge" }`
     - `self.md` / `package.json` → `{ kind: "identity" }`（M4 处理）
   - Debounce 50ms；调 `stoneRegistry.invalidate(objectId, files)`，触发 `stone:changed` 事件。
   - Code 类变更：`serverLoader.clearCacheForStone(objectId)`（新方法），下次 `loadObjectWindow` 用 `Bun.reimport(path)` 重加载。
   - Knowledge 类变更：`knowledgeLoader.clearCacheFor(stoneDir)`。

2. **`packages/@ooc/core/executable/server/loader.ts`**
   - 当前 `import(\`${path}?t=${mtime}\`)` 方式会污染 module cache；改为首次 `import(path)` + 失效时 `Bun.reimport(path)`。
   - 新增 `clearCacheForStone(objectId)`。

3. **Vite 插件 `vite-plugin-ooc-stones.ts` + vite.config.ts**
   - 插件启动时调后端 `/api/stones` 获取 stone 列表，把每个 stone 的 `visible/` 路径动态加入 `config.server.fs.allow`。
   - 提供虚拟模块 `/@ooc/stones/:objectId/visible` → resolve 到 `<stoneDir>/visible/index.tsx`。
   - 订阅后端推送的 `stone:changed`（通过 SSE endpoint `/api/stones/events` 或轻量轮询 `/api/stones/:id/mtime`），收到 view 变更时触发 module HMR invalidation。
   - 移除 `vite.config.ts` 里对 `OOC_WORLD_DIR` 的硬 fail 要求（改为可选；插件从后端拉路径）。

4. **`packages/@ooc/core/app/server/modules/ui/api.client-source-url.ts`**
   - 返回值中追加 `pluginUrl: "/@ooc/stones/:objectId/visible"`，frontend 优先用插件 URL，fallback 到 `/@fs`。

**风险与缓解**：
- `Bun.reimport` 后旧 module 里闭包的状态可能残留。——约束 stone executable 不存 module-level 可变状态（method ctx 是 per-call 创建的）；在 `stone:register` 时静态检查 module-level `let`/`var` 并警告。
- Vite HMR 组件 state 丢失。——标准 React HMR 约束：组件名稳定即可保留 state；文档化。

**验证**：
```bash
ooc dev
# 1. 改某 stone executable/index.ts，加一个 log 或改返回值 → 下一次 exec 调这个方法立即生效
# 2. 改某 stone visible/index.tsx 的渲染字符串 → 浏览器 UI 热更新，不丢 state
# 3. 改某 stone knowledge/intro.md → 下一轮 thinkloop 里 LLM 看到新内容
```

---

## Phase M4：完整 CLI + 身份/结构迁移（第二档热更新）

**目标**：`ooc init/build/start` 全链路通；self.md/prototype 变更走懒迁移。

**创建**：
- `packages/@ooc/cli/src/commands/{init,build,start}.ts`
- `packages/@ooc/cli/templates/world/`（脚手架模板：package.json、tsconfig.json、.world.json、.env.example、.gitignore、README.md）
- `packages/@ooc/core/runtime/stone-migrator.ts`
- `packages/@ooc/tsconfig/package.json` + `tsconfig.stone.json`（stone 项目用的基础 tsconfig）

**各命令职责**：
- `ooc init [path]`：copy 模板 → 写 `package.json` 含 `@ooc/core/web/cli` + 常用 builtins 依赖 → `bun install` → 输出下一步提示。
- `ooc build`：对 StoneRegistry 里每个 stone，`bun build stones/<id>/executable/index.ts --outdir .ooc-dist/<id>/executable`；visible 走 Vite library mode。输出 `.ooc-dist/`。
- `ooc start`：校验 `.ooc-dist/` 存在 → `createWorldRuntime({ dev: false })`（关闭 fs watch）→ Elysia serve：`/api/*` 走 runtime、`/` serve `@ooc/web/dist` 静态 bundle、`/stones/<id>/*` serve `.ooc-dist/<id>/visible`。

**stone-migrator.ts**：
- 订阅 `stone:changed { kind: "identity" }`，对所有该 objectId 的 flow 实例在 `state.json._meta` 打 `stone_version_mismatch: true`。
- 实例下次被 thread 引用时：若 stone 提供 `executable/migrate.ts`，调 `migrate(oldState, oldDef, newDef)`；成功则清标记写回 state；失败则实例进入 `NEEDS_MIGRATION_REVIEW` 状态，UI 展示 diff。

**验证**：
```bash
# init
cd /tmp && bunx ooc init test-world && cd test-world && ls -la && cat package.json
# build + start（用 dogfooding world 里的 stones 测）
cd <ooc-2>/.ooc-world && bun run build && bun run start
# 浏览器访问 → 生产模式能正常打开、创建 thread
# identity 迁移：改 stone self.md 的 prototype → 重启 thread → 看到迁移钩子被调用
```

---

## Phase M5：npm 发布就绪

**目标**：所有 `@ooc/*` 独立可发布；端到端从 npm `ooc init` 跑通。

**修改**：
- 每个 `packages/@ooc/*/package.json`：补 `main`、`types`、`exports`、`files` 字段；删除 `private: true`（除 tests）；确保没有 `workspace:*` 残留（发布前用 changesets 或等价工具替换为真实 semver）。
- `packages/@ooc/web/package.json`：`files` 包含预构建的 `dist/`；`prepack` 脚本执行 `bun run build`。
- 根目录：引入 changesets（`.changeset/config.json` + base changesets）或等价的版本管理方案。
- CI：publish workflow（或至少 README 中的发布步骤文档）。

**验证**：
```bash
# verdaccio 本地 registry 或 npm pack
cd packages/@ooc/core && npm pack   # 生成 .tgz
# 对 web、cli、每个 builtin 都 pack
# 在 /tmp/test-world2：
bun init
bun add /path/to/*.tgz
bun x ooc init .
bun run dev
# 端到端 smoke test：打开 UI → 创建 thread → 得到回复
```

---

## 依赖图与执行顺序

```
M0 (CLI 壳)
 └─→ M1 (WorldRuntime, 消灭 singleton)   ← 地基，必须先过
      └─→ M2 (stones/ + StoneRegistry)   ← 路径 & 契约
           ├─→ M3 (hot reload I)          ← 基于 StoneRegistry 的 fs watch
           └─→ M4 (CLI 全命令 + migration)
                 └─→ M5 (npm publish)
```

M1 是最大的重构但采用 wrapper 模式保证零破坏；M2 的 dual-path fallback 同样保证渐进安全。M3/M4 可以部分并行（M3 先做 code/view 热更新，M4 独立做 init/build/start）。

## 验证总表

每阶段完成后必须：
1. `bun run verify` 全绿（tsc + core tests + silent-swallow + deprecated 检查）。
2. e2e 场景：`RUN_BACKEND_E2E=1 bun test packages/@ooc/tests/e2e/backend` 通过。
3. 手动 smoke test：`ooc dev` → 创建 thread → 跑 3 轮 think → 打开对应 object 的 visible 页面。

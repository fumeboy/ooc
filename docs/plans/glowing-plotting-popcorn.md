# Plan: Migrate builtins + complete P1 (singleton → per-world registry)

## Context

P1 交付了 `ObjectTypeRegistrar` + per-world `WorldRuntime.objects`，但它是 **write-only 的半成品**：
- builtin 的 executable/index.ts 仍是 side-effect `registerObjectType` 写进 module-level `defaultObjectRegistry` singleton
- 118 个 registry lookup 调用点（29 个生产文件）全部读 singleton，per-world 实例无人读
- 命名分叉：StoneRegistry 发现的 builtin id 是 `"_builtin/file"`，但 `BASE_TYPE_DEFINITIONS` seed 和所有 lookup 用 `"file"`
- 类型缺口：`ObjectWindowDefinition` 缺 `compressView` / `isBuiltinFeature`；`basicKnowledge` 函数形态被静默丢弃
- `defaultObjectRegistry` 的 deprecation 注释明确警告它不接收 stone 类型注册——多 world 或 stone 场景会静默失败

用户选择 **方案 B：完整交付**。目标：消除 singleton 读写分叉，让所有注册 + lookup 走 per-world `ObjectRegistry`。

## 总览：6 个阶段

```
Phase 0  类型扩展 (ObjectWindowDefinition + ThreadContext)
Phase 1  Registrar 修复 (key 映射 + 字段透传)
Phase 2  接入点: ThreadContext 携带 registry 引用
Phase 3  118 个 lookup 调用点迁移 (分三批: easy → medium → hard)
Phase 4  8 个 builtin 改写为 export const window
Phase 5  删除 side-effect 注册链 + singleton 语义加固
```

---

## Phase 0 — 类型扩展

**文件：**
- `packages/@ooc/core/executable/server/window-types.ts`
- `packages/@ooc/core/thinkable/context/index.ts` (ThreadContext)
- `packages/@ooc/core/runtime/object-registry.ts`

改动：
1. `ObjectWindowDefinition` 补两个字段：
   ```ts
   compressView?: CompressViewHook;
   isBuiltinFeature?: boolean;
   ```
   （两者都已在 `ObjectDefinition` 上存在，现在 stone 侧也能声明）
2. `ObjectDefinition.basicKnowledge` 类型从 `string` 扩为 `string | ((ctx: { programSelf: ProgramSelf }) => string)`，与 `ObjectWindowDefinition` 对齐；`ObjectTypeRegistrar` 不再静默丢弃函数形态（Phase 1 修）。
3. `ThreadContext` 增加可选字段：
   ```ts
   readonly registry?: ObjectRegistry;
   ```
   作为每线程可达的 per-world registry 引用。`undefined` 时 fallback 到 singleton（兼容旧调用方 + tests）。

---

## Phase 1 — ObjectTypeRegistrar 修复

**文件：** `packages/@ooc/core/runtime/object-type-registrar.ts`

改动：
1. **key 映射**：`registerStone(objectId)` 内部把 `"_builtin/file"` 这类 id 映射到 bare key `"file"` 再注册。简单规则：若 `objectId.startsWith("_builtin/")` 则取 `slice(9)` 作为 registry key；保留原 objectId 传给 stoneRef（stone 路径查找仍用带前缀 id）。
2. **字段透传补全**：`registerStone` 传给 registry 的对象新增：
   - `compressView: windowDef?.compressView`
   - `isBuiltinFeature: windowDef?.isBuiltinFeature`
   - `basicKnowledge`：区分字符串直接用；函数形态存入（Phase 0 已扩 ObjectDefinition 类型）。注意：若 future basicKnowledge 需要 programSelf，则在注册时惰性求值或存函数本身——先支持函数类型存储。
3. **内置类型合并分支**：对 `"file"`、`"plan"` 等 bare key，`BASE_TYPE_DEFINITIONS` 已经 seed 了空条目，所以 registrar 会走 `registerObjectType`（merge）分支而非 `registerNewObjectType`，正确覆盖而非创建重复条目。
4. **`user` 特殊 case 保留**（第 65 行已有）。

---

## Phase 2 — ThreadContext 注入 registry

**文件：**
- `packages/@ooc/core/persistable/thread-json.ts` (`readThread`, `writeThread`)
- `packages/@ooc/core/executable/windows/_shared/manager.ts` (`WindowManager.fromThread`, `forkThread`, `deliverTalkMessage`)
- Worker 调度入口（查找 `think(thread, ...)` 或 `processThread` 的调用点）

设计原则：**registry 不持久化**（它是 runtime 引用），只在 thread 从磁盘加载后、进入 worker 调度前注入。

改动：
1. 在 `readThread` 或其调用方（worker/scheduler 入口），拿到 thread 后把 per-world registry 赋给 `thread.registry`。具体位置：找到 app server 中 `think(thread)` / window manager 操作 thread 前的最后一站。
2. `WindowManager.fromThread(thread)` 构造时从 `thread.registry` 取，保留 fallback。
3. `stripVolatileForPersist` 确认 `registry` 字段不被序列化（它不是 plain data，本身不会 JSON 化；但显式列入 volatile 更清晰）。
4. Tests：`ThreadContext` 构造时不传 `registry`，自动 fallback singleton，已有 tests 不用改。

---

## Phase 3 — Lookup 调用点迁移（118 处，分 3 批）

每批的模式：把 `getWindowTypeDefinition(type)` / `lookupMethod(parent, name)` 等自由函数调用改为：
```ts
const reg = thread?.registry ?? defaultObjectRegistry;
reg.getWindowTypeDefinition(type);
// 等同类方法：ObjectRegistry 已有所有这些方法（同名同签名）
```

关键便利：先在 `executable/windows/_shared/registry.ts` 的 wrapper 函数里加一个 `thread` 参数（可选），由调用方传入。wrapper 内部 `thread?.registry ?? defaultObjectRegistry`。这样不用把每处调用都改成 `reg.xxx(...)`，可以渐进迁移。

### 批 3a — Easy（已持有 ThreadContext，~65 处）

这些文件直接拿得到 thread：
- `executable/windows/_shared/manager.ts` (10 calls)：WindowManager 方法都有 threadRef
- `thinkable/context/render.ts` (4 calls)：renderContextXml/renderWindowNode 有 thread
- `thinkable/knowledge/synthesizer.ts` (10 calls)：有 thread 参数
- `executable/permissions.ts` (1 call)：有 thread 参数
- `executable/server/self.ts` (1 call)：有 thread
- `persistable/debug-file.ts` (1 call)：有 ThreadContext
- `thinkable/context/budget.ts` / 其他有 thread 的函数

改动模式：wrapper 函数新增可选 `thread?: ThreadContext` 参数，调用方把自己的 thread 传进去。

### 批 3b — Medium（需要 thread/runtime 显式传参，~20 处）

- **builtin root command.*.ts**（10 处 `lookupConstructor`）：exec(ctx) 里有 `MethodExecutionContext`，它包含 thread。ctx 加 registry 引用或从 ctx.thread 取。
- **`persistable/thread-json.ts`**（4 calls）：readThread 过程中 registry 还没注入，但 readThread 有 `persistence` 引用——从调用方的 world/runtime 或在 readThread 签名加可选 registry 参数。
- **`persistable/flow-object.ts`**（1 call `getObjectDefinition`）：`createFlowObject` 只拿 `FlowObjectRef`，从其调用方（manager.ts 的 open/create）把 registry 传进来。
- **`thinkable/knowledge/loader.ts`**（1 call `resolveParentClassChain`）：从调用方传 registry。
- **`app/server/modules/ui/api.list-window-types.ts`**（2 calls）：HTTP handler，从 Elysia state 读 `runtime`。Elysia route 里加 `.use()` 把 runtime 注入 handler 上下文。

### 批 3c — Hard（side-effect / boot-time，~33 处）

- **16 处 WRITE 调用**（builtin executable/index.ts + core windows/*/index.ts + extendable/lark/*）：Phase 4 改 builtins；core 的 do/talk/method_exec/relation 同样改写成 `export const window` 并由 ObjectTypeRegistrar 统一注册，或在 createWorldRuntime 的一个新的 `registerCoreBuiltins()` 同步阶段注册（它们是真正的 core，不是 stone 发现）。
- **1 处 boot assertion**（`windows/index.ts:127 assertAllObjectDefinitionsRegistered`）：移到 `createWorldRuntime` 内，在 `ObjectTypeRegistrar.start()` resolve 之后 await 并 assert 到 per-world registry。
- **Barrel re-exports**（`windows/index.ts` + `extendable/_shared/registry.ts`）：wrapper 函数保留（加 thread 参数），不删除。

---

## Phase 4 — 8 个 builtin 改写为 `export const window`

**文件：** `packages/@ooc/builtins/{root,file,plan,todo,program,knowledge,search,skill_index}/executable/index.ts`

每个文件的结构改写（模式统一）：

1. 移除 `import { registerObjectType, ... } from "@ooc/core/extendable/_shared/registry.js"`
2. 新增 `import type { ObjectWindowDefinition } from "@ooc/core/executable/server/window-types.js"`
3. 替换 `registerObjectType("X", { commands, readable, ... })` 为：
   ```ts
   export const window: ObjectWindowDefinition = {
     title: "X",
     description: "...",              // 一行简要说明
     parentClass: null,               // root: null; 其他 undefined 即 inherit root
     isBuiltinFeature: true,          // 仅 todo 今天设了；file/search/plan/program/knowledge/skill_index 都独立 flow object，设 false
     methods: {                       // 统一用 methods（canonical）；commands 是 deprecated 别名
       // constructor (kind:"constructor") 和普通方法都放这里
     },
     readable,
     compressView,                    // file/search/plan 有；其他省略
     onClose,
     renderXml,                       // 有就写
     basicKnowledge,                  // 有就写（字符串或函数）
   };
   ```
4. `search` 删除第二次 `registerObjectType`（constructor 合进同一个 `methods`）。
5. `root` 删除 `ROOT_COMMANDS` / `ROOT_METHODS` 双重别名和它们的外部导出——需要这些表的调用方改为从 registry 读 `registry.getObjectDefinition("root").methods`。
6. `root` 删除 6 个 side-effect import（`import "@ooc/builtins/file"` 等）。
7. core 的 do/talk/method_exec/relation 同样处理：把 side-effect `registerWindowType` 改成 `export const window`。它们通过新的 `registerCoreBuiltins(runtime)` 函数在 `createWorldRuntime` 内同步注册（不经过 stone 发现，因为它们不在 @ooc/builtins 里）。
8. feishu_chat / feishu_doc：在 `extendable/index.ts` 里改写成通过 runtime 注册，或让它们也 export window。

---

## Phase 5 — 删除 side-effect 链 + singleton 语义加固

**文件：**
- `packages/@ooc/core/executable/windows/index.ts`
- `packages/@ooc/core/extendable/index.ts`
- `packages/@ooc/core/runtime/object-registry.ts`
- `packages/@ooc/core/runtime/world-runtime.ts`

改动：
1. 删 `windows/index.ts:105 import "@ooc/builtins/root"` 和 `extendable/index.ts` 里所有 side-effect import（8 条）。
2. 删 `windows/index.ts:127 assertAllObjectDefinitionsRegistered`，移到 `createWorldRuntime` 内部 await `typeRegistration` 之后调用 per-world registry。
3. `defaultObjectRegistry` 的 wrapper 函数统一打 runtime `console.warn`（非测试环境且 thread?.registry == null 时），标出"仍在使用 deprecated singleton registry"，帮助发现漏迁移。
4. `createWorldRuntime` 内加一个 `registerCoreBuiltins(runtime)` 调用，负责同步注册 do/talk/method_exec/relation 这些 core 内置 type（它们不在 @ooc/builtins/ 包里，不走 stone 发现）。

---

## 验证

### 类型检查（每改完一个阶段立刻跑）
```bash
bun tsc --noEmit packages/@ooc/core/executable/server/window-types.ts
bun tsc --noEmit packages/@ooc/core/thinkable/context/index.ts
bun tsc --noEmit packages/@ooc/core/runtime/object-type-registrar.ts
bun tsc --noEmit packages/@ooc/builtins/file/executable/index.ts  # 等 builtins
bun tsc --noEmit packages/@ooc/core/executable/windows/_shared/manager.ts
bun tsc --noEmit packages/@ooc/core/thinkable/context/render.ts
bun tsc --noEmit packages/@ooc/core/app/server/modules/ui/api.list-window-types.ts
```

### 单测
```bash
# registry / constructor 通路
bun test packages/@ooc/core/executable/windows/_shared/__tests__/constructor-pathway.test.ts
bun test packages/@ooc/core/executable/windows/_shared/__tests__/method-inheritance.test.ts
# builtin 方法查找
bun test packages/@ooc/core/executable/__tests__/fs-search.test.ts
# context render
bun test packages/@ooc/core/executable/windows/__tests__/search-results-viewport.test.ts
bun test packages/@ooc/core/executable/windows/__tests__/program-history-viewport.test.ts
bun test packages/@ooc/core/executable/windows/__tests__/transcript-viewport-integration.test.ts
# 权限
bun test tests/e2e/backend/permission-q0b.test.ts
bun test tests/e2e/backend/permission-q0c-approve-reject.test.ts
# ooc-6 集成
bun test tests/integration/ooc6-object-unification.harness.test.ts
# context budget + knowledge activator（不改但防回归）
bun test packages/@ooc/core/thinkable/context/__tests__/budget.test.ts
bun test packages/@ooc/core/thinkable/knowledge/__tests__/activator.test.ts
bun test packages/@ooc/core/app/server/modules/flows/service.test.ts
```

### E2E sanity
启动 app server（`--world ./.ooc-world-test`），创建 thread，调 root.open_file 生成 file window，验证：
1. `lookupConstructor("file")` 从 per-world registry 命中（通过日志或 debugger 确认不走 singleton）
2. file window XML 正常渲染（readable 生效）
3. collapse 后 compressView 生效（非 generic placeholder）
4. close 后 onClose + persistence 正确（file 作为独立 flow object，写 state.json + _ref 指针）
5. todo window persistence 正确（inline 进 context.json，不写 state.json——`isBuiltinFeature: true` 的效果）

### 回归检查
- 关闭 server 再启动，reload 已持久化的 thread，所有 window 能正确 hydrate
- 一个简单 stone Object（如 supervisor）的方法能被 peer lookup 到（peer 自动注入 + 渲染正确）

---

## 不变量 / 不做

- **不删** `defaultObjectRegistry` 和 `executable/windows/_shared/registry.ts` 的 wrapper 函数：保留作 tests 兼容 + thread.registry 缺失时的 fallback。wrapper 加 deprecation warning（非测试环境）。
- **不改** `packages/@ooc/web/`：前端只走 HTTP API，registry 路由切换对它透明。
- **不重构** wrapper 函数为 class-only 调用：加可选 thread 参数是最小侵入。
- **不引入** AsyncLocalStorage / DI 容器：ThreadContext 已是事实标准的 context 载体，直接加字段最简单。

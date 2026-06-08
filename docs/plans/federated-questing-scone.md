# Plan: 清理废弃类型和程序

## Context

`ea6aaf86` 之后，代码库中同时存在两套 API 和大量 deprecated alias：
- 新 API：`intent()` / `onFormChange()` / `schema` / `BudgetManager` / `ContextPipeline` / `ObjectTypeRegistrar`
- 旧 API（标记为 `@deprecated` 但仍在生产路径使用）：`match()` / `knowledge()` / `applyNaturalDecay` / `applyEmergencyGuard` / `defaultObjectRegistry`（module-level）/ `collectExecutableKnowledgeEntries` / `renderContextXml` / `_decayMeta` / `WindowType` / `CommandKnowledgeEntries` / `CommandExecutionContext` / `ctx.parentWindow` / `RelationWindow` / `packageDir` / `serverDir` / `clientDir` / `readme.md` 相关函数

用户明确：**不用考虑向后兼容，一次性清理所有废弃路径，只保留新 API。**

---

## 清理范围（按类别）

### A. 类型改名清理（纯 rename，不涉及逻辑）

| 旧名 | 新名 | 位置 |
|------|------|------|
| `WindowType` | `ObjectType` | `types.ts:26-27` + 所有使用处 |
| `CommandKnowledgeEntries` | `MethodKnowledgeEntries` | `command-types.ts:25` |
| `CommandExecutionContext` | `MethodExecutionContext` | `command-types.ts:205` |
| `CommandOutcome` | `MethodOutcome` | `command-types.ts:48` |
| `ObjectCommand` | `ObjectMethod` | 所有使用处 |
| `ObjectDefinition.prototype` | `ObjectDefinition.parentClass` | `registry.ts:61-63` |
| `ctx.parentWindow`（MethodExecutionContext 字段） | `ctx.self` | `command-types.ts:165-176` + 所有使用处 |
| `ContextWindow`（type union）| 保留名称（用户要求），但删除 `@deprecated` JSDoc | `types.ts:273` |
| `OOCObject` / `ContextObject` | 合并：保留 `ContextObject` 作为 thread 维度类型名；`OOCObject` 如果只是等价 alias 则删除 | `types.ts:242-271` |

web/ 层同步改名：`ObjectCommandEntry`、`ObjectTypeCatalogEntry`、`useWindowTypes`、`getWindowTypeCommands`。

### B. ContextWindow 字段清理

- **删除 `BaseContextWindow._decayMeta`**（`types.ts:146-144`）
  - 清理所有读/写：`budget.ts`、`manager.ts:1083-1088`、`thread-json.ts`（strip 逻辑）、`window-hash.ts`（strip 逻辑）、相关 test
- **保留 `BaseContextWindow.compressLevel`** — 因为 compress/expand 工具和 LLM 显式命令仍然使用它
- **保留** `provenance` / `relevance` / `boundFormId`

### C. ObjectMethod 接口清理

- **删除 `ObjectMethod.match`**（`command-types.ts:89-94`）
  - `manager.ts` 的 `computeCommandPaths` 改从 `method.intent()` 派生（method name + 子 intent）
  - `builtin/root/executable/index.ts:168` 的 `entry.match(args)` 改走 intent
- **删除 `ObjectMethod.knowledge`**（`command-types.ts:96-103`）
- **强制 requirement**：`intent()`、`onFormChange()` 保持可选

### D. 预算：删除 applyNaturalDecay / applyEmergencyGuard，BudgetManager 接入 ThinkLoop

- **删除** `applyNaturalDecay`（budget.ts:262-408）及其 imports
- **删除** `applyEmergencyGuard`（budget.ts:599-644）及其 imports
- **删除** `estimateThreadTokens`
- **保留** `BudgetManager` class、`loadBudgetThresholds`、`DEFAULT_BUDGET_THRESHOLDS`、配置类型
- **`thinkloop.ts:273-294` 重写**：
  ```
  旧: applyNaturalDecay → applyEmergencyGuard → buildInputItems → budget warning injection
  新: buildInputItems(内含 BudgetManager.allocate) → 若 BudgetManager 报告 tokens > soft，注入 warning
  ```
  - compressLevel 推进（自然衰减 fold window）逻辑**删除**。compressLevel 现在仅保留给 LLM 显式 `compress` / `expand` 命令。
- 删除 `context-compression-p0d-decay.test.ts`（测的是已删的 applyNaturalDecay），或保留只测 BudgetManager

### E. Registry 清理

- **删除 module-level `defaultObjectRegistry`**（`runtime/object-registry.ts:339`）
- **删除 `_shared/registry.ts` 中所有 thin wrapper 函数**：`registerWindowType`、`registerObjectType`、`registerNewObjectType`、`getWindowTypeDefinition`、`getObjectDefinition`、`isBuiltinFeatureType`、`resolveParentClassChain`、`lookupMethod`、`lookupMethodEntry`、`resolveMethod`、`lookupConstructor`、`listRegisteredWindowTypes`、`listRegisteredObjectTypes`、`assertAllRenderHooksRegistered`、`assertAllObjectDefinitionsRegistered`、`resolveEffectiveVisibleType`
- 所有使用这些 wrapper 的地方改为：
  - 运行时路径：通过 `WorldRuntime.objects`（per-world registry）
  - 非运行时（如 render.ts 的 render hook 查询）：通过 ObjectRegistry 的实例方法（直接 new ObjectRegistry() 或通过 world）
- `ObjectRegistry` 类上的 deprecated 方法名清理：`registerWindowType` → `registerObjectType` 等

### F. Context 构建：ContextPipeline + XmlRenderer 接入生产

**当前状态**：`ContextPipeline.run()` 是骨架（无 processors 注册）；`XmlRenderer.render()` 只 delegate 给 `renderContextXml`；`buildInputItems()` 直接调 `collectExecutableKnowledgeEntries` + `renderContextXml`。

**动作**：

1. **ContextPipeline 接入生产**
   - `createDefaultPipeline()` 真正注册：KnowledgeProcessor → MethodFormProcessor → PeerProcessor → SystemProcessor → BudgetManager.allocate
   - `buildInputItems()` 改为：`const pipeline = createDefaultPipeline(); const snapshot = await pipeline.run(thread);`
   - 删除 `buildInputItems` 中 `collectExecutableKnowledgeEntries` 调用
   - `ContextPipeline.run()` 末尾调用 `BudgetManager.allocate()` 写 snapshot.overflow + visibility

2. **XmlRenderer 真正渲染**
   - `render.ts` 的 per-window render hook 调度逻辑（445 行）+ `<context>` 壳子 — 移入 `XmlRenderer`，或保留 render.ts 但删除 `renderContextXml` 顶层函数，XmlRenderer 直接 import 内部 utility
   - `renderContextXml` **删除**
   - `XmlRenderer.render()` 追加 `<context_overflow>` 节点

3. **删除 `collectExecutableKnowledgeEntries`**
   - 拆其逻辑到各 Processor：
     - Peer auto-injection → PeerProcessor（复用已有 `derivePeerObjectWindows`）
     - Protocol constants / session basics → SystemProcessor
     - Knowledge activator matching → KnowledgeProcessor
     - Skill index synthesis → 拆为独立 utility（SkillProcessor 暂不纳入，但从该函数移出）
     - form knowledge entries → MethodFormProcessor（通过 onFormChange，已实现）
   - `synthesizer.ts` 保留：`derivePeerObjectWindows`、skill_index 合成 utility；删除：`collectExecutableKnowledgeEntries`、`deriveRelationWindow`、`deriveRelationCompanionKnowledge` 等 relation 相关

4. **flows/service.ts:811** 中 `collectExecutableKnowledgeEntries` 调用 — 改为走 ContextPipeline 或直接用 thread.contextWindows（hash 计算需要稳定 window 集合）

5. **删除** `renderContextXmlLegacy` wrapper（xml.ts:53）

**thinkloop 中最终顺序**：
```
think() {
  processDecidedPermissionAsks(thread)
  buildInputItems(thread) {
    snapshot = pipeline.run(thread)  // processors + budget allocate
    xml = xmlRenderer.render(snapshot, thread)
    + transcript messages + instructions + pathsItem
  }
  if (budget soft exceeded) inject warning item
  beginLlmLoop(...)
}
```

### G. persistable 层 deprecated 函数清理

| 旧函数 | 新函数 | 文件 |
|--------|--------|------|
| `packageDir` | `stoneDir` | `persistable/common.ts` |
| `serverDir` / `readServerSource` / `writeServerSource` | `executableDir` / `readExecutableSource` / `writeExecutableSource` | `stone-server.ts` |
| `clientDir` / `readClientSource` / `writeClientSource` | `visibleDir` / `readVisibleSource` / `writeVisibleSource` | `stone-client.ts` |
| `readReadme` / `writeReadme` | `readReadable` / `writeReadable` | `stone-readme.ts` |
| `discoverSiblingPeers` | `discoverStoneHierarchicalPeers` | `stone-object.ts` |
| `resolveRootByStonePath`（bun workspace 后删除） | | `common.ts:45` |
| **删 thread.plan 字段** | plan_window in contextWindows | debug-file、thread 类型定义 |

先 grep 每个旧函数的内部调用点，逐个替换，然后删除旧定义。

### H. 其他杂项

- **删除 `executable/windows/relation/` 整个目录** + `types.ts` 中 `"relation"` from union
- `executable/windows/do/command.wait.ts` 等：批量改名 `CommandExecutionContext` → `MethodExecutionContext`、`CommandKnowledgeEntries` → `MethodKnowledgeEntries`
- `executable/windows/index.ts`：删除 deprecated alias exports
- `executable/server/loader.ts` deprecated：检查直接 import 点，替换掉
- `observable/index.ts` deprecated re-export：清理
- `persistable/serial-queue.ts` deprecated：清理
- `refineCommandLegacy` / `submitCommandLegacy`（method_exec/refine.ts, submit.ts）删除
- `web/src/domains/objects/window-types.ts` deprecated types：批量改名
- `web/src/app/routing.ts:300` deprecated function：删除
- `ObjectType` union 中 `"command_exec"` 与 `"method_exec"` — 统一为一个（看 readable.ts / types.ts 当前实际用的是哪个）

### I+J. builtins 迁移 + executable/index.ts 新格式

所有使用 `match()` / `knowledge()` 的 builtin method 文件，迁移到 `intent()` / `onFormChange()` / `schema()`，并统一新格式。约 21 个文件：

- `builtins/file/executable/index.ts`、`builtins/plan/executable/index.ts`、`builtins/todo/executable/index.ts`
- `builtins/search/executable/index.ts` + `command.set-results-window.ts`、`builtins/knowledge/executable/index.ts`
- `builtins/program/executable/index.ts`
- `builtins/root/executable/command.*.ts`（13 个）+ `index.ts`
- `core/executable/windows/talk/index.ts`、`core/executable/windows/do/index.ts`

迁移模式（每个 ObjectMethod 统一为）：
```typescript
// 1. 命名 intent 函数（仅返回子 intent，不含 method 名本身）
const XXX_INTENT = (args) => { ... return [{name, tags?}] };

// 2. schema 常量
const XXX_SCHEMA = { args: { /* name: { type, required, description, ... } */ } };

// 3. onFormChange：镜像原 knowledge() 逻辑，产出 form_guidance windows
onFormChange(change, {form, intents}) {
  if (change.kind === "args_refined" || change.kind === "intent_changed") {
    return [{ type: "form_guidance", id: `guidance_${form.id}_...`, ... }, ...];
  }
  return [];
}

// 4. 新格式统一字段顺序：paths → schema → intent → onFormChange → exec
// 5. 删除旧的 match 和 knowledge 字段
```

---

## 执行顺序

1. **A. 类型改名**（纯 rename，风险最低）→ `bun tsc --noEmit`
2. **I+J. builtin migration + 格式统一**（把 builtin 改成新 API，格式统一为 `paths + schema + intent + onFormChange + exec`，为 C 做准备）→ `bun tsc --noEmit`
3. **C. ObjectMethod 接口删 match/knowledge** → `bun tsc --noEmit`
4. **G. persistable deprecated 删除** → `bun tsc --noEmit`
5. **E. Registry 清理** → `bun tsc --noEmit`
6. **B. ContextWindow 字段清理（删 _decayMeta）** → `bun tsc --noEmit`
7. **D. Budget 清理 + BudgetManager 接入 thinkloop** → `bun tsc --noEmit`
8. **F. ContextPipeline/XmlRenderer 接入生产** → `bun tsc --noEmit`
9. **H. 杂项清理**（relation 目录、legacy aliases）→ `bun tsc --noEmit`
10. **K. 真实启动 OOC Server，按 harness 模式体验**
    - 启动 app server：`bun run dev --world /Users/bytedance/x/ooc/ooc-2/.ooc-world-test`
    - 按 harness 模式（1 Supervisor + 各 AgentOfX + AgentOfExperience）进行真实任务跑通
    - 观察：Context 渲染（新 XML 格式、schema/fill_state/next_steps/guidance/overflow）、form refine/submit 链路、budget 行为
    - 发现的 bug / 体验问题 → 记录 Issue，本轮 commit 内修（若小）或留后续
11. **全量 type-check + test regression**
12. **commit**

---

## 关键约束

- 每一步结束后 `bun tsc --noEmit` 必须通过，不堆到最后。
- 所有 deprecated 一律删除，不留 wrapper。
- SkillProcessor 仍然不纳入本次改造（skill_index 合成从 synthesizer 拆出即可）。
- `compressLevel` 字段保留（compress/expand 工具依赖），只删自动推进它的 applyNaturalDecay。

## 验证

- `bun tsc --noEmit` 全仓库通过
- `bun test` 通过（pre-existing failures 忽略）
- grep `@deprecated` → 0 行
- grep 关键字验证：`_decayMeta`、`applyNaturalDecay`、`applyEmergencyGuard`、`defaultObjectRegistry`、`CommandKnowledgeEntries`、`CommandExecutionContext`、`packageDir(` → 0 行（非 test 中）

## 关键文件

- `packages/@ooc/core/executable/windows/_shared/types.ts`
- `packages/@ooc/core/executable/windows/_shared/command-types.ts`
- `packages/@ooc/core/executable/windows/_shared/registry.ts`
- `packages/@ooc/core/executable/windows/_shared/manager.ts`
- `packages/@ooc/core/executable/windows/method_exec/types.ts`
- `packages/@ooc/core/executable/windows/method_exec/readable.ts`
- `packages/@ooc/core/runtime/object-registry.ts`
- `packages/@ooc/core/runtime/world-runtime.ts`
- `packages/@ooc/core/thinkable/context/budget.ts`
- `packages/@ooc/core/thinkable/context/index.ts`
- `packages/@ooc/core/thinkable/context/render.ts`
- `packages/@ooc/core/thinkable/context/renderers/xml.ts`
- `packages/@ooc/core/thinkable/context/pipeline.ts`
- `packages/@ooc/core/thinkable/context/processors/{knowledge,method,peer,system}.ts`
- `packages/@ooc/core/thinkable/knowledge/synthesizer.ts`
- `packages/@ooc/core/thinkable/thinkloop.ts`
- `packages/@ooc/core/persistable/{common,stone-object,stone-readme,stone-server,stone-client,thread-json,debug-file}.ts`
- `packages/@ooc/core/observable/window-hash.ts`
- `packages/@ooc/core/executable/tools/compress.ts`
- `packages/@ooc/builtins/*/executable/index.ts`（~21 个文件）
- `packages/@ooc/web/src/domains/objects/window-types.ts`
- `packages/@ooc/web/src/app/routing.ts`

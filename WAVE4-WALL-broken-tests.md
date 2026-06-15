# Wave 4 承重墙重构 — 坏测试 / 待跟进清单（只登记，本轮不修不删）

承重墙改了 3 个枢纽 + 类型：`object-registry.ts` / `_shared/types/registry.ts` /
`_shared/types/thread.ts`（contextWindows 元素 → OocObjectInstance）/
`executable/windows/_shared/manager.ts`（WindowManager 重写为 RuntimeHandle）。

墙内 tsc 0 错误。以下全部是墙外 ripple（loader/xml/persist/test/story），由后续 leaf agent 修。

## 坏测试 / story 文件（63 个，按错误数倒序）
- 32 packages/@ooc/core/executable/__tests__/step2-windows.test.ts
- 26 packages/@ooc/tests/e2e/backend/plan-share-parent-child.e2e.test.ts
- 23 packages/@ooc/core/__tests__/window-method-registry.test.ts
- 22 packages/@ooc/core/executable/windows/__tests__/process-history-viewport.test.ts
- 20 packages/@ooc/core/executable/windows/_shared/__tests__/viewport-integration.test.ts
- 19 packages/@ooc/core/executable/__tests__/fs-search.test.ts
- 18 packages/@ooc/core/executable/windows/_shared/__tests__/method-inheritance.test.ts
- 18 packages/@ooc/core/executable/windows/__tests__/sharing.test.ts
- 17 packages/@ooc/tests/integration/ooc6-object-unification.harness.test.ts
- 16 packages/@ooc/storybook/stories/class.story.ts
- 15 packages/@ooc/storybook/stories/L3_executable.stories.ts
- 15 packages/@ooc/core/executable/windows/_shared/__tests__/constructor-pathway.test.ts
- 15 packages/@ooc/core/executable/windows/__tests__/transcript-viewport-integration.test.ts
- 14 packages/@ooc/core/executable/windows/_shared/__tests__/manager-refine-failed.test.ts
- 14 packages/@ooc/core/executable/windows/__tests__/search-results-viewport.test.ts
- 13 packages/@ooc/core/executable/__tests__/create-object.test.ts
- 12 packages/@ooc/core/executable/__tests__/wait.test.ts
- 10 packages/@ooc/core/executable/windows/_shared/__tests__/report-edits.test.ts
- 10 packages/@ooc/core/executable/__tests__/talk-fork-thread-tree.test.ts
- 10 packages/@ooc/core/executable/__tests__/commands.test.ts
- 9 packages/@ooc/builtins/thread/__tests__/thread-say.test.ts
- 9 packages/@ooc/builtins/pr/__tests__/pr-window.test.ts
- 8 packages/@ooc/tests/e2e/backend/plan-window-basic.e2e.test.ts
- 8 packages/@ooc/core/thinkable/knowledge/__tests__/activator.test.ts
- 8 packages/@ooc/core/observable/__tests__/window-hash.test.ts
- 7 packages/@ooc/core/thinkable/context/__tests__/protocol-knowledge.test.ts
- 6 packages/@ooc/core/thinkable/knowledge/__tests__/activator.expr.test.ts
- 6 packages/@ooc/core/thinkable/__tests__/context.test.ts
- 6 packages/@ooc/core/executable/windows/_shared/__tests__/manager-dual-write.test.ts
- 6 packages/@ooc/core/executable/windows/__tests__/talk-delivery.test.ts
- 6 packages/@ooc/core/executable/windows/__tests__/manager-method-dispatch.test.ts
- 6 packages/@ooc/core/executable/__tests__/process.test.ts
- 6 packages/@ooc/core/executable/__tests__/commands-execution.test.ts
- 5 packages/@ooc/builtins/terminal/__tests__/terminal.test.ts
- 5 packages/@ooc/builtins/example/__tests__/example.test.ts
- 4 packages/@ooc/tests/e2e/backend/end-reflection-reminder.e2e.test.ts
- 4 packages/@ooc/tests/e2e/backend/context-compression-p0c-typed.test.ts
- 4 packages/@ooc/tests/e2e/backend/context-compression-p0b.test.ts
- 4 packages/@ooc/core/persistable/__tests__/thread-context-bypass-reload.test.ts
- 4 packages/@ooc/core/__tests__/window-method-dispatch.test.ts
- 4 packages/@ooc/builtins/runtime/__tests__/runtime.test.ts
- 4 packages/@ooc/builtins/knowledge_base/__tests__/knowledge_base.test.ts
- 4 packages/@ooc/builtins/filesystem/__tests__/filesystem.test.ts
- 4 packages/@ooc/builtins/file/__tests__/file-window-method.test.ts
- 3 packages/@ooc/tests/e2e/backend/stones-versioning.e2e.test.ts
- 3 packages/@ooc/tests/e2e/backend/permission-q0c-approve-reject.test.ts
- 3 packages/@ooc/tests/e2e/backend/permission-q0b.test.ts
- 3 packages/@ooc/core/thinkable/context/__tests__/self-object-load-error.test.ts
- 3 packages/@ooc/core/executable/__tests__/file-overlay-redirect.test.ts
- 3 packages/@ooc/core/executable/__tests__/evolve-self.test.ts
- 2 packages/@ooc/tests/integration/super-flow-channel.integration.test.ts
- 2 packages/@ooc/storybook/stories/L2_thinkable.stories.ts
- 2 packages/@ooc/core/executable/__tests__/root.command.refine-hint.test.ts
- 2 packages/@ooc/core/__tests__/window-state-persistence.test.ts
- 1 packages/@ooc/tests/integration/wait-state-transition.integration.test.ts
- 1 packages/@ooc/tests/integration/executed-form-cleanup.integration.test.ts
- 1 packages/@ooc/storybook/stories/thinkable.story.ts
- 1 packages/@ooc/storybook/stories/L4_collaborable.stories.ts
- 1 packages/@ooc/core/thinkable/context/renderers/__tests__/render-methods-node.test.ts
- 1 packages/@ooc/core/persistable/__tests__/persistable.test.ts
- 1 packages/@ooc/core/persistable/__tests__/flows-worktree-migration.test.ts
- 1 packages/@ooc/core/executable/windows/__tests__/member-composition.test.ts
- 1 packages/@ooc/core/executable/__tests__/root.command.write-file.versioning.test.ts

## 墙外 SOURCE 文件（非测试，需 leaf agent 跟进）
- 12 packages/@ooc/core/thinkable/context/object-windows.ts
- 9 packages/@ooc/core/thinkable/context/renderers/xml.ts
- 8 packages/@ooc/core/executable/windows/_shared/types.ts
- 6 packages/@ooc/core/executable/windows/_shared/registry.ts
- 5 packages/@ooc/core/executable/windows/talk/index.ts
- 5 packages/@ooc/core/executable/windows/method_exec/refine.ts
- 5 packages/@ooc/core/executable/windows/index.ts
- 5 packages/@ooc/core/app/server/runtime/worker.ts
- 4 packages/@ooc/core/executable/windows/talk/method.share.ts
- 4 packages/@ooc/core/app/server/modules/flows/service.ts
- 3 packages/@ooc/core/thinkable/context/activator-windows.ts
- 3 packages/@ooc/core/extendable/lark/feishu-doc/open-method.ts
- 3 packages/@ooc/core/extendable/lark/feishu-chat/open-method.ts
- 3 packages/@ooc/core/executable/windows/talk/delivery.ts
- 2 packages/@ooc/core/reflectable/index.ts
- 2 packages/@ooc/core/persistable/thread-json.ts
- 2 packages/@ooc/core/executable/tools/exec.ts
- 1 packages/@ooc/core/thinkable/knowledge/activator.ts
- 1 packages/@ooc/core/thinkable/context/window-enrichment.ts
- 1 packages/@ooc/core/persistable/flow-object.ts
- 1 packages/@ooc/core/persistable/debug-file.ts
- 1 packages/@ooc/core/extendable/lark/feishu-doc/index.ts
- 1 packages/@ooc/core/extendable/lark/feishu-chat/index.ts
- 1 packages/@ooc/core/executable/windows/method_exec/submit.ts
- 1 packages/@ooc/core/executable/windows/method_exec/index.ts
- 1 packages/@ooc/core/executable/tools/close.ts
- 1 packages/@ooc/core/executable/permissions.ts
- 1 packages/@ooc/builtins/pr/delivery.ts
- 1 packages/@ooc/builtins/_shared/executable/delegator.ts

---

## readable 投影渲染 leaf（xml.ts / object-windows.ts / activator-windows.ts）跟进

本 leaf 把 readable 投影渲染收口到新承重墙 registry API（`resolveReadable` /
`resolveWindowClass` / `resolveObjectMethods` / `getClass`）+ `OocObjectInstance` 信封。
三个文件 tsc 0 错误。改动要点：

- **xml.ts**：renderer 现以 `OocObjectInstance` 为元素。投影调用形状：
  `resolveReadable(inst.class)?.readable({thread, object:{id,class}, persistence}, inst.data, inst.win)`
  → `ReadableProjection{class, content}`；content 是 `XmlNode[]` 直接用、string 包成 `<readable>` 文本节点。
  实例 `<window>` 的 `class=` 取**投影 class**（projection.class，非 inst.class）。
  无 Class.readable 时回退读盘 readable.md（投影 class=inst.class），都无则 placeholder 投影。
  `computeVisibleMethodSet` **签名变更** `(ownerClass, projectionClass, thread, registry)`：
  按 `resolveWindowClass(ownerClass, projectionClass)` 取 decl，object_methods 从
  `resolveObjectMethods` 按引用名挑、window_methods 直取；for_reflectable 仍门控。
  `<window_classes>` 声明层按**投影 class** 分组声明一次。
- **object-windows.ts**：`ensureSelfObjectTypeRegistered` / `derivePeerObjectWindows` 改用
  `defaultServerLoader.loadAndRegisterStoneClass(stoneRef, objectId, registry)`（新 OocClass 加载注册），
  弃 `registerNewObjectType` / `loadObjectWindow` / `getObjectDefinition` / `ensureBuiltinClassRegistered`。
  `derivePeerObjectWindows` 现返回 `OocObjectInstance[]`（class=peerId, data={}）。
  self load-error fail-loud 改为注册一个最小 OocClass（只有 readable 投影出错误内容）。
  builtin 父类链 ensure 已删——新 registry 由 builtins side-effect register + 自动 root 缺省覆盖。
- **activator-windows.ts**：产出从 flat `KnowledgeWindow` 改为 `OocObjectInstance<KnowledgeData>`
  （path/source/body/presentation/description 移入 `.data`，parentWindowId→parentObjectId）。

### 新增坏测试 / story（本 leaf 改签名所致，只登记）
- packages/@ooc/core/thinkable/context/renderers/__tests__/render-methods-node.test.ts
  —— 全部 case 用旧 `computeVisibleMethodSet({id,class}, thread, registry)` 3 参 + `registerNewObjectType`，
  须重写为新 4 参 `(ownerClass, projectionClass, thread, registry)` + `register(OocClass)`。
- packages/@ooc/storybook/stories/thinkable.story.ts:69 —— 同上，旧 3 参 computeVisibleMethodSet。
- packages/@ooc/core/thinkable/context/__tests__/self-object-load-error.test.ts
  —— ensureSelfObjectTypeRegistered fail-loud 回归，依赖旧 registry/loader 形状，须按新 loadAndRegisterStoneClass 重写断言。

### 需其他 leaf 跟进的点（本 leaf 范围外）
- **inbox/outbox 去重丢失**：旧 xml.ts 经 `def.consumedMessageIds`（已删 hook）去重 transcript 已消费消息，
  本轮丢弃。顶层 inbox/outbox 现直接渲染 thread.inbox/outbox 全量。去重职责应由 talk/transcript
  readable 投影自身承担（投影时不再重复渲染已并入 transcript 的消息），或由新窗生命周期 hook 提供。
- **compress 渲染丢失**：旧 compressView hook（level 1/2 压缩态渲染 + `<compressed>` expand 提示）已删，
  本轮不重建。压缩态展示若仍需，应作为 readable 投影态（win）的一档由各 class readable 自行表达。
- **sharing 渲染丢失**：旧 window.sharing（readonly-ref / moved 借出态 titlePrefix + read_only 属性）
  本轮丢弃（OocObjectInstance 无 sharing 字段）。共享语义按对象模型裁决=「开第二个 view」，由 readable 投影表达。
- **snapshot/pipeline 类型**：`ContextSnapshot.windows` / `PipelineContext.windows` 仍声明 `ContextWindow[]`，
  pipeline `as ContextWindow[]` 强转，processors（system/peer/activator）仍返回 `ContextWindow[]`。
  实际运行时元素已是 `OocObjectInstance`（xml.ts render 里 `as unknown as OocObjectInstance[]` 收口）。
  应由 snapshot/pipeline leaf 把 `windows` 类型统一改为 `OocObjectInstance[]`，消除强转。
- **server-loader 旧 wrapper**：`loadObjectWindow`（返回 `Partial<ObjectDefinition>`）已被
  `loadStoneClass` / `loadAndRegisterStoneClass` 取代——确认无残留调用方后可删。

---

## AgentOfPersistable/Loader leaf（server-loader + builtin 装载 + 旧 barrel 收口）

本 leaf 范围 4 文件 tsc 全绿：`runtime/server-loader.ts` / `core/extendable/index.ts` /
`core/executable/windows/index.ts` / `core/executable/windows/_shared/{registry,types}.ts`。

### 新装载入口形状
- **server-loader.ts**：弃 `loadObjectWindow`（返回旧 `Partial<ObjectDefinition>`）。改为
  `loadStoneClass(stoneRef) → { cls: OocClass, parentClass } | undefined`（读 stone 目录
  `index.ts` 的 `export const Class` + package.json `ooc.class`，按 index.ts mtime 缓存；
  无 index.ts = 纯 self.md/readable.md 对象 → undefined；缺 Class export → fail-loud throw）。
  注册收口入口 `loadAndRegisterStoneClass(stoneRef, objectId, registry) → boolean`
  （调 `registry.register(objectId, cls, { parentClass })`；无 index.ts 返回 false）。
  旧 `resolveExecutableFile`/`loadReadableTs`/readable.ts 合并逻辑全删——world 对象与 builtin 同形
  （单 index.ts 装配 Class），不再读独立 `executable/index.ts`(`export const window`) + `readable.ts`。
- **extendable/index.ts**：弃 side-effect `import "@ooc/builtins/xxx"`。改为显式
  `import { Class as XxxClass } from "@ooc/builtins/xxx"` + `builtinRegistry.register("_builtin/xxx", XxxClass)`。
  装载集：knowledge/file/todo/search/skill_index/plan/terminal_process/interpreter_process/
  filesystem/terminal/interpreter/runtime/knowledge_base/thread(parentClass:"talk")。末尾 `import "./lark/index.js"`。
- **executable/windows/index.ts**：root/pr/reflect_request 经 `export const Class` 显式 register
  （root parentClass:null、pr 隐式 root、reflect_request parentClass:"_builtin/thread"）；
  talk 仍 side-effect import（核心会话基类，待其改用 register）；method_exec 模块已被承重墙 owner
  删除（form 收集机制废弃），仅保留 object-registry 的 BASE_CLASS_ANCHOR；再 `import "../../extendable/index.js"`。
  本 leaf 同步删了 `_shared/types.ts` + `windows/index.ts` 里对已删 `../method_exec/types.js` 的
  `MethodExecWindow` 引用（export/import/union/re-export）。

### 删的死 barrel / 符号 re-export
- **windows/index.ts**：删旧 deferred-hook 类型 re-export（ObjectDefinition/OnCloseHook/OnCloseContext/
  RenderContext/ReadableFn）；删 `export { ROOT_METHODS, getOpenableMethods, deriveRootIntentPaths,
  execRootMethod } from "@ooc/builtins/root"`（getOpenableMethods/deriveRootIntentPaths/execRootMethod
  已不存在；ROOT_METHODS 仅在 root/executable/index.ts 内部，未从包 index 导出）；删
  `queueMicrotask(assertAllObjectDefinitionsRegistered)`（assert 符号已删）。
- **windows/_shared/registry.ts**：收口（未删——`builtinRegistry`/`createObjectRegistry`/`ObjectRegistry`/
  `filterMethodsByVisibility`/`ObjectMethod`/`ContextWindow` 仍有大量 live importer）。删
  re-export `OnCloseContext/OnCloseHook/RenderContext/ReadableFn/CompressViewHook/ObjectDefinition`
  （canonical `_shared/types/registry.ts` 已不导出）；保留 `RegisteredClass`/`MethodVisibilityContext`。
- **windows/_shared/types.ts**：删 4 个塌缩为空 `Data` 的窗类型（SearchWindow/FilesystemWindow/
  RuntimeWindow/KnowledgeBaseWindow——对应 builtins 包 types.ts 现只有空 `interface Data {}`，
  无 `XxxWindow`）：从 export/import/ContextWindow union 一并移除。SearchMatch 仍保留。

### 需其他 leaf 跟进（本 leaf 改动直接造成）
- **loadObjectWindow 三个 live 源码消费者**须迁到 `loadStoneClass`/`loadAndRegisterStoneClass`：
  `core/app/server/bootstrap/recovery-check.ts` / `core/app/server/modules/flows/service.ts` /
  `core/app/server/modules/stones/service.ts`。object-windows.ts 已在上文「需其他 leaf 跟进」登记。
- **windows/index.ts 删除的 SearchWindow re-export** 影响一处 e2e（context-compression-p0c-typed.test.ts，
  import SearchWindow）——已是坏测试。
- **talk/index.ts** 仍用已删 `builtinRegistry.registerWindowClass`，未迁 `register(OocClass)`——
  本 leaf side-effect import 它但不改其实现（范围外）。talk 是核心会话基类，迁移前其 class 不会注册进
  registry，thread(parentClass:"talk") 继承链断。须有 leaf 把 talk 改成 `export const Class` + 在
  windows/index.ts 改为显式 register（类比 root/pr/reflect_request），届时把 side-effect import 换掉。
  （method_exec 模块已被承重墙 owner 删除，不再需要迁移——其 form 收集机制整体废弃。）
- **MethodExecWindow 类型已随 method_exec 模块删除**，但 `tools/index.ts` / `_shared/schema-fill.ts` /
  `thinkable/knowledge/activator.expr.ts` 等仍按类型引用它——属承重墙 ripple，须由相应 leaf 收口。
- **lark（feishu-chat/feishu-doc）** 同样仍用 `registerWindowClass`——extendable/index.ts 末尾仍
  side-effect import lark（范围外，未迁）。

---

## persistable leaf（持久化 + bootstrap + package.json + members 注入）

承重墙 `thread.contextWindows: OocObjectInstance[]`（data/win 分离）落地到持久化层。改了 6 文件：
`executable/windows/_shared/window-persistence.ts`（重写）/ `persistable/thread-json.ts`（重写）/
`persistable/flow-object.ts` / `persistable/stone-object.ts` / `app/server/bootstrap/instantiate-classes.ts` /
`executable/windows/_shared/init.ts`（self/peer/creator/member 注入全迁 OocObjectInstance）。
**这 6 文件 tsc 0 错误**；其余 @ooc tsc 错误均为他 leaf ripple（与本 leaf 无关）。

### 新持久化形状（data/win 分离落盘）
- `inst.data`（业务数据，object 维度，跨线程）→ 各独立 object 的 `state.json`。
  优先 `resolvePersistable(class).save/load`，否则系统默认（`writeRuntimeObjectState` 包 `{id,class,data}` 信封）。
- `inst.win` + 身份信封（id/class/title/status/createdAt/parentObjectId）→ thread `thread-context.json` 的 inline entry。
  独立 object 的 entry **剥 data**（data 在 state.json，不重复）；builtin-feature class 整窗 inline（含 data，无独立 state）。
- 读回（`hydrateContextWindows`）：每条 entry = 信封；独立 object 另读 state.json 合回 `inst.data`；
  builtin-feature inline entry 整条即实例。未注册 class 丢弃打 warn。

### bootstrap 新判定
- `instantiate_with_new_world` 字段**废弃**。`instantiateBuiltinClassObjects` 改为：遍历 BUILTIN_OBJECT_IDS，
  读其 builtin 包 package.json，`ooc.kind === "object"` 才实例化（当前命中 supervisor / user）。
  `kind:"class"`（`_builtin/<id>` 五件套）不实例化。instance 的 `ooc.class` 取 builtin 包自身声明的父类
  （supervisor→`_builtin/agent`；user 无 class）。self.md 直接从 builtin 包根 `self.md` 读（bare id 不走
  resolveBuiltinReadDir，故不经 readSelf——已删 readSelf import）。

### package.json 字段
- `createStoneObject` 删死字段 `type:"agent"`；保留 `kind:"object"` + 可选 `class`。

### 刷盘回调注回 WindowManager.fromThread hooks
- `WindowPersistence.hooksFor(thread)` 产出 `{ reportDataEdit(objectId), reportContextEdit() }`，
  注回 `WindowManager.fromThread(thread, registry, hooks)`。
  - reportDataEdit(objectId)：从 live Map 取实例 → saveData（刷它的 state.json）。
  - reportContextEdit()：writeThreadContextSnapshot（刷 thread-context.json）。
  - 地基缺省 no-op（manager hooks 全可选），墙内自洽。
- **本 leaf 未改 manager.ts（承重墙）**；只提供 hooks 工厂。**接线点尚无 live 调用方**：需有 leaf 在
  实际建 manager 的地方（thinkable/context、tools/exec、flows/service 等）把
  `WindowManager.fromThread(thread, registry, new WindowPersistence(registry, mgrInstancesMap).hooksFor(thread))`
  接上。目前 manager 自持 `instances` Map 是 private，hooksFor 需要 live Map——接线 leaf 需暴露/共享该 Map
  或改由 manager 构造时内部 new WindowPersistence。**留作接线 leaf 决策点**。

### 非持久化实例约定（self/member/peer/creator）
- init.ts 注入的 self/member/peer/creator 实例标记 `win.transient === true`。
  `window-persistence.isTransientInstance()` 据此在 saveData / buildEntries 统一剔除（不落 state.json / thread-context.json）。
  这取代旧 `isSelfWindow/isMemberWindow` + `isNonPersistedWindow` 谓词。
- 旧字段 `isSelfWindow/isMemberWindow` 仍存于 `_shared/types/context-window.ts` 的 BaseContextWindow
  + `flow-thread-context.ts` 的 isNonPersistedWindow（**范围外**，未删）；这两处现已 dead（thread.contextWindows
  不再是 ContextWindow）。需有 leaf 收尾删除 BaseContextWindow.isSelfWindow/isMemberWindow + isNonPersistedWindow。

### 待其他 leaf 跟进（本 leaf 改动直接相关）
- **member-composition.test.ts**（执行层 fixture）：`fsWin.isMemberWindow` 现在落在 `inst.win.isMemberWindow`
  而非顶层；且其用的 `mgr.openMethodExec` 在新承重墙 manager 不存在 → 坏测试，须迁 instantiate/exec API + 改断言读 win。
- **init.ts 的 self/peer/creator 注入**本属 collaborable 域：本 leaf 仅为让文件 tsc 通过把它们迁成
  OocObjectInstance（projection 字段塞进 win，标 transient）。collaborable leaf 应正式接管这三处的 win 形状
  （creator 的 target/targetThreadId/conversationId/isForkWindow 等是否该规范成 talk class 的 win 类型）。
- **flow-thread-context.ts 的 buildThreadContextEntries**（旧版，吃 ContextWindow + talk-family POV 剥 class）
  已被本 leaf 的 `WindowPersistence.buildEntries`（吃 OocObjectInstance）取代于写路径；旧函数仍被
  flow-thread-context.ts 自身导出、可能有他处 importer → 须有 leaf 核对后删除或重写。
- **`computeProjectionClass`**（init.ts creator class 投影）仍依赖旧窗形态入参——保留可用，但属投影/collaborable
  域；新模型下 creator class 是否仍走 POV 投影由 collaborable 裁。

## AgentOfExecutable leaf —— tool 原语 + core 自有窗 + feishu 迁移 + 死代码清理

### 本 leaf 改动摘要（已落、范围内 tsc 通过）
- **tools/exec.ts**：废弃 form 收集（删 `mgr.openMethodExec` 调用 + method enum 的 `getOpenableMethods`）。
  新 dispatch：args 经本次 exec 直传；按 target window class 解析——先 object method（`mgr.execObjectMethod`，
  三参）、再 window method（`mgr.execWindowMethod`，四参），皆无则 fail-loud。expand/compress 仍由 tool 拦截。
  import 从坏 barrel `windows/index.js` 改为直引承重墙模块（`runtime/object-registry`、`_shared/manager`、
  `_shared/types/context-window`）。
- **tools/close.ts**：`mgr.close(objectId)`（单参 Promise<void>，无 onClose 拒绝返回）。删 onClose-拒绝分支。
  import 同样改直引承重墙。
- **builtins/root/executable/index.ts**：删 `bridgeLegacyExec`；open_feishu_chat/doc 的 `exec` 直接是新契约
  `executeOpenFeishuChat/Doc`。
- **extendable/lark/feishu-chat|doc/open-method.ts**：迁新契约 `exec(ctx,self,args)`；建窗经
  `ctx.runtime.instantiate("feishu_chat"|"feishu_doc", args)`（不再 `ctx.manager.insertTypedWindow` + 强类型整窗）。
  删旧 `openFeishuChatMethod/openFeishuDocMethod` ObjectMethod 对象（含 onFormChange/intents）。
- **extendable/lark/index.ts**：barrel re-export 改导 `executeOpenFeishuChat/Doc`（替原 method 对象）。
- **app/server/runtime/worker.ts**：talk 窗读取改经 `talkView(inst)` helper（兼读实例信封顶层 / inst.data 的
  target/targetThreadId，因 talk class data 迁移在途）；import `TalkWindow`→`OocObjectInstance`。
- **method_exec 处置（裁决：删执行体、保留 type）**：删整个 `executable/windows/method_exec/` 的执行体
  （index.ts/refine.ts/submit.ts/readable.ts/__tests__），删 windows barrel 的 `import "./method_exec/index.js"`。
  **保留 `method_exec/types.ts`（仅 MethodExecWindow 类型）**——它仍被 `_shared/types.ts` 的 ContextWindow
  union + web `MethodExecWindowDetail.tsx` 引用（窗类型 union 尚未被 readable/types leaf 收口）。method_exec
  仍是 object-registry 的 BASE_CLASS_ANCHOR（无 methods/readable），无害保留。
- **死代码删除**（确认零 live importer）：
  - `builtins/_shared/executable/delegator.ts`（无任何 importer）。
  - `builtins/_shared/executable/process-history-viewport.ts` + `viewport-adapter.ts`（互引死簇；
    唯一外部引用是 `__tests__/process-history-viewport.test.ts`；`process-readable.ts` 仅注释提及不 import）。

### talk 旧窗处置（核心裁决点 —— 拿不准，未删）
- core `executable/windows/talk/` **未删除、未收口**。理由：Supervisor 裁决前提是「仍有效逻辑已在 builtin
  thread class」，但**实际未迁移**——`builtins/thread/executable/index.ts` 的 methods 为空，其自身注释明言
  「talk 迁到新契约后把 say 归位到 thread.executable」（deferred）；且 `talk/delivery.ts`（deliverTalkMessage）
  仍被 `app/server/modules/flows/service.ts` live import。强行删 talk 会拔掉运行时唯一的 talk 窗注册 + delivery。
- talk 模块自身全量是旧契约（`registerWindowClass` / `MethodExecutionContext` / `MethodOutcome` /
  `SharingState` / `onFormChange` / `kind:"constructor"`），本就不 tsc 通过——属 **talk 迁移 leaf** 的工作，
  非本 leaf「opener + 死代码」范围。**建议：另起 talk-migration leaf**，把 say/wait/close/share/talk(构造)/fork
  迁到新 OOC class 契约并归位 builtins/thread+talk class，再删 core 旧 talk 窗 + 收口 worker.ts 的 talkView。

### 新增坏测试（本 leaf 改动直接所致，只登记不修）
- `executable/windows/__tests__/process-history-viewport.test.ts`：依赖已删的
  `_shared/executable/process-history-viewport.js`（死簇）→ 应随该模块一并删除。
- `executable/__tests__/tools.test.ts` / `executable/__tests__/step2-windows.test.ts`：调旧 `mgr.openMethodExec`
  / method_exec refine/submit form 流 → 须改写为新 exec 直传 dispatch 断言。
- `executable/__tests__/commands-execution.test.ts`：import 已不存在的 `root/executable/method.{end,plan,talk,todo}`
  （agency 早迁 _builtin/agent）→ 与 method_exec/talk 迁移一并修。
- 注：`tools/wait.ts` 及大量 `_shared/types.ts` 消费方的新增错误**非本 leaf 所致**——是并行的承重墙/types leaf
  把 `_shared/types.ts` 的 `ContextWindow` union 改形（不再有 .class/.status 等平铺字段）级联，属 types/readable leaf。

### 需其他 leaf 跟进
- **feishu 窗类 class 迁移**（范围外）：`extendable/lark/feishu-chat/index.ts` + `feishu-doc/index.ts` 仍用
  已删的 `registerWindowClass` + `RenderContext` + `MethodExecutionContext`（refresh/search/send/reply/read/
  append/patch_block/share_link 等方法）。本 leaf 的 opener 已调 `instantiate("feishu_chat"|"feishu_doc")`，
  **但 feishu class 当前无新契约 construct**——须 feishu-leaf 把这两个 index.ts 迁为 OOC class（construct 产 Data
  + executable methods 新契约），否则 opener 运行时 instantiate 会 throw「no constructor registered」。
- **talk-migration leaf**（见上）：迁 talk 行为到 builtins/thread+talk class、删 core 旧 talk 窗、收口
  worker.ts talkView。

---

## Wave 4 · talk-family 迁移 leaf（AgentOfCollaborable，2026-06-15）

承接上文「talk 旧窗处置」预留的 talk-migration leaf。把 talk 全量迁到新 OOC class 契约。

### 已落地（这些文件 tsc 通过，本 leaf 全 scope 干净）
- **`core/executable/windows/talk/`** 重写为新契约 OOC class：
  - `types.ts`：新增 `TalkData`（target/targetThreadId/isForkWindow/isCreatorWindow/conversationId）
    + `TalkWin`（transcriptViewport 投影态）；旧 `TalkWindow`（窗即平铺 struct）降为 **deprecated 过渡
    别名**（域外消费方 flows/model.ts、context/index.ts、web、`_shared` 的 ContextWindow union 仍引）。
  - `index.ts`：`export const Class: OocClass<TalkData>` = construct（peer 校验 target stone 存在 /
    fork 派生子线程）+ executable + readable；`builtinRegistry.register("talk", Class, {parentClass:null,
    isBuiltinFeature:true})` 取代旧 `registerWindowClass`。删 compressTalkWindow / onCloseTalkWindow /
    SharingState / onFormChange / kind:"constructor" 等旧契约残留。
  - `executable/index.ts`（新）：say / close / share 作为 object method（`(ctx, self=TalkData, args)`）。
    say 据形态分流：peer→磁盘 talk-delivery、fork→内存树派送（findThreadInScope）。
  - `readable/index.ts`（新）：投影 class=talk + transcript-or-handle（复用 `renderTranscriptOrHandle`）；
    window method `set_transcript_window` 调投影态 win.transcriptViewport。
  - `delivery.ts`：`resolveCalleeReplyToWindowId` 从 `inst.data`（TalkData）读 target/targetThreadId
    （取代旧 `as TalkWindow` 平铺读）；其余 deliverTalkMessage 保留（caller 侧扁平 TalkWindow 视图）。
  - `fork.ts`：保留 findChild/findThreadInScope/makeMessage/appendInbox/archiveForkChild；删
    `returnBorrowedOwnersFromChild`（依赖已删 sharing 字段）。
  - **删除**：`method.wait.ts` / `method.close.ts` / `method.share.ts` / `method.set-transcript-window.ts`
    （逻辑迁入 executable/readable；wait 保持 3 原语地位在 `tools/wait.ts`，未迁成 method）。
- **`builtins/thread/executable/index.ts`**：methods 留空注释更新——say/close/share 经 class 链从 talk 继承
  （thread `parentClass:"talk"` 已注册），wait 是独立原语。
- **`app/server/modules/flows/service.ts`**：
  - `loadObjectWindow` → `loadStoneClass(stoneRef)`（callMethod HTTP 路径）；方法查找改为
    `cls.executable.methods.find(name)` + 新 3 参 `exec(ctx, self, args)`。
  - 三处 user talk_window 构造经新 helper `buildUserTalkWindow`（产 OocObjectInstance + 扁平 view）
    + `syncTalkViewToInstance`（delivery 回填 targetThreadId 同步回 inst.data）。
  - `extractTalkPeers` / 幂等复用 / sendUserMessage 过滤改从 `inst.data` 读会话字段。
  - `extractShareInfo` 降为恒空（sharing 已删，share 借/还机制待重设计）。
- **`app/server/runtime/worker.ts`**：`talkView(inst)` 收口为只读 `inst.data`（删 in-flight 兼读平铺顶层）。

### 登记为待续（agency 深层语义 / 设计根问题，本轮不闭合）
- **share window 引用借/还机制**：旧 share 的 readonly-ref / move / 归还所有权全依赖每窗 `sharing`
  字段（SharingState，新契约已删）+ ContextWindow 平铺 struct。新 OocObjectInstance 模型下「哪个 thread
  持有实例、引用如何投影、借/还所有权」需重新设计。talk.share method 保留骨架 + fail-soft 报「暂未支持」；
  service.ts extractShareInfo 恒空。**需 Supervisor 裁决 share 在对象模型下的新语义后再接回。**
- **fork 子 thread 的 creator self-view 窗**：旧 fork construct 内 `buildChildCreatorWindow` 造子 thread
  的 self-view talk 窗（H2 投影 class=thread/reflect_request）。新模型下 self-view 窗 = OocObjectInstance
  投影，应由子 thread 起 thinkloop 时 init 投影，不在 construct 内造。本轮 construct 只建 child ThreadContext
  + 写初始消息 + 挂父子链；**子 thread self-view 窗投影未接回**（需与 init/thinkloop 启动协作）。
- **share_windows 初始随传**：旧 fork construct 的 `share_windows` 语法糖（建窗即传 window）依赖已删
  sharing 字段，本轮 construct 不再支持。
- **readable 的 compressView / consumedMessageIds hook**：旧 registerWindowClass 注册的折叠/快照渲染
  （compressTalkWindow）+ 去重 hook（consumedMessageIds）随旧 ObjectDefinition 契约删除；新 ReadableModule
  契约无这两槽位。本轮未接回——**折叠 / 去重在新契约里的落点需 Supervisor 裁决。**

### 新增坏测试（本 leaf 改动直接所致，只登记不修）
- `builtins/thread/__tests__/thread-say.test.ts`：import 已删的 `thread/executable/method.say.js` +
  `thread/executable/say.js` + `execRootMethod` + `registry.getObjectDefinition`（旧契约符号）→ 须改写为
  「talk class 的 say object method 经 WindowManager.execObjectMethod dispatch」断言。
- `executable/__tests__/talk-fork-thread-tree.test.ts` / `executable/windows/__tests__/talk-delivery.test.ts`
  / `executable/windows/__tests__/sharing.test.ts` / `executable/__tests__/wait.test.ts` /
  `executable/windows/__tests__/transcript-viewport-integration.test.ts`：依赖旧 talk 平铺窗 struct /
  registerWindowClass / sharing 字段 / 旧 method dispatch → 须按新 TalkData + WindowManager dispatch 改写。
- `tests/integration/super-flow-channel.integration.test.ts` /
  `tests/integration/wait-state-transition.integration.test.ts`：跨 session talk + wait 状态迁移依赖旧 talk
  窗形态 → 随 talk 新契约改写断言。
- 注：上列大量 `_shared/types.ts` ContextWindow union 平铺字段缺失级联错误（compress.ts / wait.ts /
  window-hash.ts / permissions.ts / pr-delivery / schema-fill / debug-file 等）**非本 leaf 所致**——是并行
  types/readable/可见性 leaf 改 union 形态 + 删 registry 旧符号的级联，属那些 leaf。本 leaf 把非测试错误
  从 192 → 117（净减 75，零新增 error 文件）。

---

## 接线收尾 leaf（消除并行 leaf 留下的接线 gap）

本 leaf 范围：loadObjectWindow 消费方迁移 / feishu 窗类补 OocClass / persist hooks 接线 /
snapshot·pipeline 类型收口 / ContextWindow union 残留收口。**范围内文件全部 tsc 通过。**

### 接线点

- **loadObjectWindow → loadStoneClass / loadAndRegisterStoneClass**
  - `app/server/bootstrap/recovery-check.ts`：load-detection 改调 `loadStoneClass(stoneRef)`
    （import 该 stone 的 `export const Class`，坏 import/语法错误 throw → 记 broken）。
  - `app/server/modules/stones/service.ts` callMethod：旧 `loadObjectWindow(ref).methods[m]` 改为
    `createObjectRegistry()` + `defaultServerLoader.loadAndRegisterStoneClass(ref, objectId, registry)`
    → `registry.resolveObjectMethods(objectId)`（含继承链）筛 `for_ui_access` → 新契约
    `exec(ctx, self, args)` 调用（ctx={object:{id,class},args}；self={dir} cast 注入 reflectable 身份目录）。

- **feishu 窗类迁 OocClass**（`extendable/lark/feishu-chat/`、`feishu-doc/`）
  - types.ts：剥离 `extends BaseContextWindow`，新增纯业务 `Data`（chat: chatId/buffer/mode/…；
    doc: docToken/content/versionId/…）；旧 `FeishuChatWindow`/`FeishuDocWindow` 保留为 `@deprecated`
    可选信封别名（visible 层仍消费）。
  - index.ts：旧 `registerWindowClass({type,methods:Record,readable,可见性flag})` →
    `export const Class: OocClass<Data>`：construct（据 args 产初始 Data）+ executable（ObjectMethod[]，
    `(ctx,self,args)` 直接读写 self）+ readable（ReadableModule，投影 class + content；window 声明
    object_methods 引用 + 空 window_methods）。注册改 `builtinRegistry.register("feishu_chat"|"feishu_doc",
    Class, { parentClass: null })`。旧 onFormChange/intents/dry-run form 机制随新契约丢弃（dry-run gate 本身
    保留在 send/reply/append/patch_block/attach_to_chat 的 confirm 分支里）。share_link/attach_to_chat 仍经
    `ctx.thread.persistence.baseDir` 读 world 配置取租户 host。

- **persist hooks 接线 —— 选了第二条路径（manager 构造侧持有 WindowPersistence）**
  - 判断：「调用方传 hooks」最小改动不可行——`WindowPersistence.hooksFor` 的 reportContextEdit 经
    `writeThreadContextSnapshot` 序列化的是 **WindowPersistence 自身的 instances Map**（buildEntries 读 this.instances），
    且 hook 在 manager dispatch **内部**触发（早于调用方 `thread.contextWindows = mgr.toData()` 回写）。
    调用方无法拿到 manager 的 private live map，自建 map 会 stale → eager 刷盘失真。
  - 故按裁决退到第二路径：`manager.ts` 只加一个 `async attachPersistence(thread)`（hooks 改 `private`
    可后挂；已显式传 hooks 则不覆盖），动态 import `WindowPersistence` 并以 **manager 自身 live `this.instances`**
    构造，取 `wp.hooksFor(thread)` 装回 hooks——序列化口径与 live map 一致、不依赖回写时序。动态 import 避免
    wall→persist 静态依赖。**只加不删墙逻辑。**
  - 调用方接线：`executable/tools/exec.ts` 与 `executable/tools/close.ts` 在 `fromThread` 后
    `await mgr.attachPersistence(thread)`（exec 改 data/context、close 移除实例后经 hooks eager 刷盘）。

- **snapshot / pipeline / processors 类型收口**（pipeline 流通单元统一为 `OocObjectInstance`）
  - `snapshot.ts`：`ContextSnapshot.windows: ContextWindow[]` → `OocObjectInstance[]`。
  - `pipeline.ts`：`PipelinePhase.run` 返回 + `PipelineContext.windows` + `run()` 起点 cast → `OocObjectInstance[]`
    （删 `as ContextWindow[]`）。
  - `processors/{system,enrichment,activator,peer}.ts`：返回类型 `ContextWindow[]` → `OocObjectInstance[]`。
  - `thinkable/context/index.ts`：`isPeerWindow` / `reconcilePeerWindowsIntoContext` / `_renderedWindows`
    赋值 → `OocObjectInstance`（删 `as ContextWindow`）。
  - `renderers/xml.ts`：删 `snapshot.windows as unknown as OocObjectInstance[]` 强转（现为身份赋值）。
  - `budget.ts`：`ContextWindow` import 从 builtins union 改为 `_shared` 的 **base** ContextWindow——base 有
    budget 实际读的 id/title/provenance/relevance/compressLevel，且 OocObjectInstance 结构满足 base，故
    pipeline 的 OocObjectInstance[] 可直接流入 `allocate`。（budget.ts 不在严格文件范围，但它是 pipeline 的
    allocator、与 snapshot/pipeline 类型同源；改动仅 import 行 + 注释，未动算法。）
  - `protocol.ts` / `skill-index.ts` 两个 producer：原产出旧平铺窗（envelope 字段与业务字段混在一层、
    KnowledgeWindow/SkillIndexWindow `@deprecated` 别名）→ 改产正经 `OocObjectInstance<KnowledgeData>` /
    `OocObjectInstance<SkillIndexData>`（业务字段下沉 `data`，`parentWindowId`→`parentObjectId`）。
  - `window-enrichment.ts`：`enrichContextWindows` 依赖已删的 `registry.resolveEffectiveVisibleType`；按
    本轮「可见性短路丢弃」裁决降为类型对齐 pass-through（effectiveVisibleType 解析丢弃，pipeline 相位占位保留）。

### 范围外、未消除的 tsc 错误（归属其它 leaf）

均为并行 types/readable/可见性/talk-family leaf 改 union 形态 + 删 registry/manager 旧符号的级联，
**非本接线 leaf 所致**，本 leaf 未触碰：

- `executable/tools/wait.ts`（37）/ `executable/tools/compress.ts`（9）：读已删的 ContextWindow 平铺字段
  （class/status/isForkWindow/compressLevel/target/…）→ 属 wait/compress 维度 leaf。
- `observable/window-hash.ts`（10）：同上平铺字段读取 → observable leaf。
- `thinkable/knowledge/activator.expr.ts`（9）/ `activator.ts`（1）：import 已删 `MethodExecWindow` +
  读平铺字段 → knowledge 维度 leaf。
- `persistable/debug-file.ts`（3）/ `flow-thread-context.ts`（1）：`resolveEffectiveVisibleType` + 平铺
  字段 → persistable/可见性 leaf。
- `executable/permissions.ts`（1）：`registry.getObjectDefinition` 旧符号 → registry 消费 leaf。
- `executable/windows/_shared/schema-fill.ts`（1）：import 已删 `MethodExecWindow` → method_exec leaf。
- `reflectable/index.ts`（2）：`@ooc/builtins/pr` 重复 export `Class`/`Data` → pr builtin leaf。
- `builtins/pr/delivery.ts`（1）：PrWindow ↔ OocObjectInstance cast → pr builtin leaf。
- storybook stories（多）：用旧 registry/manager/loader 符号 → storybook leaf。
- 注：`MethodExecWindow` 按交付要求保留（web 仍引用），未在 `_shared/types.ts` union 动它；
  其消费方的 import 错误属各自 leaf。

### 本接线 leaf 直接所致的坏测试（只登记不修）

- `thinkable/context/__tests__/budget.test.ts`：用 builtins `ContextWindow` union 字面量喂
  `BudgetManager.score/allocate`；本 leaf 把 budget 入参从 union 改为 base ContextWindow，union 字面量
  （collapsed 后缺 base 字段、含 `method`/`boundFormId` 等已删字段）不再 assignable → 须改用 base/
  OocObjectInstance 形态的测试夹具。
- `thinkable/context/__tests__/attention-tiering.test.ts`：构造 `ContextWindow` union 字面量塞进
  `thread.contextWindows`（现 `OocObjectInstance[]`）→ 须改用 OocObjectInstance 夹具。
- `thinkable/context/__tests__/protocol-knowledge.test.ts`：import 已删 `MethodExecWindow`（属 method_exec
  leaf 的符号删除级联）。
- `thinkable/context/__tests__/self-object-load-error.test.ts` /
  `thinkable/context/renderers/__tests__/render-methods-node.test.ts`：用已删 `registry.getObjectDefinition`/
  `registerNewObjectType` 旧符号 + renderMethodsNode 旧 3 参签名（属 registry/renderer leaf）。

## 最后一批源码字段收口 leaf（2026-06-15）—— 平铺字段访问全收口

把仍读旧 `ContextWindow` 平铺字段的残留源文件统一收口到 `OocObjectInstance` 信封/`data`/`win`
三分离。**全部为字段访问/类型对齐改动，未重建任何已丢弃机制。**

### 已落地（这些文件非测试源 tsc 通过）

- `executable/tools/wait.ts`：`contextWindows` 改按 `OocObjectInstance[]` 遍历——信封字段
  （id/class/status）直读，talk 业务字段（target/targetThreadId/isForkWindow/isCreatorWindow）经
  `talkDataOf(w)=w.data as Partial<TalkData>` 从 `inst.data` 读。删 `ContextWindow` narrow cast。
- `executable/tools/compress.ts`：`compressWindowsClean` 读写 compressLevel 从平铺改投影态
  `inst.win.compressLevel`（immutable spread `{...window, win: {...win, compressLevel}}`）；id/class 信封直读。
- `observable/window-hash.ts`：`stripVolatileWindow`/`computeWindowContentHash`/`buildWindowsSnapshot` 入参
  改 `OocObjectInstance`；compressLevel 从 `inst.win` 读、snapshot `parentWindowId`←`inst.parentObjectId`；
  两 caller（`observable/index.ts`/`runtime/observable-store.ts`）删 `as ContextWindow[]` cast + 死 import。
- `thinkable/knowledge/activator.expr.ts`：删 import `MethodExecWindow`/`ContextWindow`，改 `OocObjectInstance`；
  `method_exec` 的 method 从 `inst.data.method` 读、parent 从 `inst.parentObjectId`；`isOpen`/`parentTypeOf` 入参对齐。
- `thinkable/knowledge/activator.ts`：knowledge `path` 从 `inst.data.path` 读，删 `KnowledgeWindow` 死 import。
- `persistable/flow-thread-context.ts`：talk-family 剥 class 的 destructure 改从 base `window` 解构（不再 cast 到
  含可选 class 的 union），消除 union 字面量 `class` 不存在错。
- `executable/windows/_shared/schema-fill.ts`：`MethodExecWindow` import 路径从已不再 re-export 的
  `./types.js` 修到 canonical `../method_exec/types.js`。
- `executable/permissions.ts`：`registry.getObjectDefinition(type).methods[m]` 旧符号 →
  `registry.resolveObjectMethod(class, method)`（沿继承链解析，单调用替代 per-type+root 两段查找）。
- `reflectable/index.ts`：`export *` 两个各自导出 `Class`/`Data` 的 builtin 包撞名 → 改 side-effect-only
  `import "..."`（本 barrel 只为触发 registerWindowClass 注册副作用，不转出符号）。
- `builtins/pr/delivery.ts`：投递构造从手搓平铺 `PrWindow` 改正经 `OocObjectInstance<PrData>`——pr 业务字段
  （issueId/reviewerObjectId/authorObjectId/authorThreadId）落 `inst.data`，信封字段落实例信封。

### 因丢弃机制登记待续（未重建）

- `persistable/debug-file.ts` 的 `captureContextSnapshot`：原靠 `registry.resolveEffectiveVisibleType` enrich
  每窗 `effectiveVisibleType`。该方法已随 Wave 4 删除（投影类解析改由 readable `computeProjectionClass`
  一处收口）。本 leaf **不重建**：删 enrich、`contextWindows` 直通 `OocObjectInstance[]`，`registry` 形参
  保留为 `_registry` 兼容调用方签名。`ContextSnapshot.contextWindows` 类型从 `ContextWindow[]` 改
  `OocObjectInstance[]`。若后续确需快照层 surface 投影类，应接 `computeProjectionClass` 而非复活旧方法。

### 新增坏测试（本 leaf 改签名所致，只登记不修）

- `observable/__tests__/window-hash.test.ts`：用 `ContextWindow` 字面量喂 `buildWindowsSnapshot`/
  `computeWindowContentHash`（现入参 `OocObjectInstance`）→ 须改 OocObjectInstance 夹具（含 compressLevel
  迁 `win.compressLevel`）。
- `thinkable/knowledge/__tests__/activator.test.ts` / `activator.expr.test.ts`：构造 `ContextWindow` 字面量塞
  `thread.contextWindows`（现 `OocObjectInstance[]`）+ import 已删 `MethodExecWindow` + 用已删
  `registry.registerNewObjectType` → 须改 OocObjectInstance 夹具 + 新 registry API。
- `executable/__tests__/wait.test.ts`：构造平铺 talk 窗字面量喂 wait（现读 `inst.data`）→ 须改信封+data 夹具。

## feishu 集成搬出 core + 删 extendable 层 leaf（AgentOfExecutable，2026-06-15）

把飞书集成从 `core/extendable/` 整体搬进 builtins 包，删除 extendable 层。**非测试源 tsc 0 错误。**

### 已落地
- **新建三包**：`@ooc/builtins/feishu_chat`（class，objectId `_builtin/feishu_chat`，parentClass:null）、
  `@ooc/builtins/feishu_doc`（class，`_builtin/feishu_doc`，parentClass:null）、
  `@ooc/builtins/feishu_app`（**单例 object**，objectId `feishu_app`，`ooc.kind:"object"` + `ooc.class:"feishu_app"`，
  带 own executable open_chat/open_doc + readable 接入面板）。cli.ts(larkExec/larkCheckAuth) + event-relay/
  (startLarkEventRelay/maybeForwardToLark) 收口进 feishu_app。
- **feishu_app 装载链**：windows/index.ts `register("feishu_app", Class, {parentClass:"_builtin/agent"})`
  注册名为 `feishu_app` 的 class（own method + 继承 agent）；BUILTIN_OBJECT_IDS 加 `feishu_app`；
  bootstrap 据 package.json `kind:object`+`class:"feishu_app"` 建实例 `objects/feishu_app`（class 字段=`"feishu_app"`）；
  dispatch 按实例 class 解析链 [feishu_app, agent, root]。
- **register 清单内联**：extendable/index.ts 的 14 个 builtin register + 末尾 lark side-effect 全部内联进
  `executable/windows/index.ts`（与 root/pr/reflect_request 并列），并补三个 feishu register。删 `import "../../extendable/index.js"`。
- **_shared 壳 importer 改指 canonical**：10 个 importer 从 `@ooc/core/extendable/_shared/*` 改指
  `@ooc/core/executable/windows/_shared/*`。
- **删整个 `core/extendable/`**；`root/executable/index.ts` 删 open_feishu_chat/doc method + import；
  `_shared/types.ts` 的 FeishuChat/Doc 类型 re-export 改指新 builtins 包；`app/server/index.ts` 的
  maybeForwardToLark/startLarkEventRelay import 改指 `@ooc/builtins/feishu_app`；core package.json 加三包 dep。

### 新增坏测试（extendable 删除所致的死 import 路径，只登记不修；均已在上文清单）
- `executable/__tests__/{create-object,root.command.write-file.versioning,evolve-self,file-overlay-redirect}.test.ts`：
  `import type { MethodExecutionContext } from "@ooc/core/extendable/_shared/method-types"` 路径已删 →
  须改指 canonical `@ooc/core/executable/windows/_shared/method-types`（这些测试本就因承重墙在坏测试清单中）。
- `thinkable/knowledge/__tests__/activator.expr.test.ts`：`await import("@ooc/core/extendable/_shared/registry.js")`
  路径已删 → 改指 canonical registry（本就在坏测试清单中）。

## P5 RuntimeHandle 补 callMethod / say 通道（AgentOfRuntime，2026-06-15）

`RuntimeHandle`（contract.ts）增补 `callMethod(objectId,methodName,args)` + `say(windowId,msg)`；
`WindowManager`（manager.ts）实现两者（callMethod=execObjectMethod 薄封装，绑 threadRef；
say=委托 talk object method `say` via execObjectMethod(windowId,"say",{msg})）。接回消费方：
interpreter_process `self.callMethod` 经 `runtime.callMethod`（runtime 穿 runInterpreterExec→
runTsJs→createInterpreterSelf）；agent.end auto-reply 经 `ctx.runtime.say(creatorWindowId,result)`
（findCreatorWindow 改读 inst.data 的 isCreatorWindow/target，原读信封是 Wave4 前残留 drift）。
**四个改动文件 tsc 0 错误。**

### 新增坏测试（只登记不修）
- `executable/__tests__/process.test.ts`：`import { runInterpreterExec } from "@ooc/builtins/interpreter_process"`
  —— 该符号在 P2 builtin 重组后不再从包根 re-export（只 import 不 export）→ TS2459 declares locally but not
  exported。**非 P5 引入**（P5 仅给 runInterpreterExec 加可选 `runtime` 参，不动导出面）；与该文件既有的
  runBashExec/executeTerminalProcessExec/runExec/TerminalProcessWindow 等死 import 同属 P1/P2 重组 ripple，
  须由 P2 决定是否补回包根导出。P5 对该文件无新增破坏（新参可选，旧调用站点不传仍编译/行为不变）。

## P2 删 deferred 悬空 helper（AgentOfExecutable，2026-06-15）

删掉新契约下无对应槽位、且无 live 调用方的 deferred 悬空 helper（compress / onClose / onFormChange 三类）。
**P2 范围内（builtins/{plan,file,interpreter,filesystem,runtime}）非测试源 tsc 0 错误。**

### 已删（无 live 调用方，确认后删）
- `builtins/file/readable/index.ts`：删 `compressFileWindow`（@deferred-hook compressView）——全仓无调用方。
  压缩=展示档位本应是 window method，但本 helper 纯悬空无接线 → 按裁决直接删，不重建。
- `builtins/knowledge/index.ts`：删 `rejectCloseNonExplicit`（onClose 拒关 helper）+ knowledge/{index,executable}
  的 deferred 注释。全仓无调用方。
- `builtins/filesystem/executable/index.ts`：删 4 个 `*_TIP`（GREP/GLOB/OPEN_FILE/WRITE_FILE）缺参引导文案
  （旧 onFormChange 残留）；缺必填参引导改由 method `schema` 的 `required`+`description` 表达，缺参时 fail-fast
  throw（对齐 interpreter.run 约定）。
- `builtins/pr/readable/index.ts`：删 onClose 拒关「过渡说明」注释段（无 helper 代码，仅注释）。
- `builtins/_shared/executable/utils.ts`：删头注释里已不存在的 `onFormChange`/`emptyIntent` 引用。

### 登记 crossPackage 待 close 路径接（本轮不重建级联/拒关逻辑）
- **knowledge 合成窗拒关**：合成来源（protocol/activator/relation）的 knowledge 由系统每轮再生，
  本不应可被 LLM 显式 close。原 `rejectCloseNonExplicit` 已删——若确需此策略，应在 `RuntimeHandle.close`
  路径据实例 `data.source` 拒绝，不在 builtin 包重建 hook。
- **pr 投递窗拒关**：pr 是系统投递的 reviewer 评审窗，reviewer 不应显式 close。同样登记到 close 路径接。
- **plan 级联归档子计划**：plan.close「cascades to sub plans」语义（method description 仍述）若需在 close
  时真正级联归档子对象，应由 close 路径统一处理（本轮无悬空 helper 残留，仅记此意图）。

### 范围外·未动（非 P2 范围 / 非悬空，仅说明）
- `builtins/agent/executable/method.{talk,plan,todo}.ts` 与 `builtins/reflect_request/executable/method.*.ts`
  的 `*_TIP`：**live 且承载跨字段条件必填语义**（如 talk 的 title|msg 依 target 二选一），非单字段 `required`
  可表达 → 不属悬空 helper，且超出 P2 指定范围（plan/file/interpreter/filesystem/runtime），未动。

### 坏测试（只登记不修）
- `builtins/example/__tests__/example.test.ts`：断言 `def.compressView` 已定义——该字段随 Wave 4 契约收窄从
  registerReadable 结果移除（OocClass 无 compressView 槽位）；且该测试还用旧 readable shape。承重墙坏测试，P2 不修。
- `tests/e2e/backend/context-compression-p0c-typed.test.ts` / `plan-window-basic.e2e.test.ts`：验收旧
  `compressView` hook 渲染——契约已无该 hook，承重墙坏测试，P2 不修。
- 多处测试 import filesystem 旧具名导出 `writeFileExec` / `openFileExec`（`core/executable/__tests__/{create-object,
  evolve-self,file-overlay-redirect,root.command.write-file.versioning}.test.ts`、`core/persistable/__tests__/
  flows-worktree-migration.test.ts`、`tests/e2e/backend/stones-versioning.e2e.test.ts`）——filesystem/executable
  现仅 `export default executable`（方法是内部 const grep/glob/open_file/write_file），这些具名导出在 builtin 重组中
  早已不存在，**非 P2 引入**（P2 仅删 *_TIP 局部常量，未动导出面）；承重墙坏测试，P2 不修。
- `builtins/file/__tests__/file-window-method.test.ts`：`import { … } from "@ooc/builtins/file/readable.js"`
  路径（包根子路径）不存在——非 P2 引入（P2 仅删 compressFileWindow，readable 默认导出未动）；坏测试待修。
- `core/executable/__tests__/process.test.ts`（P5 已登记）：`runInterpreterExec` 等不再从包根 re-export。
  **P2 裁决：不为已多符号失效的坏测试补回包根导出面**（重新铺导出=为坏测试反向加 surface，违退潮）；
  该测试整体属承重墙坏测试，待统一修测试阶段改指 canonical 子路径 import。

### 非 P2 所致（P1 并发改 types.ts 的 ripple，登记备查）
- `builtins/{file,plan}/visible/index.tsx`：`'../types.js' has no exported member 'FileWindow'/'PlanWindow'`
  + plan/visible 隐式 any——P1 从 types.ts 删/改 Window 别名所致，非 P2 改动；待 P1/visible 跟进。

## P1 ContextWindow union 收口 + 删 @deprecated 平铺别名 + web visible 迁移（AgentOfReadable/Web，2026-06-15）

把 `ContextWindow` union 收口为 `OocObjectInstance`（信封 + data + win 三分），删各 builtin types.ts
的 `@deprecated XxxWindow` 平铺别名，web 渲染层（context-snapshot 镜像 + visible 组件）改读
`OocObjectInstance`。**P1 范围内（各 types.ts + builtin visible/ + web）非测试源 tsc 0 错误。**

### 已落地（这些文件非测试源 tsc 通过）
- **core union 收口** `executable/windows/_shared/types.ts`：`ContextWindow = OocObjectInstance`
  （取代旧「每 class 一个平铺信封字段成员」的 discriminated union）。re-export 各 class 的纯
  `Data`/`Win`（RootData/TodoData/TalkData+TalkWin/PrData/.../FeishuChatData+FeishuChatMessage/…）
  供按 `.class` narrow 后断言 `.data`。
- **windows barrel** `executable/windows/index.ts`：删已删别名的 re-export（RootWindow/TodoWindow/
  TalkWindow/PrWindow/TerminalProcessWindow/InterpreterProcessWindow/FileWindow/KnowledgeWindow/PlanWindow），
  改 export `ContextWindow`/`OocObjectInstance`/`WindowStatus`/`BaseContextWindow`/`SearchMatch`/`PlanWindowStep`
  （后两者无外部别名消费方，保留兼容）。
- **删各 builtin types.ts 的 `@deprecated XxxWindow` 平铺别名**（13 处）：file/plan/feishu_chat/feishu_doc/
  interpreter/interpreter_process/root/knowledge/pr/reflect_request/terminal/terminal_process/skill_index/
  thread/todo + talk（`core/.../talk/types.ts` 删 `TalkWindow`，保留 `TalkData`/`TalkWin`）。types.ts 现只剩
  纯 `Data`（+ talk 的 `Win`）。
- **builtin visible/index.tsx 迁 OocObjectInstance**（prop 从平铺别名改 `OocObjectInstance<Data[, Win]>`，
  业务字段读 `.data.xxx`、投影态读 `.win`）：file（win=readable 的 `FileWin`，lines/columns 从 `.win`）/
  knowledge/todo/root/skill_index/plan/search/terminal_process（`.data` 给 ProcessWindowDetail）/
  interpreter_process（同）。visible/diff.tsx 组件吃 `WindowDiffProps`（loose `{previous,current}` + `readString`
  helper），未引别名、无需改（其 prev/current 来自后端 windowsSnapshot，shape 归 observable）。
- **web `context-snapshot.ts` 镜像收口**：`ContextWindow` = `_ContextWindowEnvelope & _ContextWindowData`
  （信封顶层平铺 + 业务 `.data` 按 class 区分 + 可选 `.win`），镜像后端 `OocObjectInstance`。新增导出
  `windowParentId(window)=parentObjectId ?? parentWindowId`（后端实例用 `parentObjectId`，兼容旧
  `parentWindowId`）。pipeline 函数（windowSummary/windowBadge/windowCharCount/filterMessagesForDoWindow/
  buildWindowNode 进程 history + sub-window parent / buildContextWindowsSection top-level 过滤）全改读 `.data` +
  `windowParentId`。
- **web visible 组件迁 `.data`**：`FeishuChatWindowDetail`/`FeishuDocWindowDetail`（`w = (window as X).data`）、
  `TalkWindowDetail`/`DoWindowDetail`（读 `window.data` 的 target/conversationId/targetThreadId/isCreatorWindow）、
  `ContextSnapshotViewer`（parent 行改 `windowParentId`；其余只用 `.class`/`.status`/`.id`/`.title` 信封字段）。
- **registry cast 收口** `builtin-visible-registry.tsx`：组件签名是 `{window: OocObjectInstance<Data,Win>}`，
  各具体 `Data` 与 web `ContextWindow` 不互相 assignable → 统一经 `as unknown as ComponentType<{window:
  ContextWindow}>`。

### 需收尾接缝（边界外文件引用已删别名，P1 未碰，留作 P2/P5/observable 收尾）
均为「删 `TalkWindow`/`FileWindow` 平铺别名」级联，消费方读扁平视图、属 collaborable/app-server/observable 域：
- `core/app/server/modules/flows/service.ts:24` —— import `TalkWindow`（user talk_window 扁平派送视图）。
- `core/executable/windows/talk/{delivery.ts:43, executable/index.ts:29, fork.ts:13}` —— import `TalkWindow`。
- `core/observable/window-hash.ts:16` —— import `FileWindow`（fileDiff 内容 hash）。
- **method_exec seam**：`MethodExecWindow`（core `method_exec/types.ts`，flat `extends BaseContextWindow`）
  P1 未动；web `MethodExecWindowDetail.tsx` 仍读它的平铺字段，web `ContextWindow` 的 `method_exec` 成员却把
  method 字段放进 `.data`。method_exec 是 core form 机制（非 builtin class），其运行时落盘 shape（flat vs
  envelope+data）归 P5 裁；裁定后 web ContextWindow 的 method_exec 成员 + MethodExecWindowDetail 需对齐。

### 新增坏测试（P1 删别名 / 改 web ContextWindow 形态所致，只登记不修）
- `web/src/domains/files/context-snapshot.plan.test.ts`：构造旧平铺 plan 窗字面量（title/steps/status 在顶层）
  喂 buildContextTree → 须改用「信封 + `data:{title,steps,status,...}`」夹具。
- builtin/core 测试 import 已删别名（`PrWindow`/`TalkWindow`/`FileWindow`/`KnowledgeWindow`/各 process/talk-family
  窗别名）：`builtins/pr/__tests__/pr-window.test.ts`、`builtins/thread/__tests__/thread-say.test.ts`、
  `core/observable/__tests__/window-hash.test.ts`、`core/executable/{windows/__tests__,__tests__}` 与
  `core/thinkable/{context,knowledge}/__tests__` 多个、`tests/{e2e,integration}` 多个——多数已在上文承重墙/talk
  迁移清单登记；P1 的别名删除使其 import 彻底失效。统一修测试阶段改用 OocObjectInstance 夹具 + 从
  `_shared/types.ts` 取 `Data` 断言。
- `builtins/example/__tests__/example.test.ts` import `ExampleWindow`：example/types.ts 已无此别名（P1 未删
  example——其早已只有 `Data`）；属既有承重墙坏测试。

---

## H2 —— talk/reflect_request 降级为 thread readable 投影 class（只登记，本轮不修）

本轮把 talk + reflect_request 从「注册 class（继承体系 reflect_request→thread→talk）」降级为
**thread readable 的投影 class**。thread 成为唯一会话载体注册 class；inst.class 所有会话窗统一
= `_builtin/thread`；talk/reflect_request 仅由 thread readable 内 `computeProjectionClass` 渲染期算出。
删除：talk 的 `index.ts(Class)`/`executable/`/`readable/`、整个 `builtins/reflect_request/` 包；
会话 say/close/share + 沉淀 new_feat_branch/create_pr_and_invite_reviewers 全部归 `builtins/thread/executable/`；
construct 迁 `builtins/thread/executable/construct.ts`（原 talkConstructor）。

### 死 import（引用已删模块/路径，import 即失效）
- `core/executable/__tests__/create-object.test.ts:19-20`、`core/executable/__tests__/evolve-self.test.ts:27-28`、
  `tests/e2e/backend/stones-versioning.e2e.test.ts:28-29`、`builtins/pr/__tests__/pr-window.test.ts:278-279`：
  import `@ooc/builtins/reflect_request/method.{new-feat-branch,create-pr-and-invite-reviewers}` —— reflect_request
  包已删。`executeNewFeatBranch`/`executeCreatePrAndInviteReviewers` 现在 `@ooc/builtins/thread/executable/
  method.{new-feat-branch,create-pr-and-invite-reviewers}`（同名导出），改 import 路径即可。
- `core/persistable/session-aware-read.test.ts:14`：import `talkConstructor` from `@ooc/core/executable/windows/
  talk/index` —— talk/index.ts 已删。talkConstructor 现在 `@ooc/builtins/thread/executable/construct.ts`。
- `builtins/thread/__tests__/thread-say.test.ts`：已是既存坏测试（引用旧 `getObjectDefinition`/`method.say.js`/
  `say.js`/`reflect_request`）；本轮架构进一步使其断言失效（say 同实例 delegation 模型已不存在——三投影
  共享同一 thread.say 实例本就是同一 method）。统一修测试阶段改断 `resolveObjectMethods("_builtin/thread")` +
  `resolveWindowClass("_builtin/thread", <投影>)`。

### 行为/断言失效（fixture 把投影值写进 inst.class 或断 inst.class==talk/thread/reflect_request）
本轮后 inst.class 一律 `_builtin/thread`；投影 class（talk/thread/reflect_request）只在
`ReadableProjection.class` / 渲染输出 `<window class=...>` 里出现，不在 inst.class。任何构造
`class:"talk"`/`class:"thread"`/`class:"reflect_request"` 会话窗夹具、或断言 inst.class 等于这些投影值的测试，
夹具须改为 `class:"_builtin/thread"` + 会话字段进 `inst.data`、断言改读渲染投影 class。涉及（按现有承重墙清单交叠，
未逐一跑实，统一修测试阶段核验）：
- `core/executable/windows/__tests__/{talk-delivery,transcript-viewport-integration,sharing,manager-method-dispatch}.test.ts`
- `core/executable/__tests__/{talk-fork-thread-tree,wait,tools,step2-windows,commands-execution}.test.ts`
- `core/executable/windows/_shared/__tests__/constructor-pathway.test.ts`
- `core/persistable/__tests__/thread-context-bypass-reload.test.ts`（剥 class 落盘特例已删——会话窗整窗 inline 落 inst.class=`_builtin/thread`）
- `core/thinkable/context/__tests__/{attention-tiering,peer-object-derive}.test.ts`、`core/thinkable/__tests__/context.test.ts`、
  `core/thinkable/context/renderers/__tests__/render-methods-node.test.ts`
- `core/thinkable/knowledge/__tests__/activator{,.expr}.test.ts`
- `tests/integration/{wait-state-transition,ooc6-object-unification.harness,super-flow-channel}.integration.test.ts`
- `tests/e2e/backend/{plan-share-parent-child,backend-multi-turn-followup,context-compression-p0c-typed,stones-versioning}.e2e.test.ts`

## windows/ 目录解散 leaf（2026-06-15）—— 实体文件按维度归位 + 桥删除

`packages/@ooc/core/executable/windows/` 整目录解散：桥文件删除收口 canonical、实体文件 git mv 按维度
归位、`__tests__` 随被测源迁到新位置、删除整个 windows 目录。**非测试源 tsc 0 错误；下列测试只随源迁移
+改 import 路径，逻辑未修（多数本就是前几个 wave 登记的坏测试，因引用已删符号 execRootMethod /
TalkWindow / FileWindow / MethodExecWindow 平铺别名 / 旧 mgr.openMethodExec 等）。**

### 文件落点
- `_shared/manager.ts` → `executable/manager.ts`；`_shared/schema-fill.ts` → `executable/schema-fill.ts`；
  `_shared/method-description.ts` → `executable/method-description.ts`
- `_shared/init.ts` → `thinkable/context/init.ts`
- `_shared/window-persistence.ts` / `_shared/session-path.ts` → `persistable/`
- `_shared/{viewport,transcript-viewport,conversation-render,projection-class}.ts` → `readable/`
- `method_exec/types.ts` → `_shared/types/method-exec.ts`（仅 MethodExecWindow 类型，web 引用）
- `talk/{delivery,fork}.ts` → `builtins/thread/executable/talk-{delivery,fork}.ts`；
  `talk/render.ts` → `builtins/thread/readable/talk-render.ts`；
  `talk/types.ts` 内容（TalkData/TalkWin/TalkWindowView）**合并去重进 `builtins/thread/types.ts`**
  （TalkData=Data、TalkWin=ThreadWin 别名 + TalkWindowView），原文件删除。
- 桥删除：`_shared/{registry,method-types,types}.ts` 删；`ContextWindow=OocObjectInstance` 覆盖 +
  per-class Data/Win re-export 收口进 canonical `_shared/types/context-window.ts`。
- 装载入口：`windows/index.ts` 的 builtin register 段 → 新模块 `runtime/register-builtins.ts`；
  原 `import "@ooc/core/executable/windows[/index.js]"`（side-effect / 动态 import）改 import
  `@ooc/core/runtime/register-builtins.js`。barrel 命名导出随各文件迁移直引新位置。

### 随迁的测试（import 路径已改指新位置，逻辑未修——已坏的继续坏）
- → `executable/__tests__/`：manager-method-dispatch / manager-dual-write / manager-refine-failed /
  report-edits / constructor-pathway / method-inheritance / member-composition / process-history-viewport /
  search-results-viewport / sharing / skill-index
- → `readable/__tests__/`：viewport / viewport-integration / transcript-viewport / transcript-viewport-integration
- → `persistable/__tests__/`：session-path
- → `builtins/thread/__tests__/`：talk-delivery

### 同源 source 收口（非测试，tsc 通过）
- `thinkable/context/budget.ts`：ContextWindow import 从 canonical（现 = OocObjectInstance，无 base 展示
  字段）改为 `BaseContextWindow as ContextWindow`——budget 实际读 provenance/relevance/compressLevel 等
  base 字段，OocObjectInstance 结构满足 base 故 pipeline 单元仍可直接流入。仅 import + 注释，算法未动。
- `executable/{permissions,tools,tools/exec,tools/close,tools/wait}.ts`、`web/.../MethodExecWindowDetail.tsx`：
  原用 `./windows/...` / `../windows/...` 相对路径引桥/实体，改指新 canonical 位置。

## persistable：thread 容器持久化下沉到 thread builtin（2026-06-16）

**原则**（用户拍板）：thread 是 builtin object，core 只提供框架与 API，不含 thread 序列化逻辑。
把 thread 的会话持久化**逻辑**（thread.json strip / thread-context inline 嵌入 vs `_ref` / inbox /
hydrate / writeSnapshot）从 `core/persistable/{thread-json,flow-thread-context,window-persistence}`
迁入 **thread builtin** `builtins/agent/thread/persistable/thread-container.ts`，经新契约
`PersistableModule.container`（`ThreadContainerPersistence`）注册；core 的 `writeThread`/`readThread`
与 manager persist hook 经 registry dispatch **委托**调用，core 仅留框架（object-data.ts 通用单对象
data IO、flow-thread-context 文件原语、串行写、路径原语）。

### 行为变更（fail-loud）
- `writeThread`/`readThread` 现**要求 thread builtin 已注册**（`resolvePersistable("_builtin/agent/thread").container`）；
  缺失则 throw（旧码在空 registry 下 `isInlinePersisted=false` 静默降级）。**用 bare `createObjectRegistry()`
  且不 import register-builtins 的单元测试会从「降级 pass」变「throw fail」**——属预期，修法：测试 setup
  `import "@ooc/core/runtime/register-builtins.js"`（boot 全量 builtin registry）。
- 受影响（运行时新坏，逻辑未变，待统一修时补 registration）：
  - `core/persistable/__tests__/thread-context-bypass-reload.test.ts`
  - `core/persistable/__tests__/thread-json-registry-read.test.ts`
  （二者本就在 tsc 坏堆；现运行时亦需 builtin 注册）

### 顺带退潮（非测试，源码）
- `core/reflectable/index.ts`：删除 dangling `import "@ooc/builtins/reflect_request"`（reflect_request 已
  退役为 thread 投影 class、包不存在，此 import 令整条 register-builtins 链 runtime 崩）。

## thread 初始 context 补全局单例成员（2026-06-16）
- `thinkable/context/init.ts` 的 `injectMemberWindowsIfObjectThread`：每个 agent thread 初始 context
  恒补 `_builtin/{filesystem,terminal,interpreter}` + `_builtin/agent/skill_index`（composition HAS-A
  默认成员，旧 `ooc.members` 声明退役的落地替代）；transient 重注入、user thread 不补、幂等。非测试 tsc 0。

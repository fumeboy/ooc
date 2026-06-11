# 类型系统清理进度（2026-06-10）

> 一次跨多轮的源码符号清理：统一 method API、收敛 readable 维度、剥离冗余/不良设计。
> 本文档跟踪**已完成 / 进行到一半 / 后续待办**，避免跨会话丢失进度。
> 原则（CLAUDE.md 性格段）：厌恶不良代码/注释、警惕新增名词、克制熵增。

## 总览：本轮动机

`ObjectDefinition` / method API 长期堆积冗余字段与重复定义。核心判断：
- **知识归 knowledge 维度**，不该塞进 readable 维度的 `basicKnowledge` 字段。
- **`renderXml` 与 `readable` 签名完全一致**，是同一能力的两个名字——留 `readable`。
- **`StoneObjectDeclaration` 与 `ObjectDefinition` 冗余**——stone 的 `export const window` 直接用 `Partial<ObjectDefinition>`。
- **`window type` 概念已废弃**，`ObjectType` 类型正在退役，registry 的 Map key 即 type，`ObjectDefinition.type` 字段冗余。
- **method 返回值**从三态 union 收敛为单一平铺 `MethodOutcome`，新增 `data` 字段供前端取数。

---

## ✅ 已完成（本轮，tsc 全绿）

### 1. MethodOutcome 平铺 + data 字段
- `MethodOutcome` 从 `{ok:true,result} | {ok:true,window} | {ok:false,error}` 三态 union
  → 单一 `{ ok: boolean; result?; window?; error?; data? }`（`_shared/types/method.ts`）。
- 新增 `data?: unknown`：`for_ui_access` 的 object method 经 HTTP `call_method` 调用时，前端从 `data` 取结构化数据渲染；LLM 路径只看 `result` 文本。
- 新增 `normalizeMethodOutcome(raw)` 纯函数：把 `undefined / 裸 string / MethodOutcome` 规范化。
- `manager.ts` 两处 outcome 判型简化（去 cast）。

### 2. ui_methods 统一为 ObjectMethod
- 删 `UiServerMethod` / `UiServerMethodContext`（`executable/object/types.ts`）。
- `UiMethods = Record<string, ObjectMethod>`；HTTP 入口（flows/stones `callMethod`）改 `entry.exec({ args })` + `normalizeMethodOutcome`，响应即 MethodOutcome（`data` 是前端取数通道）。
- 删两个 `httpContext()` / `createHttpMethodContext()` 桩。
- loader 函数 `loadUiServerMethods` → `loadUiMethods`。

### 3. CustomMethodContext 删除
- 删 `executable/object/object-types.ts` 的 `CustomMethodContext`（dispatcher 注入 programSelf 时直接用 `MethodExecutionContext & { programSelf }`）。

### 4. StoneObjectDeclaration 删除（与 ObjectDefinition 冗余）
- **删整个文件** `executable/object/object-types.ts`（只剩 SOD）。
- 所有引用改 `Partial<ObjectDefinition>`：`server-loader.ts`（含 `loadObjectWindow` 返回类型）、`object/types.ts`（`ServerLoaderEntry.window`）、`synthesizer.ts`（self + peer 注册）、`object-type-registrar.ts`。
- `basic-knowledge.ts` 给 LLM 的自写方法示例同步：去 `StoneObjectDeclaration` import + `title/description`，`export const window = { methods: {...} }`。

### 5. ObjectDefinition 删 renderXml（→ readable）
- `_shared/types/registry.ts`：删 `RenderHook` type + `ObjectDefinition.renderXml` 字段。
- `object-registry.ts`：registerReadable 的 Pick、mergeExistingDefinition、registerNewObjectType、seedFrom、`assertAllObjectDefinitionsRegistered`（改判 `readable`）全部去 renderXml。
- 核心 window 注册 `renderXml: fn` → `readable: fn`（签名一致）：`do` / `talk` / `relation` / `feishu-chat` / `feishu-doc`。
- `xml.ts` 渲染器：删死的 `renderXml` 兜底分支，已注册 type 全走 `resolveObjectReadable`（Step 1 `def.readable`）；无产出 → fail-soft 占位。
- re-export 链清理：`executable/windows/_shared/registry.ts`、`executable/windows/index.ts`、`object-registry.ts` 的 `RenderHook` 删除。

### 6. ObjectDefinition 删 type 字段
- `ObjectDefinition` 删 `type` 字段（registry Map key 即 type）。
- `BASE_TYPE_DEFINITIONS` 字面量去 `type:`；`registerNewObjectType` 不再写 `type`。
- ⚠️ **注意**：这是删 `ObjectDefinition.type` **字段**，不是删 `ObjectType` **类型**（后者另算，见待办）。

### 7. ObjectDefinition 删 basicKnowledge（type 级协议知识通道退役）
- `_shared/types/registry.ts`：删 `ObjectDefinition.basicKnowledge` 字段 + registerReadable Pick。
- 消费方删除：`protocol.ts`（step 3 type-level 注入整段）、`processors/system.ts`（skill_index basicKnowledge 注入 + `getSkillIndexBasicPath`）、`object-registry.ts` merge/seed。
- **orphan const 删除**（dead code）：`METHOD_EXEC_BASIC_KNOWLEDGE` / `RELATION_WINDOW_BASIC_KNOWLEDGE` / `TALK_WINDOW_BASIC_KNOWLEDGE` / `PLAN_BASIC_KNOWLEDGE` / `SKILL_INDEX_BASIC_KNOWLEDGE` / `SEARCH_WINDOW_BASIC_KNOWLEDGE` / feishu `PROTOCOL_KNOWLEDGE`×2。
- **⚠️ 行为后果（重要）**：这些是真注入给 LLM 的协议知识（method_exec 怎么 refine/submit、talk/relation/search/plan/skill_index 怎么用）。删字段后**这些知识不再注入 LLM context**。内容在 git history 可恢复。**后续应迁入 knowledge 维度**（`pools/<self>/knowledge/**`，用 `activates_on: window::<type>` / `method::<type>::<m>` trigger 激活）——见待办 B。

### 8. api.list-window-types 删除（window type 概念已废弃）
- 删 `app/server/modules/ui/api.list-window-types.ts` + `ui/index.ts` 路由注册（`/api/windows/_shared/types`、`/api/objects/_shared/types`）。

### 9. 测试同步（tsc 一致，未跑回归）
- `transcript-viewport-integration.test.ts`：`def.renderXml!` → `def.readable!`。
- `window-method-registry.test.ts`：registerNewObjectType 字面量去 `type:`。
- `server-self.test.ts`：注册去 renderXml/basicKnowledge。
- `fs-search.test.ts`：删 basicKnowledge 断言 + SEARCH_WINDOW_BASIC_KNOWLEDGE import。
- `render-context-xml.ts`：去 `trace`（ContextSnapshot.trace 已被删，外部改动）。

---

## 🔶 进行到一半 / 本轮新引入的待清理尾巴

### A. ✅ 前端 window-types catalog 死链删除（2026-06-11）
后端 `/api/objects/_shared/types` 已删 + tooltip 描述源 basicKnowledge 也已删（待办 7）→ 整个 command-chips
是双删死功能（catalog 永空 → `WindowCommandsChips` 永 return null）。整条链删除：
- 删 `web/src/domains/objects/window-types.ts`（73 行：useObjectTypes / getObjectTypeMethods /
  ObjectTypeCatalogEntry / fetchObjectTypes）+ `objects/index.ts` re-export。
- `ContextSnapshotViewer.tsx`：删 `WindowCommandsChips` 组件 + 渲染点 + 孤儿 `useObjectTypes`/`MarkdownContent` import。
- `styles.css`：删 14 行死规则（`.llm-input-command*`）。
- 顺带：陈旧 API 名 `registerObjectType`（已不存在的符号）在注释/测试 side-effect 注释里统一改 `registerExecutable`
  （保留 windows/index.ts:11 与 object-registry.ts:7 两处**历史删除记录**）；lark/index.ts header 去 `src/` 旧路径
  + 已删 `meta/case.feishu` doc 引用。

### B. type 级协议知识迁移（见已完成 7 的行为后果）
被删的 7+ 段 basicKnowledge const 应迁入 knowledge 维度。**这是功能性缺口**，不是纯清理——LLM 当前失去了 form 推进 / talk / search 等协议指引。优先级建议：**高**（影响 LLM 行为）。

---

## ⬜ 后续待办（明确范围）

### C. ObjectType 类型退役（牵扯大，慢慢清理）
- 定义：`_shared/types/context-window.ts:22 export type ObjectType`。
- 规模：**28 文件 / 99 处引用**（`grep -rn "ObjectType\b"`）。
- 现状：`ObjectDefinition.type` 字段已删，但 `ObjectType` 作为参数/泛型类型仍广泛存在（`registry` 各方法签名、`ObjectRegistry` Map 泛型、`lookupMethod(self: {type})` 等）。
- 方向：window type 概念已废弃，`ObjectType`（联合字面量 + `(string & {})`）应逐步替换为 `string`（type 即 objectId/类名，开放域）。
- 建议分批：先 registry 内部签名，再 thinkable/persistable 消费方，最后删定义。

### D. 其它已知遗留
- `extendable/lark/index.ts:10` 等注释仍称 feishu 为"一等 ObjectType" —— 随 C 一起更新措辞。
- storybook `L2_thinkable` / `L8_visible` story 断言 `/api/.../types` catalog（已删 API）——随 A 更新或删除该 story 断言。
- 后端测试 `server.routes.test.ts:437`、`ooc6-object-unification.harness.test.ts:158` 断言已删的 `/_shared/types` 路由——需更新（本轮未跑回归，tsc 不覆盖运行时路由断言）。

---

## ✅ 第二批（2026-06-11）：executable/object 删除 + ServerLoaderEntry 去冗余

### 10. executable/object/ 整目录删除
- `self.ts`（createProgramSelf）此前已随解释执行归位 `builtins/program/executable/`。
- `object-types.ts`（StoneObjectDeclaration）上一批已删。
- 本批删 `types.ts`（最后一个文件）→ `executable/object/` 目录消失。
  - `UiMethods` 定义内联进 `server-loader.ts`（唯一相关消费方）。
  - `StoneObjectRef` / `ThreadContext` 的 re-export 取消；`object-type-registrar.ts` 改从 `persistable` 引 `StoneObjectRef`。

### 11. ServerLoaderEntry 删除（与 ObjectDefinition 冗余）
- 冗余本质：`ServerLoaderEntry` 把 `window`（Partial<ObjectDefinition>）拆出来，又另存一个 `readable` 字段——而 `readable` 同属 `ObjectDefinition.readable`，被拆成两个来源。
- 处理：loader 把独立 `readable.ts` 的导出**合并进 `window.readable`**（`window.readable` 优先），缓存条目降为 loader-private 的 `LoaderCacheEntry { mtime, window, uiMethods }`（不再导出 interface）。
- 提取 `loadReadableTs` helper 消除两分支重复。
- 三个 loader 出口 → 两个：删 `loadObjectReadable`（实例 + module-level）。
- `xml.ts` `resolveReadableForType` 四层 readable 解析 → 三层：删 Step 3（`loadObjectReadable`），Step 2 的 `window.readable` 已含 readable.ts。**（已与用户确认其 thinkable 并行改动未碰 xml.ts）**
- 对象树锚点同步：programmable/self.md、self-written-method-hot-reload.md、authoring-objects.md、visible/self.md、visible-entry.md、two-faces-of-readable.md、method-set-effectiveness.md（loadUiServerMethods→loadUiMethods、StoneObjectDeclaration→Partial<ObjectDefinition>、删 loadObjectReadable、readable 三层→两层、server-loader 行号锚）。

### 🔶 本批发现的待决问题（已向用户标注，未擅自做）
- **ui_methods 维度本身冗余（重大设计问题）**：生产代码**零使用**（仅一个空示例 `basic-knowledge.ts:332`），只活在 storybook 测试 + 前端 client。method 已有 `for_ui_access` 标记——ui_methods 平行字典是冗余设计。理想终态：废弃 ui_methods，统一到 `window.methods` 里 `for_ui_access:true` 的方法，HTTP `callMethod` 改查 `def.methods + for_ui_access`。牵扯：storybook 13 处 ui_methods 写法、前端 client 调用契约、两个 service callMethod 端点。**需用户拍板**（属协议级变更）。
- **pre-existing**：server-loader 有 executable 分支的缓存失效只看 `serverMtime`，`readable.ts` 改了不失效（旧 bug，本批未动以免扩大范围）。

---

## ⚠️ 协作边界（2026-06-11）
- 用户**并行重构 thinkable 模块**（protocol.ts / processors/system.ts / knowledge/ / reflectable/ / snapshot.ts / renderers/{json,trace}.ts 等）——协议知识从硬编码 const 迁入 `builtins/root/knowledge/*.md`（activates_on 激活），正是本文档「待办 B」。
- **我的清理线绝不碰用户的 thinkable 重构文件**，也**不 commit**（避免裹挟用户未完成改动）。
- 当前 tsc 剩余错误（`reflectable-knowledge.test.ts` / `end-reflection-reminder.e2e.test.ts` / `root.command.refine-hint.test.ts`）**全部来自用户的 protocol 重构连锁**（`END_REFLECTION_REMINDER_KNOWLEDGE` / `collectProtocolEntries` 签名等），**不在我范围**。

---

## ✅ 第三批（2026-06-11）：废弃 ui_methods 维度 → window.methods + for_ui_access

动机：ui_methods 平行字典是冗余设计——method 早有 `for_ui_access` 标记。生产代码零使用，
只活在测试 + 前端 client。统一到 `window.methods` 里 `for_ui_access:true` 的方法。

### 12. 核心机制
- HTTP `callMethod`（stones + flows service）：`loadUiMethods` → `loadObjectWindow`，
  查 `window.methods[method]` 并校验 `entry.for_ui_access === true`，`exec` 返回值经
  `normalizeMethodOutcome` 规范化为 MethodOutcome（响应结构 `{returnValue}` → `{ok,data,result}`）。
- `ctx.self.dir` 能力保留：stones callMethod 注入 `ctx.self = { dir: stoneDir(ref) }`，
  让 for_ui_access 方法能读写自己 stone 文件（reflectable 核心，readSelf/evolve 等依赖）。
- loader：删 `UiMethods` 类型、`loadUiMethods`（实例 + module-level）、`LoaderCacheEntry.uiMethods` 字段。
- 前端 `ObjectClientRenderer.callMethodFor`：响应 `{returnValue}` → MethodOutcome，取 `data ?? result`，`!ok` 抛 error。

### 13. 测试/story 全量改写（fn→exec、returnValue→data、for_ui_access:true）
- **CI gate stories**（`_control-plane.test` + `_catalog.test`）：programmable / executable / visible /
  reflectable .story.ts + L3 / L7 .stories.ts 全改；L2 / L8 的 `/_shared/types` catalog story 删除（API 已废）。
- server-loader.test：`loadUiMethods` 测试 → `loadObjectWindow().methods[for_ui_access]`。
- server.routes.test：删 `/_shared/types` 双路由测试；ooc6-object-unification.harness：删 types-alias it。
- e2e frontend（3 文件）+ meta-programming + stone.test + server-self.test：ui_methods → window.methods。
- **删 `storybook/_verify.ts`**（645 行 legacy 单体，README 明示已迁 stories/，且用废弃 ui_methods）；
  同步 README + framework-design.md + control-plane.ts 注释锚点。

### 验证
- **CI gate `test:storybook`：63 pass / 0 fail**（从 65→63，删 2 个 types-catalog story）。
- loader/routes/stone/server-self 测试：29 pass / 0 fail。
- 全仓 `ui_methods` / `UiMethods` / `loadUiMethods` **零残留**（仅历史注释提及"已删 ui_methods"）。

---

## 验证状态
- 我的清理线（server-loader / object-registry / object-type-registrar / xml.ts / executable-object 删除 /
  service 端点 / ui_methods 废弃 / storybook 全套）**自身 tsc 干净**（不在错误列表）。
- 全量 `check-tsc` 因用户并行 protocol 重构有连锁错误（见上协作边界）。
- **未 commit**（用户并行改 thinkable，避免裹挟）。回归测试除 CI gate 外未跑（env-gated e2e 已同步改写但未实跑）。

---

## ✅ 第四批（2026-06-11）：ObjectType 类型彻底删除（commit 2ad55f1c）
- 不是改成 string alias——`ObjectType` 类型整体退役，全仓统一裸 `string`。
- 动机：ObjectType 是 window type 的历史债务；method/window method 注册已统一按 id（很多旧 builtin
  window 现在是 builtin object），type 已无独立语义。

## ✅ 第五批（2026-06-11）：window.type 字段 → window.class（本批）
- **运行时**：`BaseContextWindow.type` → `class`；ContextWindow discriminated union 各分支 discriminant
  `type:"do"…` → `class:"do"`；`ObjectRegistry.lookupMethod/lookupWindowMethod(self:{class})`。
- **序列化层统一**（关键裂缝修复）：`buildThreadContextEntries` ref 分支原写 `type: window.class`，
  inline 分支写整窗 `class`——字段名不一致。统一为 `class`：`ThreadContextEntry` ref 形态、
  `WindowSnapshotEntry`（observable/window-hash.ts + web/window-diff.helpers.ts）、`WindowDiffEntry`、
  `resolveWindowDiffKind` 全部从 `type` 收敛到 `class`。
- **误伤治理**：全局 `.type`→`.class` 误伤 90+ 非 window 的 `type` 字段（LlmInputItem.type、
  FlowObjectMetadata.type="flow-object"、React element `.type`〔test-utils 树遍历〕、`{type,path}` 知识
  helper、MethodArgSpec.type 等），按 tsc 列 + 运行时 fail 逐一还原。
- **验证**：`check-tsc` 0 error；`test:storybook` 63 pass / 0 fail；diff 渲染器 + 持久化 reconcile +
  P6 constructor + program-self 全部 383+ pass / 0 fail（误伤还原后）。
- **.ooc-world-meta 回流**（submodule commit d710baa）：programmable/self.md `window.type`→`class`、
  program-self-and-shell.md `getObjectDefinition(window.class)`、context-construction.md `（ObjectType）`/
  `type=peerId`→`class`。遗留 `thinkable/tests.md:45` L2 引用已删端点 `/api/windows/_shared/types` +
  ObjectType，需 AgentOfThinkable 整体重写该 test item（非符号替换），留作反馈未自改。

---

## 关键文件锚点
- method 类型：`packages/@ooc/core/_shared/types/method.ts`
- registry 类型：`packages/@ooc/core/_shared/types/registry.ts`
- registry 实现：`packages/@ooc/core/runtime/object-registry.ts`
- 渲染器：`packages/@ooc/core/thinkable/context/renderers/xml.ts`
- 协议知识注入：`packages/@ooc/core/thinkable/context/protocol.ts`
- ContextWindow / BaseContextWindow.class：`packages/@ooc/core/_shared/types/context-window.ts`
- 序列化 entry：`packages/@ooc/core/persistable/flow-thread-context.ts`（ThreadContextEntry / buildThreadContextEntries）

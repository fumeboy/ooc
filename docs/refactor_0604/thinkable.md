# thinkable 模块架构自审方案

> 模块：`packages/@ooc/core/thinkable/`
> 对应 OOC 维度：**thinkable**（思考能力）
> 撰写时间：2026-06-04

---

## 1. 我是谁

我是 OOC 架构中 **thinkable** 维度的承载模块——负责把 ThreadContext（线程状态 + 事件流 + 持久窗口）转换成 LLM 能消费的输入、调度 LLM 调用、处理 LLM 返回的文本与 tool call、管理多线程调度循环与中断恢复。一句话：**所有"喂给 LLM 什么、从 LLM 拿到什么、怎么安排下一轮"的事，都归我。**

我不做的事：不直接操作 ContextWindow 的增删改（归 executable）、不直接读写磁盘（通过 persistable 门面）、不实现具体的 tool 业务逻辑（归 executable/builtins）、不做 HTTP 路由（归 app/server）。

---

## 2. 我有什么（符号全景）

### context/

#### 顶层文件

| 文件 | 导出 | 说明 |
|------|------|------|
| `context/index.ts` (746 行，核心) | **类型**：`ProcessEventCommon`、`ProcessEvent`（11 种 event kind 的 discriminated union）、`ThreadMessage`、`ThreadContext`；**函数**：`buildContext`、`buildInputItems`；**Re-export**：`Intent`/`FormChangeEvent`/`MethodCallSchema`/`MethodArgSpec`/`IntentCache`/`IntentCacheEntry`、`hashArgs`/`diffArgs`（from intent）、`BudgetManager`（from budget）、`ContextSnapshot`（from snapshot）、`XmlRenderer`/`renderSnapshotToXml`（from renderers/xml）、`JsonRenderer`（from renderers/json）、`TraceRenderer`（from renderers/trace）、`ContextPipeline`/`createDefaultPipeline`/`PipelinePhase`/`PipelineContext`（from pipeline） | 模块中央 barrel + 核心类型定义 + 对外构建入口 `buildInputItems`。内嵌了 650 行的 `processEventToItems` 函数与 `findInboxMessage`/`resolveInboxWindowId`/`buildPathsItem`/`loadSelfInstructions` 等私有辅助函数。 |
| `context/context.ts` | **Re-export type**：`ProcessEvent`、`ThreadMessage`、`ThreadContext`；**Re-export fn**：`buildContext`、`buildInputItems` | thinkable 根目录的对外 barrel 薄封装，只转发 context/index 的一部分。 |
| `context/pipeline.ts` | **接口**：`PipelinePhase`、`PipelineContext`；**类**：`ContextPipeline`；**函数**：`createDefaultPipeline` | ContextPipeline 五阶段编排器（SystemProcessor → MethodFormProcessor → KnowledgeProcessor → ActivatorProcessor → PeerProcessor → BudgetManager.allocate）。 |
| `context/protocol.ts` | **函数**：`buildProtocolKnowledgeWindows`、`collectProtocolEntries` | 生成协议级 KnowledgeWindow：全局 basic/root、super session reflectable、type-level basicKnowledge、creator-reply protocol、end-form reflection reminder。 |
| `context/window-enrichment.ts` | **函数**：`computeFormKnowledgeEntries`、`enrichFormMethodKnowledge`、`enrichContextWindows` | Window enrichment：解析 effectiveVisibleType 继承链、计算 method_exec form 的 commandKnowledgePaths、从 onFormChange guidance 派生 knowledge entries。 |
| `context/skill-index.ts` | **函数**：`synthesizeSkillIndex`、`mergeSkillIndex`、`getSkillIndexBasicPath` | SkillIndexWindow 合成：扫描 stones 三级 skills 目录（branch/object/external），合并去重生成索引窗口。 |
| `context/activator-windows.ts` | **函数**：`buildActivatorKnowledgeWindows` | 基于 frontmatter trigger 的 knowledge 激活 → 生成 KnowledgeWindow（source=activator）。 |
| `context/intent.ts` | **接口/类型**：`Intent`、`MethodCallSchema`、`MethodArgSpec`、`FormChangeEvent`（3 kind）、`IntentCacheEntry`、`IntentCache`；**函数**：`hashArgs`、`diffArgs` | Intent 子系统：form 语义意图表达 + 参数哈希/差异计算，供 knowledge 激活与 cache 使用。 |
| `context/budget.ts` | **接口**：`BudgetThresholds`；**常量**：`DEFAULT_BUDGET_THRESHOLDS`；**类**：`BudgetManager`（方法 `score`、`allocate`）；**函数**：`loadBudgetThresholds` | P6 BudgetManager：基于 provenance/priority/recency/signal 的 relevance 打分 + token 预算分配。 |
| `context/snapshot.ts` | **接口**：`ContextSnapshot` | ContextPipeline 输出的结构化快照，供 renderer 消费。 |
| `context/render.ts`（deprecated） | **函数 @deprecated**：`renderContextXml`；**Re-export**：`escapeXml`（from xml） | 向后兼容 shim：包装 XmlRenderer，仅服务遗留测试。 |
| `context/xml.ts` | **类型**：`XmlNode`（3 kind）；**函数**：`escapeXml`、`xmlElement`、`xmlText`、`xmlComment`、`optionalElement`、`renderPathList`、`appendNode`、`serializeXml`、`truncateBytes` | XML AST + 序列化工具，供 XmlRenderer 与各 window type 的 renderXml hook 共享。 |

#### context/processors/

| 文件 | 导出 | 说明 |
|------|------|------|
| `processors/system.ts` | **PipelinePhase 常量**：`SystemProcessor` | Pipeline Phase 1：动态注册 self object type → 注入协议级 KnowledgeWindow → 生成 SkillIndexWindow + 其 basicKnowledge。 |
| `processors/method.ts` | **PipelinePhase 常量**：`MethodFormProcessor` | Pipeline Phase 2：原地 enrichment ctx.windows（effectiveVisibleType + commandKnowledgePaths）→ 派生 form-scoped KnowledgeWindow。 |
| `processors/knowledge.ts` | **PipelinePhase 常量**：`KnowledgeProcessor` | Pipeline Phase 3：intent-triggered knowledge 激活（扫描 intentCache，匹配 `activates_on` 的 intent trigger），带 per-(formId,argsHash) 缓存。 |
| `processors/activator.ts` | **PipelinePhase 常量**：`ActivatorProcessor` | Pipeline Phase 4：传统 frontmatter trigger 激活（object/method/objectId/super 四类 trigger）。 |
| `processors/peer.ts` | **PipelinePhase 常量**：`PeerProcessor` | Pipeline Phase 5：peer/children Object 自动注入（talk_window + stone 层级发现）。 |

#### context/renderers/

| 文件 | 导出 | 说明 |
|------|------|------|
| `renderers/xml.ts` | **类**：`XmlRenderer`；**函数 @deprecated**：`renderSnapshotToXml` | 正式渲染器：将 ContextSnapshot 序列化为 `<context>...</context>` XML 字符串，含 self/thread/context_windows/inbox/outbox/context_overflow 六段。 |
| `renderers/json.ts` | **类**：`JsonRenderer` | 结构化 JSON 输出（前端 ContextSnapshotViewer / debug API 用）。 |
| `renderers/trace.ts` | **类**：`TraceRenderer` | 人类可读 debug 输出：列每窗口 relevance score、provenance、matched intent，回答"为什么这些窗口在 context 里"。 |

### knowledge/

| 文件 | 导出 | 说明 |
|------|------|------|
| `knowledge/types.ts` | **类型/接口**：`ActivationLevel`、`ActivatesOn`、`KnowledgeFrontmatter`、`KnowledgeDoc`、`KnowledgeIndex`、`ActivationResult` | Knowledge frontmatter 与索引的类型定义。 |
| `knowledge/parser.ts` | **函数**：`parseKnowledgeFile` | .md 文件解析：frontmatter yaml + body 分离，含 activates_on trigger map 校验。 |
| `knowledge/loader.ts` | **接口**：`KnowledgeLoadRefs`；**函数**：`loadKnowledgeIndex`、`clearKnowledgeLoaderCache` | 四侧知识索引加载（目录祖先 seed → 父类链 seed → self seed → self sediment），带目录签名缓存 + 继承链解析。 |
| `knowledge/triggers.ts` | **类型**：`Trigger`（5 kind）；**函数**：`parseTrigger`、`parseActivatesOn`、`evaluateTrigger`、`matchesIntentName`、`maxLevel` | Trigger 表达式解析与求值：支持 object/method/intent/objectId/super 五类，含旧格式 window/command 向后兼容映射。 |
| `knowledge/activator.ts` | **函数**：`computeActivations` | 给定 thread + knowledge 索引，计算本轮应渲染的激活集合（forced → trigger-full → trigger-summary，上限 20）。 |
| `knowledge/synthesizer.ts` | **函数**：`computeFormKnowledgeEntries`（re-export）、`enrichFormMethodKnowledge`（re-export）、`readSelfPrototype`、`ensureSelfObjectTypeRegistered`、`derivePeerObjectWindows`、`collectExecutableKnowledgeEntries`（@deprecated）、`deriveRelationWindow`（@deprecated）、`deriveRelationCompanionKnowledge`（@deprecated）、`deriveRelationKnowledge`（@deprecated） | 遗留合成器模块：主逻辑已迁移到各 processor，当前保留 ensureSelfObjectTypeRegistered（动态 stone 对象注册）与 derivePeerObjectWindows（peer 对象窗口发现）。 |
| `knowledge/basic-knowledge.ts` | **常量**：`BASIC_KNOWLEDGE_PATH`、`KNOWLEDGE` | 全局 protocol knowledge 常量文本（约 443 行的 LLM 环境说明）。 |
| `knowledge/index.ts` | **类型 re-export**：所有 types.ts + triggers.ts 类型；**函数 re-export**：parser/loader/activator/triggers/basic-knowledge/synthesizer 全部导出 | knowledge 子系统的对外 barrel。 |

### llm/

#### 顶层文件

| 文件 | 导出 | 说明 |
|------|------|------|
| `llm/types.ts` | **类型/接口**：`LlmProvider`、`LlmToolName`、`LlmMessage`、`LlmInputItem`（4 kind）、`LlmTool`、`LlmToolCall`、`LlmGenerateParams`、`LlmGenerateResult`、`LlmStreamEvent`、`LlmEnvConfig`、`LlmClient` | provider-agnostic 的 LLM 抽象：请求/响应/流式事件/工具定义。 |
| `llm/client.ts` | **函数**：`createLlmClient` | 统一 LLM client 门面：按 provider 分发 + 全局超时兜底。 |
| `llm/env.ts` | **函数**：`readLlmEnv` | 从 OOC_* 环境变量解析 LLM 配置（provider/apiKey/baseUrl/model）。 |
| `llm/timeout.ts` | **类**：`LlmTimeoutError`；**函数**：`readLlmTimeoutMs`、`resolveLlmTimeoutMs`、`withLlmTimeout` | LLM 超时兜底：Promise.race + setTimeout，缺省 120s。 |
| `llm/index.ts` | **函数 re-export**：`createLlmClient`、`readLlmEnv`、`LlmTimeoutError`/`readLlmTimeoutMs`/`withLlmTimeout`；**类型 re-export**：全部 llm/types | llm 子系统对外 barrel。 |

#### llm/providers/

| 文件 | 导出 | 说明 |
|------|------|------|
| `providers/claude.ts` | **函数**：`generateWithClaude`、`streamWithClaude` | Claude Messages API 非流式/流式适配器：LlmInputItem → Claude content block；inbox 消息边界识别 → 转 user role。 |
| `providers/claude-sse.ts` | **函数**：`parseClaudeSSE`、`collectClaudeSseResult` | 共享 SSE 解析器（含 tool_use 增量 JSON 缓冲），同时被 generate/stream 路径复用。 |
| `providers/claude-transport.ts` | **函数**：`fetchClaude`、`retryClaudeGenerate` | Claude HTTP 传输层：直接 POST、含重试与"代理只返回 SSE"降级路径。 |
| `providers/openai.ts` | **函数**：`createOpenAiClient`、`generateWithOpenAi`、`streamWithOpenAi` | OpenAI Responses API 适配器：LlmInputItem → ResponseInputItem、strict function calling。 |

### reflectable/

| 文件 | 导出 | 说明 |
|------|------|------|
| `reflectable/reflectable-knowledge.ts` | **常量**：`REFLECTABLE_BASIC_PATH`、`REFLECTABLE_KNOWLEDGE`、`REFLECTABLE_METAPROG_PATH`、`REFLECTABLE_METAPROG_KNOWLEDGE`、`END_REFLECTION_REMINDER_PATH`、`END_REFLECTION_REMINDER_KNOWLEDGE` | super session 注入的三类 protocol knowledge 文本：反思基础指引、worktree 元编程协议、business thread end 时的反思提示。 |

### thinkable 顶层

| 文件 | 导出 | 说明 |
|------|------|------|
| `scheduler.ts` | **接口**：`SchedulerOptions`；**函数**：`runScheduler` | 多线程调度器：每 tick 按顺序 emit 子线程结束通知 → 唤醒 waiting 线程 → 选最久未执行的 running 线程调 think → 落盘。含公平选择与 inbox-based 唤醒语义。 |
| `thinkloop.ts` | **函数**：`think` | 单轮 think 执行器（529 行）：入口处理 HITL 权限决议 → BudgetManager 预算分配 + warning → buildInputItems → beginLlmLoop → LLM 生成 → 事件记录 → pause 检查 → permission 检查（allow/ask/deny）→ tool dispatch → finishLlmLoop。内嵌 8 个辅助函数（budgetWarning/buildPendingToolCall/summarizeArgs/dispatchApprovedToolCall/processDecidedPermissionAsks/collectApprovedToolCallIds/latestAssistantText/estimateWindowsTokens）。 |
| `recovery.ts` | **接口**：`DetectInterruptedOptions`、`InterruptedDetection`；**函数**：`detectInterruptedThread`、`markInterrupted` | 中断恢复检测：基于 events 尾部 `call_started` 后无响应类事件判定中断，写入 inject event 让 LLM 下轮可见。 |

---

## 3. 哪些不属于我 / 哪些我做得不好

### 3.1 死代码 / deprecated shim（应在批次 A 删除）

| 条目 | 位置 | 状态 |
|------|------|------|
| `collectExecutableKnowledgeEntries` | `knowledge/synthesizer.ts:220-285` | @deprecated。主逻辑已由 ContextPipeline + 5 processors 取代；仅服务遗留测试。应在迁移完测试后删除。 |
| `deriveRelationWindow` | `knowledge/synthesizer.ts:311-315` | @deprecated，返回空数组 stub。relation window 机制已被 peer Object window 取代。 |
| `deriveRelationCompanionKnowledge` | `knowledge/synthesizer.ts:320-324` | @deprecated，返回空数组 stub。 |
| `deriveRelationKnowledge` | `knowledge/synthesizer.ts:329-333` | @deprecated，返回空数组 stub，是上一条的 alias。 |
| `renderContextXml` | `context/render.ts:18-35` | @deprecated backward-compat shim。正式路径是 `XmlRenderer.render(snapshot, thread)`。仅服务遗留测试。 |
| `renderSnapshotToXml` | `context/renderers/xml.ts:396-398` | @deprecated，`new XmlRenderer().render()` 的一行 alias。 |
| 9 个 `void xxx` 未用 import 抑制 | `knowledge/synthesizer.ts:288-297` | createDefaultPipeline/deriveStoneFromThread/... 等均无实际使用。 |
| 3 个 `void xxx` 未用 import 抑制 | `context/processors/knowledge.ts:117-119` | computeActivations/clearKnowledgeLoaderCache/evaluateTrigger 均无实际使用。 |

### 3.2 Bug

| 条目 | 位置 | 说明 |
|------|------|------|
| **BudgetManager 双分配** | `thinkloop.ts:293` + `pipeline.ts:58-60` | thinkloop 里 new BudgetManager().allocate() 做一次预算截断；pipeline.run() 内部又 new BudgetManager().allocate() 做第二次。重复计算 + 截断不一致风险。 |
| **`(thread as any).intentCache` 3 处类型 cast** | `pipeline.ts:44-46`、`processors/knowledge.ts:89`、`knowledge/triggers.ts:245` | ThreadContext 上已正确声明 `intentCache?: IntentCache` 字段，但 3 处仍写 `(thread as any).intentCache`。字段可选性可处理，不需要 any cast。 |
| **XmlRenderer 双 `readReadable`** | `context/renderers/xml.ts:157` + `context/renderers/xml.ts:165` | resolveReadableForType Step 4 读 readReadable 拿 readable 内容，Step 5 fallback 又调 readReadable 拿 readme。同一文件在同一次渲染里读两遍。Step 5 的 `readReadable` 应当是读 readme（函数名含义混淆），实际上 persistable/readReadable 先找 readable.md 再 fallback 到 readme.md——所以 Step 4 已覆盖 Step 5 的结果，Step 5 是纯重复。 |
| **`estimateWindowsTokens` 与 BudgetManager 估算重复** | `thinkloop.ts:43-55` vs `budget.ts:155-169` | 两者都用 `JSON.stringify(w).length / 4` 的完全相同 heuristics。thinkloop 调完 pipeline（内部已有 BudgetManager.allocate → 带 token 计算）后，又独立对 allocation.visible 再算一遍，只为了判断是否超 soft threshold 注入 warning。 |

### 3.3 类型卫生

| 条目 | 位置 | 说明 |
|------|------|------|
| `processors/*` 中 KnowledgeWindow 用 `as any` 构造 | `processors/system.ts:39,52`、`processors/method.ts:35,52`、`processors/knowledge.ts:54` | 构造 KnowledgeWindow 时用 `{ id, type: "knowledge", ... } as any`。ContextWindow 是 discriminated union，`type: "knowledge"` 理论上应能让 TS 正确收窄——需要检查是 KnowledgeWindow 字段未纳入 union 还是构造器字段不全。 |
| `context/index.ts` 746 行大杂烩 | `context/index.ts` 全篇 | 同一文件里混了：1) ProcessEvent + ThreadContext + ThreadMessage 核心类型（约 430 行）；2) processEventToItems 650 行函数（从 459 行起）；3) buildContext/buildInputItems 对外入口；4) buildPathsItem/loadSelfInstructions 私有辅助；5) 大量 barrel re-export。职责混杂严重。 |
| `processEventToItems` 650 行单函数 | `context/index.ts:459-649` | 11 种 event kind 的渲染逻辑全塞在一个 if-else 链里。每个分支的 header/body 拼装逻辑可独立成文件/函数。 |
| `messageBody` 的 `(message as any).content` fallback | `context/renderers/xml.ts:53` | ThreadMessage 上 content 字段是明确的，但代码做了 `(message as any).text` fallback——疑似 legacy 数据兼容但无文档说明。 |

### 3.4 与 executable / persistable / observable 的双向耦合

以下为 thinkable 模块中所有跨模块 import（排除 type-only），按目标模块分类，标注 runtime 依赖 vs type-only。

#### 对 executable 的 runtime import（强耦合方向）

| 文件 | 行 | import 内容 | 用途 |
|------|----|-------------|------|
| `thinkloop.ts` | 2 | `decidePermission`, `PendingToolCall` from `../executable/permissions` | Permission 决策与类型 |
| `thinkloop.ts` | 3 | `dispatchToolCall`, `getAvailableTools` from `../executable/tools` | Tool 执行入口 + tool schema |
| `context/activator-windows.ts` | 8 | `ROOT_WINDOW_ID` from `../executable/windows/_shared/types` | 常量 |
| `context/protocol.ts` | 12 | `ROOT_WINDOW_ID` from `../executable/windows/_shared/types` | 常量 |
| `context/protocol.ts` | 14 | `builtinRegistry` from `../executable/windows` | 全局 registry 实例 |
| `context/protocol.ts` | 25 | `SUPER_SESSION_ID` from `../executable/windows/_shared/super-constants` | 常量 |
| `context/renderers/xml.ts` | 29 | `ROOT_WINDOW_ID` from `../executable/windows/_shared/types` | 常量 |
| `context/renderers/xml.ts` | 33-34 | `ObjectRegistry` type + `builtinRegistry` from `../executable/windows/_shared/registry` + `windows/index` | 渲染时查 object 定义 |
| `context/renderers/xml.ts` | 35-36 | `filterMessagesForDoWindow` / `filterMessagesForTalkWindow` from `../executable/windows/do` / `talk` | inbox/outbox 去重 |
| `context/renderers/xml.ts` | 38 | `loadObjectReadable`, `loadObjectWindow` from `../executable/server/loader` | stone Object 定义加载 |
| `context/render.ts` | 12 | `builtinRegistry` from `../executable/windows` | 同上（deprecated shim） |
| `context/skill-index.ts` | 15 | `ROOT_WINDOW_ID`, `SKILL_INDEX_WINDOW_ID` from `../executable/windows/_shared/types` | 常量 |
| `context/window-enrichment.ts` | 12 | `builtinRegistry` from `../executable/windows` | 同上 |
| `context/processors/method.ts` | 15 | `builtinRegistry` from `../executable/windows` | 同上 |
| `context/processors/system.ts` | 12 | `builtinRegistry` from `../executable/windows` | 同上 |
| `knowledge/loader.ts` | 11 | `builtinRegistry` from `../executable/windows` | parentClass 继承链解析 |
| `knowledge/synthesizer.ts` | 25 | `builtinRegistry` from `../executable/windows` | 同上 |
| `knowledge/synthesizer.ts` | 27 | `SUPER_ALIAS_TARGET` from `../executable/windows/_shared/super-constants` | 常量 |
| `knowledge/synthesizer.ts` | 28 | `loadObjectWindow` from `../executable/server/loader` | peer Object 定义加载 |
| `knowledge/synthesizer.ts` | 304 | `KnowledgeWindow`/`RelationWindow` types from `../executable/windows/_shared/types` | deprecated shim 的类型 |
| `knowledge/triggers.ts` | 31 | `SUPER_SESSION_ID` from `../executable/windows/_shared/super-constants` | 常量 |

**耦合分析**：
- **builtinRegistry** 被引用 7 次——这是 thinkable 从 executable 拿 window 类型定义的唯一入口。批次 C 把 `ObjectRegistry` 接口迁到 `_shared/types/` 后，thinkable 只需要接口，实例可以通过注入或 persistable 加载路径获取。
- **ROOT_WINDOW_ID / SKILL_INDEX_WINDOW_ID / SUPER_SESSION_ID / SUPER_ALIAS_TARGET** 这些常量属于 `_shared/types/` 范畴。
- **filterMessagesForDoWindow / filterMessagesForTalkWindow** 是 do/talk window 的消息过滤纯函数，可抽到 `_shared/utils/`。
- **loadObjectReadable / loadObjectWindow** 是 stone Object 的加载器——`executable/server/` 将来会更名并迁移到 `runtime/`，thinkable 应通过接口（批次 C 中 `StoneObjectDeclaration`）而非直接 import 实现。
- **dispatchToolCall / getAvailableTools / decidePermission** 是 thinkloop 的核心编排依赖，属于 thinkable → executable 的合理方向（上层编排调下层执行），但接口契约需要在 `_shared/types/` 中声明。

#### 对 persistable 的 runtime import

| 文件 | 行 | import 内容 |
|------|----|-------------|
| `context/index.ts` | 4 | `deriveStoneFromThread`, `objectDir`, `readSelf`, `stoneDir`, `threadDir` |
| `context/activator-windows.ts` | 12 | `deriveStoneFromThread`, `derivePoolFromThread` |
| `context/budget.ts` | 28 | `deriveStoneFromThread`, `stoneDir` |
| `context/processors/knowledge.ts` | 20 | `deriveStoneFromThread`, `derivePoolFromThread` |
| `context/skill-index.ts` | 13 | `deriveStoneFromThread`, `listBranchSkills`, `listObjectSkills`, `listExternalSkills`, `readWorldConfig` |
| `knowledge/loader.ts` | 9 | `ancestorObjectIds`, `poolKnowledgeDir`, `stoneKnowledgeDir`, `PoolObjectRef`, `StoneObjectRef` |
| `knowledge/synthesizer.ts` | 21 | `deriveStoneFromThread`, `derivePoolFromThread`, `discoverStoneHierarchicalPeers`, `listBranchSkills`, `listObjectSkills`, `listExternalSkills`, `readPoolRelation`, `readFlowRelation`, `readReadable`, `readSelf`, `readableFile`, `readWorldConfig` |
| `context/renderers/xml.ts` | 39 | `readReadable`, `StoneObjectRef` |
| `scheduler.ts` | 4 | `writeThread` |
| `thinkloop.ts` | 4 | `writeThread` |

这些路径 helper 与 IO 函数属于 persistable 的正当 API——方向正确（thinkable 消费 persistable），但 `StoneObjectRef` / `PoolObjectRef` / `ThreadPersistenceRef` 等核心 ref 类型应迁到 `_shared/types/`。

#### 对 observable 的 runtime import

| 文件 | 行 | import 内容 |
|------|----|-------------|
| `thinkloop.ts` | 3 | `beginLlmLoop`, `finishLlmLoop`, `isPausing` from `../observable` |

observable 将来并入 runtime（批次 F1）。thinkable → runtime 的观测 hook 方向合理。但 observable 模块和 runtime/observable-store 各有一套 beginLlmLoop/finishLlmLoop 实现是重复的。

### 3.5 thinkloop.ts 职责过多

`thinkloop.ts` 529 行承载了：

1. Budget 分配 + warning 注入（应下沉到 context/budget.ts 的辅助函数）
2. permission ask/deny/allow 完整决策链（含 HITL 决议 replay）——可独立为 thinkloop/permission.ts 子模块
3. tool dispatch 循环 115 行（含 ok 字段解析）——可独立为 thinkloop/tool-dispatch.ts
4. LLM 生成主循环编排（合理保留）
5. interrupt/recovery 相关的 call_started 事件写入（已独立 recovery.ts，但写入点仍在 thinkloop）
6. 8 个辅助函数散落：`buildBudgetWarningItem`、`estimateWindowsTokens`、`buildPendingToolCall`、`summarizeArgs`、`dispatchApprovedToolCall`、`processDecidedPermissionAsks`、`collectApprovedToolCallIds`、`latestAssistantText`

另外 observable 模块（`observable/index.ts`）和 runtime store（`runtime/observable-store.ts`）各有独立的 `beginLlmLoop` / `finishLlmLoop` 实现，observable 是对 runtime 的 thin wrapper——批次 F1 计划合并。

---

## 4. 理想的我

```
thinkable/
├── context/                          # Context 构建流水线
│   ├── types/                        # NEW：从 index.ts 拆出的核心类型（批次 C 后迁到 _shared）
│   │   ├── process-event.ts          # ProcessEvent + ProcessEventCommon
│   │   ├── thread-message.ts         # ThreadMessage
│   │   └── thread-context.ts         # ThreadContext
│   ├── process-events.ts             # NEW：从 index.ts 拆出的 processEventToItems + 辅助
│   ├── pipeline.ts                   # ContextPipeline（保持，精简 intentCache 初始化）
│   ├── intent.ts                     # Intent / FormChangeEvent / IntentCache / hashArgs / diffArgs
│   ├── budget.ts                     # BudgetManager + 新增 allocateWithWarning() 合并软阈值逻辑
│   ├── snapshot.ts                   # ContextSnapshot
│   ├── protocol.ts                   # 协议级 knowledge window 生成
│   ├── window-enrichment.ts          # effectiveVisibleType + form enrichment
│   ├── skill-index.ts                # SkillIndexWindow 合成
│   ├── activator-windows.ts          # Trigger-based knowledge 激活
│   ├── xml.ts                        # XML AST + serializeXml + truncateBytes
│   ├── processors/                   # Pipeline 各阶段（5 个文件保持不动，但清 any cast）
│   │   ├── system.ts
│   │   ├── method.ts
│   │   ├── knowledge.ts
│   │   ├── activator.ts
│   │   └── peer.ts
│   └── renderers/
│       ├── xml.ts                    # XmlRenderer（修复双 readReadable，filterMessages 通过 registry 抽象）
│       ├── json.ts
│       └── trace.ts
├── knowledge/                        # Knowledge 子系统（保持现有目录，但删除 synthesizer.ts 中 deprecated 项）
│   ├── types.ts
│   ├── parser.ts
│   ├── loader.ts
│   ├── triggers.ts                   # 移除 (thread as any).intentCache
│   ├── activator.ts
│   ├── basic-knowledge.ts
│   ├── object-registration.ts        # NEW：从 synthesizer.ts 迁出 ensureSelfObjectTypeRegistered + readSelfPrototype
│   ├── peer-discovery.ts             # NEW：从 synthesizer.ts 迁出 derivePeerObjectWindows
│   └── index.ts                      # barrel（删除 deprecated re-export）
├── llm/
│   ├── types.ts
│   ├── client.ts
│   ├── env.ts
│   ├── timeout.ts
│   ├── index.ts
│   └── providers/                    # 保持不变
│       ├── claude.ts
│       ├── claude-sse.ts
│       ├── claude-transport.ts
│       └── openai.ts
├── reflectable/
│   └── reflectable-knowledge.ts      # 保持不变
├── thinkloop/                        # NEW：拆分 thinkloop.ts
│   ├── index.ts                      # think() 主编排（~150 行）
│   ├── budget-guard.ts               # BudgetManager 双分配修复 + warning 注入 + estimateWindowsTokens 合并
│   ├── permission.ts                 # HITL ask/deny/allow 全链路（~200 行）
│   ├── tool-dispatch.ts              # tool call 循环 + ok 解析（~115 行）
│   └── _utils.ts                     # buildPendingToolCall / summarizeArgs / latestAssistantText
├── scheduler.ts                      # 保持不变
├── recovery.ts                       # 保持不变
└── index.ts                          # 对外 barrel
```

**删除的文件**：
- `context/render.ts`（deprecated shim，批次 A1）
- `context/context.ts`（薄封装可合并到 thinkable/index.ts）
- `knowledge/synthesizer.ts`（内容已拆分到 object-registration + peer-discovery，deprecated 函数删除）

---

## 5. 我的优化方案（分批次）

### 对齐总纲

| 总纲批次 | thinkable 涉及条目 | 本方案对应 |
|----------|-------------------|-----------|
| **批次 A**（死代码删除 + Bug 修复） | A1, A6, A7, A8, A9, A11 | §5.1 |
| **批次 C**（中立共享类型包） | C2, C4, C5, C6, C7, C8 | §5.2 |
| **批次 G**（thinkable 内部整理） | G1, G2, G3, G4 | §5.3 |

### 5.1 批次 A：死代码删除 + Bug 修复

**A1 — 删除 deprecated shim**
- 删除 `context/render.ts` 全文件
- 删除 `knowledge/synthesizer.ts` 中的 `collectExecutableKnowledgeEntries`、`deriveRelationWindow`、`deriveRelationCompanionKnowledge`、`deriveRelationKnowledge` 四个函数
- 删除 `context/renderers/xml.ts` 中的 `renderSnapshotToXml` 函数
- 迁移对应测试：所有测试改为直接使用 ContextPipeline + XmlRenderer
- 同步删除 `knowledge/index.ts` 中这 5 个 deprecated re-export

**A6, A7 — 清理未用 import 抑制**
- `knowledge/synthesizer.ts:288-297` 删除 9 个 `void xxx` 及对应 import
- `context/processors/knowledge.ts:117-119` 删除 3 个 `void xxx` 及对应 import

**A8 — BudgetManager 双分配修复**
- `pipeline.ts` 内部不再调用 `budget.allocate()`，改为仅计算 relevance score 并存到每个 window 的 `relevance.score` 字段（或返回 scored windows）
- `thinkloop.ts` 是唯一调用 `BUDGET_MANAGER.allocate(thread.contextWindows, hard)` 的点
- 新增 `BudgetManager.scoreAll(windows)` 方法：只打分不截断
- Pipeline.run() 返回带 score 的 ContextSnapshot，thinkloop 统一做一次 allocate
- `estimateWindowsTokens`（thinkloop.ts:43-55）删除，复用 `BudgetManager.allocate` 的 token 统计
- 新增 `BudgetManager.allocateWithWarning` 返回 `{ visible, overflow, tokens }`，thinkloop 直接用 tokens 判断 soft threshold

**A9 — 消除 `(thread as any).intentCache` 3 处 cast**
- `pipeline.ts:44-46` 改为直接读写 `thread.intentCache`（字段已声明为可选，初始化时正确处理 undefined）
- `processors/knowledge.ts:89` 改为 `const cache = thread.intentCache`
- `knowledge/triggers.ts:245` 改为 `const cache = thread.intentCache`
- 检查 ThreadContext 类型声明：`intentCache?: IntentCache` 已存在，无需 any

**A11 — XmlRenderer 双 readReadable 修复**
- `context/renderers/xml.ts:157`（Step 4）先拿到 `readableText = await readReadable(stoneRef)`，结果非空则使用
- `context/renderers/xml.ts:165`（Step 5）是错误的重复调用——应当是"只有 Step 4 没拿到内容，才 fallback 读 readme.md"。但 persistable 的 `readReadable` 已经先 readable.md 后 readme.md fallback，所以 Step 5 完全冗余，直接删除。
- 如果后续需要区分 readable.md vs readme.md 来源标注，应在 persistable 层扩展返回值。

### 5.2 批次 C：中立共享类型包建立（thinkable 侧配合）

thinkable 不主导批次 C，但需要配合以下迁出工作：

| 迁出类型 | 当前位置 | 目标 | thinkable 侧改动 |
|----------|---------|------|-----------------|
| `ContextWindow` 家族 + 常量（ROOT_WINDOW_ID, SKILL_INDEX_WINDOW_ID, SUPER_SESSION_ID, SUPER_ALIAS_TARGET） | executable/windows/_shared/types.ts、super-constants.ts | `_shared/types/` | 所有 import 路径更新为 `@ooc/core/_shared` |
| `ObjectRegistry` 接口 | executable/windows/_shared/registry.ts | `_shared/types/` | thinkable 只依赖接口，builtinRegistry 实例改为注入或从 runtime 获取 |
| `ObjectMethod` / `MethodKnowledgeEntries` / `MethodExecutionContext` | executable/windows/_shared/command-types.ts | `_shared/types/` | window-enrichment + protocol + processors/method import 更新 |
| `ThreadContext` / `ProcessEvent` / `ThreadMessage` | context/index.ts | `_shared/types/` | context/index.ts 只 re-export（来源变为 `_shared/types`），本体迁出 |
| `Intent` / `FormChangeEvent` / `IntentCache` / `MethodCallSchema` / `MethodArgSpec` | context/intent.ts | `_shared/types/` | intent.ts 保留 hashArgs/diffArgs 实现函数，类型迁出 |
| `XmlNode` + xml helpers（escapeXml / serializeXml / xmlElement 等） | context/xml.ts | `_shared/types/` 或 `_shared/utils/` | xml.ts 只 re-export |
| `KnowledgeFrontmatter` / `KnowledgeDoc` / `ActivatesOn` / `ActivationLevel` | knowledge/types.ts | `_shared/types/` | types.ts 保留 ActivationResult / KnowledgeIndex（含 byPath Map 等实现细节） |
| `StoneObjectRef` / `PoolObjectRef` / `ThreadPersistenceRef` | persistable/common.ts | `_shared/types/` | thinkable 所有 ref 类型 import 更新 |
| `filterMessagesForDoWindow` / `filterMessagesForTalkWindow` | executable/windows/do, talk | `_shared/utils/` | renderers/xml.ts import 更新 |

批次 C 完成后，thinkable 对 executable 的 runtime import 应只保留：
- `dispatchToolCall` / `getAvailableTools`（合理编排依赖）
- `decidePermission`（合理编排依赖）
- `builtinRegistry` 实例（后续批次改为注入）

### 5.3 批次 G：thinkable 内部整理

**G1 — 拆分 `context/index.ts`（746 行）**
- 类型迁出（批次 C 已覆盖 `ProcessEvent`/`ThreadContext`/`ThreadMessage` → `_shared/types`）
- `processEventToItems`（650 行）+ `findInboxMessage` + `resolveInboxWindowId` 拆到 `context/process-events.ts`，导出 `processEventToItems` 函数
- `buildPathsItem` + `loadSelfInstructions` 留在 context/index 或拆到 `context/self-meta.ts`
- 保留 barrel re-export，但来源改为各子文件
- 目标：context/index.ts 压缩到 < 150 行

**G2 — thinkloop.ts 拆分**
- 新建 `thinkloop/` 子目录（4 文件）
- `thinkloop/permission.ts`：`buildPendingToolCall`、`summarizeArgs`、`dispatchApprovedToolCall`、`processDecidedPermissionAsks`、`collectApprovedToolCallIds` + 主循环中 ask/deny/allow 分支
- `thinkloop/tool-dispatch.ts`：主循环中 allow 路径的 dispatchToolCall + ok 解析 + 错误处理（~115 行）
- `thinkloop/budget-guard.ts`：`buildBudgetWarningItem`、合并后的预算分配（A8 完成后此处只负责 warning 注入）
- `thinkloop/index.ts`：`think()` 主编排函数 + `latestAssistantText` 辅助
- 目标：`thinkloop/index.ts` ~150 行，所有辅助函数有独立文件归属

**G3 — estimateWindowsTokens 与 BudgetManager 估算去重**
- 见 A8 的 BudgetManager 扩展：新增 `allocateWithWarning()` 返回 `{ visible, overflow, tokens, softExceeded }`
- 删除 thinkloop.ts 中的 `estimateWindowsTokens` 函数
- 删除 thinkloop.ts 中的 `buildBudgetWarningItem`（迁入 budget-guard.ts 后直接消费 allocateWithWarning 的返回值）

**G4 — XmlRenderer 通过 registry 抽象消 direct import**
- `filterMessagesForDoWindow` / `filterMessagesForTalkWindow` 在批次 C 迁到 `_shared/utils/` 后本问题已解决大半
- `loadObjectReadable` / `loadObjectWindow` 改为通过注入的加载器接口（批次 C 定义在 `_shared/types/`），不直接 import `executable/server/loader`
- 长期：`builtinRegistry` 实例作为参数注入 XmlRenderer 构造函数（当前已支持可选参数），thinkable 不再直接从 executable import 单例

---

## 6. 我对其他模块的要求

### 对 executable（批次 C + D）

1. **批次 C2/C4**：尽快完成 `ContextWindow` 家族 + `ObjectRegistry` 接口 + `ObjectMethod` 迁出到 `_shared/types/`。这是我能消除 7 次 `builtinRegistry` runtime import 的前置条件。
2. **批次 C3**：`MethodKnowledgeEntries` / `MethodExecutionContext` 迁出后，我的 `window-enrichment.ts` 和 `protocol.ts` 的 import 才能指向 `_shared/types`。
3. **批次 D2**：`form.command` → `form.method` 重命名时，需同步更新我这边 `thinkable/` 中所有引用（knowledge/triggers、protocol、processors/*、renderers/xml、thinkloop/permission）。请在该批次执行时明确列出涉及文件，我会同步修改。
4. **批次 D6**：统一 logger 方案后，我模块内 15+ 处 `console.*`（knowledge/loader、knowledge/activator、knowledge/synthesizer、knowledge/triggers 的 parser、knowledge 加载冲突 warn 等）需要替换为注入 logger。请给出 logger 接口签名。

### 对 persistable（批次 C + E）

1. **批次 C5**：`StoneObjectRef` / `PoolObjectRef` / `ThreadPersistenceRef` 迁出到 `_shared/types/`，我模块有 10+ 处这些 ref 类型的 import。
2. **批次 E4**：`thread-json.ts` 中 135 行 context 重建逻辑——请明确哪些属于 thinkable（LLM context 构建相关）、哪些属于 executable（window CRUD 相关）。我预期 intentCache 的反序列化与 ThreadContext 的内存态构造归我。
3. **批次 A10**：`STONE_OBJECTS_SUBDIR` 常量统一后，我的 `knowledge/loader.ts`（stoneKnowledgeDir / poolKnowledgeDir）需使用常量而非硬编码路径——请在 persistable 层导出该常量，我直接消费。

### 对 observable / runtime（批次 F）

1. **批次 F1**：observable 并入 runtime 后，我的 `thinkloop.ts:3` 的 import 路径从 `../observable` 改为 `../runtime`。请保留 `beginLlmLoop`/`finishLlmLoop`/`isPausing` 三个函数的导出签名不变。
2. **批次 F5**：`thread-transition.ts` + `resume.ts` 中属于中断恢复的逻辑（若有）迁到 `thinkable/recovery.ts`。请先评估哪些是纯 thinkable 逻辑、哪些涉及 HTTP/worker 状态。
3. **批次 F6**：pause 两套抽象合并后，`isPausing` 的实现归属请明确，我只关心接口签名。

### 对 _shared/types（新建，批次 C）

1. **请求的类型包清单**（按优先级）：
   1. `ContextWindow` 家族 + 常量（ROOT_WINDOW_ID 等）
   2. `ObjectRegistry` 接口 + `ObjectDefinition` 接口
   3. `ObjectMethod` + `MethodKnowledgeEntries`
   4. `ThreadContext` + `ProcessEvent` + `ThreadMessage`
   5. `Intent` + `FormChangeEvent` + `IntentCache`
   6. `XmlNode` + xml helpers
   7. `KnowledgeFrontmatter` + `KnowledgeDoc` + `ActivatesOn`
   8. `StoneObjectRef` + `PoolObjectRef` + `ThreadPersistenceRef`
2. **请求的 utils 包清单**：
   1. `filterMessagesForDoWindow` / `filterMessagesForTalkWindow`（纯函数）
   2. 后续可评估 `truncateBytes` / `escapeXml` 是否应在 `_shared/utils/`

### 对 builtins（批次 B）

1. builtins 侧的改动不直接影响 thinkable，但批次 B7（`command-types.ts` → `method-types.ts`）需同步更新我的 `knowledge/synthesizer.ts`、`context/window-enrichment.ts` 中对 `MethodKnowledgeEntries` 的 import 路径。

---

---

## 附录前补充：ContextWindow ↔ OOC Object 关系重定义 + readable 维度新职责

> 2026-06-04 设计澄清：与 executable 子方案对齐。纠正"context window 就是 ooc object 出现在 context 中的形态"这一先前草率断言。本节是本方案核心设计修正，影响批次 C（`_shared/types/` ObjectDefinition 接口）、批次 D（展示控制 method 迁移）、批次 G（XmlRenderer 渲染）。

### 一、ContextWindow 与 OOC Object 是交集，不是子集

**先前断言："ContextWindow 是 OOC Object 出现在 context 中的形态"** 是草率的。正确关系：**OOC Object 只是 ContextWindow 的实现方式之一，不是唯一方式。**

全景如下：

| ContextWindow 类型 | 是否是 OOC Object | 说明 |
|-------------------|------------------|------|
| file / knowledge / program / todo / plan / search / skill_index / supervisor / user / custom | 是 | 对应 stone 中的实体，通过 self.md + executable + visible + knowledge 实现"作为 ContextWindow"的形态 |
| talk | 否 | 跨 Object 的通信管道，对应任意 Object 间的协作；它 `type="talk"`，但不是 Object 本身 |
| do | 否 | 同 Object 内的子线程 fork 产物，不是 Object 本身 |
| method_exec | 否 | Object.method 调用过程中的临时 form，不属于任何 Object type |
| root | 边界 | 特殊全局 Object，承载世界级状态 |
| GuidanceWindow | 否 | form-bound 的 transient 引导窗，仅在 form 生命周期内存在 |

正确的心智模型：

```
ContextWindow  = LLM 能看到的一切上下文单元（最大集合）
OOC Object     = 持久化实体（stone），它把"自己作为 ContextWindow 出现"实现为其中一个 window
              ⟹ Object ⊂ ContextWindow，但 talk/do/method_exec/guidance 是不属于任何 Object 的 ContextWindow
```

**对 thinkable 的核心含义：**

1. **Context pipeline 与 renderer 不能假设所有 window 都来自 OOC Object。** processor 在 lookup Object 语义（registry 查 ObjectDefinition）时，必须先判断该 window type 是否对应一个 Object；talk/do/method_exec/guidance 没有对应 ObjectDefinition。
2. `effectiveVisibleType`、peer Object 注入、knowledge 继承链解析等逻辑仅当 window 对应一个 OOC Object 时才有意义——对 talk/do/method_exec 不应触发 Object 级语义。
3. `XmlRenderer` 渲染 talk/do/method_exec 时不应通过 registry 去读 ObjectDefinition.readable，而应使用这些 window type 自身的渲染逻辑（`filterMessagesForTalkWindow` / `filterMessagesForDoWindow` 等）。

### 二、readable 维度的新职责：渲染 + 提供 window method

之前 readable 只负责"构造 Object 在 context 中展示的信息"（`ReadableFn` / `renderXml` / `compressView`）。本次澄清扩展其职责：**readable 还应提供"展示控制 window method"**——就像 executable 模块为 Object 提供 object method 一样，readable 模块为 ContextWindow 提供改变其展示状态的 method。

LLM 通过 exec tool 调用 window 上的 method 来改变信息展示程度：file 只展示 0-200 行、talk 只展示 tail=20 的消息、search 只展示 match 50-100 的结果、program 只展示 exec history tail=30 条。这些 method 当前都注册为 ObjectMethod（在 executable / builtins 层），但它们的共同特征表明它们语义上属于 readable：

| method | 当前注册位置 | 作用域 | 是否改 Object |
|--------|-------------|-------|-----|
| `file.set_viewport` | `builtins/file/executable/index.ts:208` | 写 `ctx.self.viewport` | 否 |
| `knowledge.set_viewport` | `builtins/knowledge/executable/index.ts:125` | 写 `ctx.self.viewport` | 否 |
| `file.set_range` | `builtins/file/executable/index.ts:192` | 写 `ctx.self.lines/columns`（遗留） | 否 |
| `talk.set_transcript_window` | `executable/windows/talk/command.set-transcript-window.ts:79` | 写 `ctx.self.transcriptViewport` | 否 |
| `do.set_transcript_window` | `executable/windows/do/command.set-transcript-window.ts:79` | 写 `ctx.self.transcriptViewport` | 否 |
| `search.set_results_window` | `builtins/search/executable/command.set-results-window.ts:82` | 写 `ctx.self.resultsViewport` | 否 |
| `program.set_history_window` | `builtins/program/executable/index.ts:169` | 写 `ctx.self.historyViewport` | 否 |

这些 method 的共同实现模式：

- **不修改 Object 状态**：只写 `ctx.self` 的 `viewport` / `transcriptViewport` / `resultsViewport` / `historyViewport` 等展示字段，完全不碰 Object 的持久化状态、不写磁盘。
- **仅在 readable 渲染时生效**：这些字段是 readable 渲染时切片展示的依据，改它们只改变"信息在 context 中的展示状态"，不改变信息本身。
- **副作用极小**：实现上只是对 `ctx.self` 做一次 `Object.assign`（见 `executeWindowSetViewport` / `executeWindowSetTranscriptViewport`）。

**语义判定：** Object method 改的是 Object（file.edit 写磁盘、plan.add_step 改 step 列表、todo.close 改 state）；展示控制 method 改的是 ContextWindow 的展示状态。后者属于 readable 维度，不属于 executable。

### 三、对本方案的影响

**批次 C（`_shared/types/`）**：`ObjectDefinition` 接口（迁到 `_shared/types/registry.ts`）新增 `readableMethods?: Record<string, ObjectMethod>` 字段，与现有渲染钩子并列：

```typescript
interface ObjectDefinition {
  // 现有（渲染职责）
  readable?: ReadableFn;
  renderXml?: RenderHook;
  compressView?: CompressViewHook;
  // 新增（展示控制职责）—— 复用 ObjectMethod 接口，但 exec 仅允许读写 ctx.self
  readableMethods?: Record<string, ObjectMethod>;
}
```

展示控制 method 与 object method 共用 `ObjectMethod` 接口（`paths` / `intent` / `onFormChange` / `schema` / `exec`），但其 `exec` 受限：**只能读写 `ctx.self`（ContextWindow），禁止访问 Object 的任何持久化状态或触发任何 Object 级副作用。** dispatch 时由 WindowManager 区分两类 method 的执行环境（详见 executable.md 二节）。

**批次 D（展示控制 method 迁移）**：把上表 7 个 method 从各自的 `methods:` 表迁到同 Object 的 readable 声明（`readable.ts` 或 `readable-methods.ts`），不改变 behavior，只改注册位置。thinkable 侧消费这些 method 的逻辑（context pipeline 在 form enrichment 时枚举可用 method）需要把 `readableMethods` 也纳入枚举范围。

**批次 G（XmlRenderer 渲染）**：XmlRenderer 渲染每个 `<window>` 时，除展示 Object method 外，应展示该 window 当前可用的展示控制 method 及当前 viewport 边界（让 LLM 知道"现在看到的是 0-200 行，可调用 set_viewport 改范围"）。可新增 `listWindowMethods(window)` 辅助，从对应 ObjectDefinition 的 `readableMethods` 收集。

## 附录：验收检查清单

- [ ] 批次 A 完成：5 个 deprecated 函数删除 + 2 处 `void xxx` 清理 + BudgetManager 单分配 + 3 处 `(thread as any).intentCache` 消除 + XmlRenderer 单 readReadable
- [ ] 批次 C 完成：thinkable → executable runtime import 只剩 `dispatchToolCall` / `getAvailableTools` / `decidePermission` + builtinRegistry（注入过渡态）
- [ ] 批次 G 完成：`context/index.ts` < 150 行；`thinkloop/` 拆为 4 子文件，每个 < 200 行；`estimateWindowsTokens` 删除
- [ ] `bun tsc --noEmit` 0 errors（除预先存在的 web 3 个错误）
- [ ] thinkable 相关测试全绿

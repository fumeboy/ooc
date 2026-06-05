# executable 模块自审方案

> 第一人称视角：我是 `packages/@ooc/core/executable/`
> 代号：ooc-6 架构清理 · phase 2
> 对齐总纲：`docs/refactor_0604/README.md`

---

## 1. 我是谁

我是 OOC 8 维度中 **executable（行动能力）** 维度的核心实现。一句话定位：**我把 LLM 的意图（exec/close/wait/compress 4 原语 + Object.method 调用）翻译成真实副作用——跨线程协作、form 生命周期、权限决策、shell/ts 沙箱执行、以及 Stone Object 的 server 端运行时。**

我的核心能力：
1. **LLM Tool 调度**：4 原语（exec / close / wait / compress）的统一路由与执行
2. **Window 生命周期管理**：`WindowManager` 负责 method_exec form 的 open / refine / submit / close、typed window 插入、knowledge 引用计数、持久化双写
3. **跨 Object 协作**：do（同 object 子线程 fork）、talk（跨 object 消息派送）、window sharing（ref / move / 自动归还）
4. **权限准入**：三档（allow / ask / deny）command 级权限决策链（PermissionDecider > policies.json > ObjectMethod.permission）
5. **程序沙箱**：shell / ts 代码执行隔离、`ProgramSelf` 运行时 self 注入、Object server method 加载（保留在 `executable/program/` 目录，不迁移）

**重要约束（D1）**：`executable/program/` 目录保留不移动——shell/sandbox/format 等程序运行时内容继续留在我下面。

---

## 2. 我有什么（符号全景）

以下按目录分组，逐一列出所有源文件（排除 `__tests__/`）定义/导出的类型、接口、类、函数、常量。

### 2.1 顶层文件

#### `executable/index.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `computeFormKnowledgeEntries` | re-export (function) | **反向从 thinkable 再导出** — form knowledge 计算（Phase F 后留在我这里的唯一入口） |
| `enrichFormMethodKnowledge` | re-export (function) | **反向从 thinkable 再导出** — enrich form 的 method knowledge path |
| `BASIC_KNOWLEDGE_PATH` | re-export (const) | **反向从 thinkable 再导出** — basic knowledge 的 path 常量 |
| `KNOWLEDGE` | re-export (const) | **反向从 thinkable 再导出** — knowledge 相关常量 |
| `collectExecutableKnowledgeEntries` | re-export (function, @deprecated) | **反向从 thinkable 再导出 + deprecated** — Phase F 旧入口，应删除 |

#### `executable/permissions.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `PermissionLevel` | type | 单档准入级别：`"allow" \| "ask" \| "deny"` |
| `PermissionDecision` | type | decidePermission 的结构化返回（含 reason） |
| `PendingToolCall` | type | thinkloop 在分派 tool call 前组装的待审计载荷 |
| `PermissionDecider` | type | escape hatch 函数类型，优先级高于 policies.json 与 ObjectMethod |
| `loadPoliciesJson` | function | 读取 stone 上 `config/policies.json`，返回 command -> level 扁平 map；永不抛错 |
| `decidePermission` | function | 计算单个 tool call 的最终准入决定（4 级决策链） |

#### `executable/tools.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `ToolHandler` | type (local) | 单个 LLM tool 的运行时 handler 签名（不导出） |
| `getAvailableTools` | function | 返回当前线程可暴露给 LLM 的工具定义（委托 `buildAvailableTools`） |
| `dispatchToolCall` | function | 将 LLM tool call 分派给对应 handler，返回可进入 `function_call_output` 的结果串 |

### 2.2 tools/（LLM 4 原语）

#### `executable/tools/index.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `OOC_TOOLS` | const (LlmTool[]) | 4 原语数组：EXEC_TOOL / CLOSE_TOOL / WAIT_TOOL / COMPRESS_TOOL |
| `buildAvailableTools` | function | 构建可用 tools 列表（当前始终返回固定四件套） |
| `CLOSE_TOOL`, `COMPRESS_TOOL`, `EXEC_TOOL`, `WAIT_TOOL` | re-export (const) | 各 tool 的 LlmTool 定义 |
| `MARK_PARAM`, `TITLE_PARAM` | re-export (const) | 共用 JSON Schema 参数定义 |

#### `executable/tools/schema.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `MARK_PARAM` | const | mark 参数的 JSON Schema（所有 tool 共用，inbox 消息标记） |
| `TITLE_PARAM` | const | title 参数的 JSON Schema（open/refine/submit 共用） |

#### `executable/tools/close.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `CLOSE_TOOL` | const (LlmTool) | close tool 定义：关闭任意 ContextWindow |
| `handleCloseTool` | function | close tool 执行入口：级联关闭、释放 knowledge 引用、触发 onClose |

#### `executable/tools/compress.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `COMPRESS_TOOL` | const (LlmTool) | compress tool 定义：scope=windows / events / auto |
| `EventsRingConfig` | interface | events ring 配置（headRoundsJ / tailRoundsK） |
| `DEFAULT_EVENTS_RING_CONFIG` | const | 默认值 J=10, K=40 |
| `loadEventsRingConfig` | function | 从 stone 的 `config/context-budget.json` 读 eventsRing |
| `handleCompressTool` | function | compress tool 入口：分派 scope=windows / events / auto |

#### `executable/tools/exec.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `EXEC_TOOL` | const (LlmTool) | exec tool 定义：在某 window 上调用一条 command |
| `handleExecTool` | function | exec tool 执行入口：含 expand command 拦截、`mgr.openMethodExec` 调用、program command enrich |

#### `executable/tools/wait.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `WAIT_TOOL` | const (LlmTool) | wait tool 定义：声明等指定 window 上的未来 IO |
| `handleWaitTool` | function | wait tool 执行入口：校验合法 IO 来源、切 thread.status=waiting |

### 2.3 windows/_shared/（Window 共享类型与核心管理器）

#### `executable/windows/_shared/types.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `ObjectType` | type | 所有 ContextObject 类型的字符串联合（含 deprecated relation） |
| `WindowStatus` | type | Window 状态值联合（open/executing/success/failed/running/archived/done/active/closed） |
| `ContextWindowProvenance` | interface | ContextObject 出现在 context 中的来源与机制 |
| `ContextWindowRelevance` | interface | ContextObject 的语义重要度（BudgetManager 用） |
| `BaseContextWindow` | interface | 所有 ContextObject 共享的基础字段 |
| `SharingState` | type | 跨 thread 共享状态：ref / lent_out |
| `GuidanceWindow` | interface | form-bound 上下文引导窗（轻量 transient 类型） |
| `ContextObject` | type (union) | canonical union（thread 维度，persist 到 thread-context.json） |
| `ContextWindow` | type (alias) | 历史别名，ContextObject 的别名（保留名称） |
| `ROOT_WINDOW_ID` | const | Root object 的固定 id = "root" |
| `SKILL_INDEX_WINDOW_ID` | const | Skill 索引 object 的固定 id = "skill_index" |
| `SESSION_CREATOR_THREAD_ID` | const | root thread 的 creator 约定值 = "__session__" |
| `generateWindowId` | function | 按 type 生成带前缀的稳定 window id |
| `creatorWindowIdOf` | function | 派生稳定的 creator do_window / talk_window id |
| *(re-export types)* | type re-export | `RootWindow`, `MethodExecWindow`, `DoWindow`, `TodoWindow`, `TalkWindow`, `ProgramWindow`, `FileWindow`, `KnowledgeWindow`, `SearchWindow`, `SearchMatch`, `RelationWindow`(@deprecated), `PlanWindow`, `PlanWindowStep`, `SkillIndexWindow`, `SkillEntry`, `FeishuChatWindow`, `FeishuChatMessage`, `FeishuDocWindow`, `FeishuDocBlock` 从各自子模块或 builtins re-export |

#### `executable/windows/_shared/command-types.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `MethodKnowledgeEntries` | type | Method knowledge entries（扁平结构，无嵌套子节点） |
| `MethodOutcome` | type | Method exec 的显式返回结果（成功 / 构造新 Object / 失败） |
| `ObjectMethod` | interface | Object method 完整定义（paths / intent / onFormChange / schema / exec / permission / 可见性） |
| `MethodExecutionContext` | interface | Method 执行上下文（thread / form / self / manager / args / owner refs / report hooks） |

#### `executable/windows/_shared/registry.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `OnCloseContext`, `OnCloseHook` | interface / type | window 关闭 hook 的入参与签名 |
| `RenderContext`, `RenderHook` | interface / type | window 渲染 hook 的入参与签名（返回 XmlNode[]） |
| `ReadableFn` | type | 动态渲染函数签名（优先级高于 renderXml） |
| `CompressViewHook` | type | 压缩态渲染 hook（level 1 / 2） |
| `ObjectDefinition` | interface | Object 类型定义：methods / onClose / renderXml / compressView / basicKnowledge / readable / isBuiltinFeature / parentClass |
| `MethodVisibilityContext` | type | method 可见性过滤的上下文（self / peer / ui） |
| `filterMethodsByVisibility` | function | 按可见性过滤 methods（纯函数，委托 runtime 实现） |
| `builtinRegistry` | re-export (ObjectRegistry) | builtin 类型的全局单例注册表 |
| `createObjectRegistry` | re-export (function) | 创建独立 ObjectRegistry 实例 |
| *(type re-exports)* | type re-export | `ObjectRegistry`, `ObjectMethod`, `ContextWindow`, `ObjectType`, `ContextObject` 从 runtime/object-registry re-export |

#### `executable/windows/_shared/manager.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `WindowManager` | class (1160 行) | 统一 ContextWindow 操作入口：持有 thread.contextWindows，封装 openMethodExec / insertTypedWindow / refine / submit / close / CRUD / knowledge 引用计数 / 持久化双写 / reportStateEdit / reportContextEdit |

#### `executable/windows/_shared/init.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `InitContextWindowsOpts` | interface | initContextWindows 的参数（creatorThreadId / initialTaskTitle） |
| `initContextWindows` | function | thread 初始化 helper：注入 self window + creator do/talk window（幂等） |

#### `executable/windows/_shared/viewport.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `Viewport` | interface | file/knowledge window 的精细化窗口（lineStart/lineEnd/columnStart/columnEnd） |
| `DEFAULT_VIEWPORT` | const | 默认值：0-200 行，0-200 列 |
| `ViewportArgs` | interface | set_viewport 命令的参数类型 |
| `mergeViewport` | function | 校验+合并 viewport 部分字段到 current |
| `hasAnyViewportField` | function | 判断 args 是否带任意 viewport 字段 |
| `applyViewport` | function | 按 viewport 切分原始文本，返回带溢出提示的渲染文本 |
| `executeWindowSetViewport` | function | file/knowledge window 共享的 set_viewport 执行入口 |
| `sliceColumn` | function | 单行字符截断（行首/尾 marker） |

#### `executable/windows/_shared/transcript-viewport.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `TranscriptViewport` | interface | talk/do window 的 transcript 渲染窗口（tail 或 rangeStart/rangeEnd，互斥） |
| `DEFAULT_TRANSCRIPT_VIEWPORT` | const | 默认值 tail=20 |
| `TranscriptViewportArgs` | interface | set_transcript_window 命令的参数类型 |
| `mergeTranscriptViewport` | function | 校验+合并 transcript viewport（tail 与 range 互斥切换） |
| `hasAnyTranscriptViewportField` | function | 判断 args 是否带任意 transcript viewport 字段 |
| `applyTranscriptViewport` | function | 按 viewport 截 transcript，返回 visible + earlierCount |
| `executeWindowSetTranscriptViewport` | function | talk/do window 共享的 set_transcript_window 执行入口 |

#### `executable/windows/_shared/session-path.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `resolveSessionPath` | function | 把 LLM 传入的路径解析为绝对路径（相对 baseDir，兼容 stones/→packages/ 前缀） |
| `StonesPathClass` | type (@deprecated) | 旧命名：stone/objects 路径分类（已由 PackagesPathClass 替代） |
| `PackagesPathClass` | type | packages-path 归属判定：package-object / packages-world / non-package |
| `classifyStonesPath` | function (@deprecated) | 旧 classify，委托 classifyPackagesPath + 旧命名映射 |
| `classifyPackagesPath` | function | 判断绝对路径是否落在某个 Object 的 package 自治区下 |
| `__testing` | const | 内部测试导出（rewritePackagesPath / rewritePoolsPath / classify*） |

#### `executable/windows/_shared/super-constants.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `SUPER_SESSION_ID` | const | super flow 受保护 sessionId = "super" |
| `SUPER_ALIAS_TARGET` | const | talk_window.target 的自指别名值 = "super" |
| `isSuperSessionId` | function | 大小写无关校验 "super" |

### 2.4 windows/do/（do_window：同 object 子线程 fork）

#### `executable/windows/do/types.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `DoWindow` | interface | fork 子线程后在父线程下产生的对话窗口（含 targetThreadId / isCreatorWindow / transcriptViewport） |

#### `executable/windows/do/index.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `filterMessagesForDoWindow` | function | 选出与该 do_window targetThreadId 相关的消息（父-子双向） |
| *(side effects)* | registration | 通过 `builtinRegistry.registerObjectType("do", ...)` 注册 type=do 的 definition（methods: continue/wait/close/move/set_transcript_window/do constructor；onClose；renderXml；compressView；isBuiltinFeature=true） |

#### `executable/windows/do/helpers.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `generateMessageId` | function | 生成稳定消息 id |
| `makeMessage` | function | 构造 ThreadMessage（do 来源） |
| `appendInbox` | function | 追加消息到 thread.inbox 并写 inbox_message_arrived 事件 |
| `findChild` | function | 在父 thread 的子树里递归按 id 找子线程 |
| `findThreadInScope` | function | 向下（自身+后裔）+ 向上（_parentThreadRef 链）双向查找线程 |
| `archiveDoWindowChild` | function | archive 子 thread：自动归还借来的 owner windows，切 status=paused |

#### `executable/windows/do/command.continue.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `continueCommand` | const (ObjectMethod) | do_window.continue：向 do_window 关联的对端线程追加消息（父-子 / 子-父 reply 双通道） |

#### `executable/windows/do/command.wait.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `waitCommand` | const (ObjectMethod) | do_window.wait：不发消息，仅切当前线程到 waiting |

#### `executable/windows/do/command.close.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `closeCommand` | const (ObjectMethod) | do_window.close：等价 close tool，归档子线程对话（副作用走 onClose hook） |

#### `executable/windows/do/command.move.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `moveCommand` | const (ObjectMethod) | do_window.move：跨 thread 共享/移交 ContextWindow（ref 只读 / move 所有权移交 / 自动归还识别） |

#### `executable/windows/do/command.set-transcript-window.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `setTranscriptWindowCommandForDo` | const (ObjectMethod) | do_window.set_transcript_window：transcript 渲染窗口精细化调整（tail / range 互斥） |

### 2.5 windows/talk/（talk_window：跨 object 消息派送）

#### `executable/windows/talk/types.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `TalkWindow` | interface | 与另一个 flow object 持续会话的窗口（target / targetThreadId / conversationId / isCreatorWindow / transcriptViewport） |

#### `executable/windows/talk/index.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `filterMessagesForTalkWindow` | function | 按 outbox.windowId + inbox.replyToWindowId 过滤 talk transcript |
| *(side effects)* | registration | `builtinRegistry.registerObjectType("talk", ...)`：注册 methods(say/wait/close/set_transcript_window/talk constructor)、onClose、renderXml、compressView、basicKnowledge、isBuiltinFeature=true |

#### `executable/windows/talk/delivery.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `TalkDeliveryInput` | interface | deliverTalkMessage 的入参（caller thread+window / content / source） |
| `TalkDeliveryResult` | interface | 派送结果（calleeObjectId / calleeThreadId / messageId） |
| `deliverTalkMessage` | function | 跨对象 talk 消息派送的统一入口：5 步（解析 caller/target / 解析或创建 callee thread / 双写消息 / 翻 callee 状态 / 持久化+激活通知），含 super alias 跨 session 支持 |

#### `executable/windows/talk/command.say.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `sayCommand` | const (ObjectMethod) | talk_window.say：向 talk 对端发一条消息（委托 deliverTalkMessage），可选 wait=true |

#### `executable/windows/talk/command.wait.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `waitCommand` | const (ObjectMethod) | talk_window.wait：不发消息，仅切当前线程到 waiting 等对端回复 |

#### `executable/windows/talk/command.close.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `closeCommand` | const (ObjectMethod) | talk_window.close：等价 close tool（副作用走 onClose；creator talk_window 被 onClose 拒绝） |

#### `executable/windows/talk/command.set-transcript-window.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `setTranscriptWindowCommandForTalk` | const (ObjectMethod) | talk_window.set_transcript_window：transcript 渲染窗口精细化调整 |

### 2.6 windows/method_exec/（form 生命周期）

#### `executable/windows/method_exec/types.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `MethodExecWindow` | interface | method 调用时的临时 sub-window：command / description / accumulatedArgs / commandPaths / knowledge paths / status / result / schema / fill |

#### `executable/windows/method_exec/index.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| *(side effects)* | registration | `builtinRegistry.registerObjectType("method_exec", ...)` 和兼容 alias `"command_exec"`：注册 methods(refine/submit)、readable、basicKnowledge、isBuiltinFeature=true、parentClass=null |

#### `executable/windows/method_exec/refine.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `refineMethod` | const (ObjectMethod) | method_exec.refine：把 ctx.args 整体 merge 到 form.accumulatedArgs，支持 failed→open 复活 |

#### `executable/windows/method_exec/submit.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `submitMethod` | const (ObjectMethod) | method_exec.submit：触发 form.command.exec（走 manager.submit，状态机 open→executing→success/failed） |

#### `executable/windows/method_exec/readable.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `readable` | function (ReadableFn) | method_exec window 的 readable hook：渲染 accumulated_args / paths / result / schema / fill_state / next_steps |

### 2.7 windows/relation/（deprecated：relation_window）

#### `executable/windows/relation/types.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `RelationWindow` | interface (@deprecated) | 与某个 peer flow object 的关系窗口（peerId / peerReadme* / selfLongTerm* / selfSession*），已被 peer Object 自动注入替代 |

#### `executable/windows/relation/index.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `RELATION_WINDOW_BASIC_KNOWLEDGE` | const (@deprecated) | relation_window 的 basicKnowledge 文本 |
| `executeRelationEdit` | function (@deprecated) | relation_window.edit：整文件替换 relation 文件（scope=session 直写 / scope=long_term 派 super flow） |
| *(side effects)* | registration (@deprecated) | `builtinRegistry.registerObjectType("relation", ...)`：注册 method(edit)、renderXml、basicKnowledge |

### 2.8 windows/index.ts（barrel + side-effect 注册）

| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| *(type re-exports)* | type re-export | `ContextObject`, `ContextWindow`, `WindowStatus`, `BaseContextWindow`, `RootWindow`, `MethodExecWindow`, `DoWindow`, `TodoWindow`, `TalkWindow`, `ProgramWindow`, `FileWindow`, `KnowledgeWindow`, `SearchWindow`, `SearchMatch`, `RelationWindow`(@deprecated), `PlanWindow`, `PlanWindowStep`, `GuidanceWindow`, `ObjectType` |
| *(value re-exports)* | value re-export | `ROOT_WINDOW_ID`, `SESSION_CREATOR_THREAD_ID`, `generateWindowId`, `creatorWindowIdOf` |
| *(registry re-exports)* | value re-export | `builtinRegistry`, `createObjectRegistry`, `filterMethodsByVisibility` |
| *(registry type re-exports)* | type re-export | `ObjectDefinition`, `ObjectRegistry`, `OnCloseHook`, `OnCloseContext`, `RenderHook`, `RenderContext`, `ReadableFn`, `MethodVisibilityContext` |
| *(command type re-exports)* | type re-export | `ObjectMethod`, `MethodExecutionContext`, `MethodKnowledgeEntries`, `MethodOutcome` |
| *(manager re-export)* | value re-export | `WindowManager` |
| *(init re-export)* | value/type re-export | `initContextWindows`, `InitContextWindowsOpts` |
| *(root methods re-export)* | value re-export | `ROOT_METHODS`, `getOpenableMethods`, `deriveRootMethodPaths`, `execRootMethod`（从 `@ooc/builtins/root`） |
| *(side-effect imports)* | registration | import `@ooc/builtins/root`、`./do/index.js`、`./talk/index.js`、`./method_exec/index.js`、`./relation/index.js`、`../../extendable/index.js`，触发 side-effect registration；最后 `assertAllObjectDefinitionsRegistered()` |

### 2.9 server/（Stone Object 运行时定义）

#### `executable/server/types.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `ProgramSelf` | interface | program 模式 ts/js sandbox 注入的 self（dir / callCommand / getData / setData / getThreadLocal / setThreadLocal） |
| `UiServerMethodContext` | interface | ui_methods 调用上下文（self / thread.inject / persistence） |
| `UiServerMethod` | interface | 单个 ui_methods 方法（description / params / knowledge / fn） |
| `UiMethods` | type | server/index.ts 暴露的 ui_methods 字典 |
| `ServerLoaderEntry` | interface | loader 内部缓存条目（mtime / window / uiMethods / readable） |
| *(type re-exports)* | type re-export | `ObjectWindowDefinition`, `StoneObjectRef`, `ThreadContext` |

#### `executable/server/loader.ts` (@deprecated)
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `loadObjectWindow` | function (@deprecated) | thin wrapper：`defaultServerLoader.loadObjectWindow` |
| `loadUiServerMethods` | function (@deprecated) | thin wrapper：`defaultServerLoader.loadUiServerMethods` |
| `loadObjectReadable` | function (@deprecated) | thin wrapper：`defaultServerLoader.loadObjectReadable` |
| `clearServerLoaderCache` | function (@deprecated) | thin wrapper：`defaultServerLoader.clearCache` |
| *(type re-exports)* | type re-export | `ServerLoader` |
| *(value re-exports)* | value re-export | `createServerLoader` |

#### `executable/server/enrich.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `enrichProgramFormMethod` | function | 给 method_exec form 补充 command knowledge path 列表（实际上只是从 thinkable 反向 re-export 的 `enrichFormMethodKnowledge` 的一行透传） |

#### `executable/server/self.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `createProgramSelf` | function | 构造 program 模式注入的 self 对象（dir / callCommand / getData / setData / getThreadLocal / setThreadLocal） |

#### `executable/server/window-types.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `CustomMethodContext` | interface | Object window 的 commands[name].exec 收到的 ctx = 标准 MethodExecutionContext + programSelf |
| `ObjectWindowDefinition` | interface | Object 在 `server/index.ts` 里 `export const window` 的形状（title/description/renderXml/readable/basicKnowledge/onClose/prototype(@deprecated)/parentClass/commands/methods(alias)） |

### 2.10 program/（程序运行时 · 保留不迁移）

#### `executable/program/types.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `ProgramExecutionResult` | interface | 用户代码执行结果（success / returnValue / stdout / error） |

#### `executable/program/shell.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `runShellProgram` | function | 运行 shell 代码：Bun.spawn(["sh", "-c", code])，30s 超时，统一格式化输出 |

#### `executable/program/self-env.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `buildProgramShellEnv` | function | shell 模式下为当前线程派生额外环境变量（当前只透出 `OOC_SELF_DIR`） |

#### `executable/program/format.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `formatShellResult` | function | 把 shell 的 stdout/stderr/exitCode 格式化为单行命令头 + [stdout]/[stderr]/[exit N] |
| `formatProgramResult` | function | 把 ts/js executor 的结果与返回值统一格式化为单一字符串（4KB 截断） |

#### `executable/program/sandbox/executor.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `executeUserCode` | function | 执行一段 ts/js 用户代码（in-process 动态 import）：wrapUserCode → 写临时 .mjs → import → 捕获 console + 异常 + 行号 |

#### `executable/program/sandbox/wrap.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `wrapUserCode` | function | 把用户 ts/js 代码包成 ES module 文本（提取 import 到顶层、塞入 default async function、预声明 `let _result_`） |

#### `executable/program/sandbox/console.ts`
| 符号 | 类型 | 一句话说明 |
|------|------|-----------|
| `CapturingConsole` | interface | 自定义 console 结构（log/warn/error sink + drain） |
| `createCapturingConsole` | function | 创建累积式 console：所有 log/warn/error 文本进 buffer，drain() 一次性取出 |

---

## 3. 哪些不属于我 / 哪些我做得不好

### 3.1 (a) 不该放在 executable 的功能

| # | 问题 | 锚定位置 | 说明 |
|---|------|---------|------|
| a1 | Window 类型定义集中在我这里 | `windows/_shared/types.ts:82-253` | `BaseContextWindow`、`ContextObject` union、`ObjectType`、`GuidanceWindow`、`SharingState`、`WindowStatus`、`ContextWindowProvenance`、`ContextWindowRelevance` 都是**数据定义而非执行逻辑**。它们被 thinkable/render、persistable、app/server、builtins 大量引用，属于共享类型，应迁到 `_shared/types/`。同样 `DoWindow`(do/types.ts:14)、`TalkWindow`(talk/types.ts:17)、`MethodExecWindow`(method_exec/types.ts:24)、`RelationWindow`(relation/types.ts:37) 也应迁走。 |
| a2 | renderXml / readable / compressView 渲染逻辑在我这里 | `do/index.ts:60-160`, `talk/index.ts:57-195`, `method_exec/readable.ts:12-85`, `relation/index.ts:221-246` | 这些函数把 ContextWindow 渲染成 `XmlNode[]`，属于**thinkable 语义（上下文合成 / LLM 视角）**而非 executable 行动能力。虽然它们由 registry 声明，但纯渲染逻辑不该由 executable 持有。 |
| a3 | XmlNode 相关类型依赖跨 executable-thinkable | `registry.ts:28`, `do/index.ts:34`, `talk/index.ts:33`, `method_exec/readable.ts:9` | `RenderHook` 返回 `XmlNode[]`，`XmlNode` 定义在 `thinkable/context/xml.ts`。这导致 executable 依赖 thinkable 的视图层类型。 |
| a4 | Intent / FormChangeEvent / MethodCallSchema 等 thinkable 类型被我引用 | `command-types.ts:13-15`, `manager.ts:29` | `ObjectMethod.intent()` 返回 `Intent[]`，`ObjectMethod.onFormChange` 接收 `FormChangeEvent`，`WindowManager` 依赖 `IntentCache` / `MethodCallSchema` / `MethodArgSpec`。这些都是 thinkable 的核心概念，我不该持有它们的类型所有权。 |
| a5 | viewport / transcript-viewport 的纯函数与渲染逻辑 | `_shared/viewport.ts:50-187`, `_shared/transcript-viewport.ts:56-194` | `mergeViewport` / `applyViewport` / `mergeTranscriptViewport` / `applyTranscriptViewport` 是纯数据变换+渲染截断，应迁到 `_shared/utils/`。`executeWindowSetViewport` / `executeWindowSetTranscriptViewport` 是 method 执行体，留在 executable。 |
| a6 | basicKnowledge 文本（LLM prompt 片段）嵌在我这里 | `talk/index.ts:114-143`, `method_exec/index.ts:25-52`, `relation/index.ts:38-58` | 这些是 protocol KnowledgeWindow 的正文内容，属于 thinkable/knowledge 范畴。虽然通过 registry 注入，但文本本身是 prompt 工程。 |
| a7 | `guidanceWindows()` 在每个 command.*.ts 里重复 19 次 | `do/command.close.ts:17-41`, `do/command.continue.ts:35-59`, `do/command.move.ts:82-106`, `do/command.set-transcript-window.ts:52-76`, `do/command.wait.ts:16-40`, `talk/command.say.ts:41-65`, `talk/command.close.ts:16-40`, `talk/command.set-transcript-window.ts:52-76`, `talk/command.wait.ts:16-40`, `method_exec/refine.ts:55-79`, `method_exec/submit.ts:50-74` 等 | 逐字重复的 helper，应抽到 `builtins/_shared/executable/guidance.ts`。 |

### 3.2 (b) 命名问题

| # | 问题 | 锚定位置 | 说明 |
|---|------|---------|------|
| b1 | `server/` 目录名与 HTTP app/server 撞名 | `executable/server/` (5 文件) | 这个 `server/` 是 **Stone Object 的运行时 self 定义**（`server/index.ts` 的 `export const window`），与 HTTP/Elysia 控制面 `app/server/` 完全是两个概念。应改为 `object/`。 |
| b2 | `command.*.ts` 未跟上 `method` 术语 | `do/command.close.ts`, `do/command.continue.ts`, `do/command.move.ts`, `do/command.set-transcript-window.ts`, `do/command.wait.ts`, `talk/command.close.ts`, `talk/command.say.ts`, `talk/command.set-transcript-window.ts`, `talk/command.wait.ts` | P6.§9 已统一术语为 `ObjectMethod`（不再叫 command），但文件名仍保留 `command.*.ts`。应改为 `method.*.ts`（对齐 builtins/root 的 B5 批次）。 |
| b3 | `StonesPathClass` / `classifyStonesPath` 旧命名 | `_shared/session-path.ts:89-114` | stones/ 体系已迁移到 packages/。`StonesPathClass` 是旧命名，`classifyStonesPath` 只是 `classifyPackagesPath` 的命名映射，应删除。 |
| b4 | `ObjectWindowDefinition` 命名不够语义化 | `server/window-types.ts:49` | 这个 interface 描述的是"Stone Object 在 server/index.ts 中声明的 window 定义形态"，应改为 `StoneObjectDeclaration` 更清晰。 |
| b5 | `CustomMethodContext` 命名 | `server/window-types.ts:43` | 自定义 method ctx，但 "Custom" 在 ooc-6 Object Unification 后已不再是 custom window（每个 Object 直接是自己的 type）。可考虑改名或保持。 |
| b6 | `enrichProgramFormMethod` 命名 | `server/enrich.ts:17-22` | 它早已不限于 program command（所有 form 都会走），但名字还带着 Program。且本身只是 `enrichFormMethodKnowledge` 的一行透传。 |
| b7 | `openMethodExec` → `dispatchMethodCall`? | `_shared/manager.ts:356` 方法名 `openMethodExec` | 这个方法实际上不仅"打开"form，args 齐全时还会立即 submit 执行。名字可能误导。保持现状或改名 `dispatchMethodCall`。 |

### 3.3 (c) 过度耦合

| # | 问题 | 锚定位置 | 说明 |
|---|------|---------|------|
| c1 | executable → thinkable 重度耦合 | 所有文件几乎都 import `thinkable/context`, `thinkable/context/intent`, `thinkable/context/xml`, `thinkable/llm/types` | executable 的类型定义和核心逻辑依赖 thinkable 的 7+ 子模块。这是**反向依赖**——按理想架构，_shared 类型应该被两者依赖，而不是 executable 依赖 thinkable。 |
| c2 | thinkable → executable 反向依赖（形成双向耦合） | `executable/index.ts:8-15` 从 thinkable re-export；同时 `thinkable/knowledge/` 等会 import executable 的 window 类型 | executable/index.ts 现在只剩从 thinkable 的反向 re-export（c3），但 thinkable 渲染层仍 import executable 的 ContextWindow 等类型。 |
| c3 | `executable/index.ts` 只剩从 thinkable 反向 re-export | `executable/index.ts:1-16` | 整个 barrel 的内容是 `export { ... } from "../thinkable/knowledge/index.js"`，加上一个 deprecated 的 `collectExecutableKnowledgeEntries`。这是**模块边界倒置**——我的公共门面导出的全是别人的东西。 |
| c4 | executable → observable / persistable 的直接依赖 | `permissions.ts:27-28`, `delivery.ts:37,39`, `manager.ts:28-51`, `self.ts:1-6` | 我直接 import `observable`（`notifyThreadActivated`、`getPermissionDecider`）和 `persistable` 的 IO 函数。按理想架构，observable 应合并进 runtime，persistable 应更底层。 |
| c5 | `server/enrich.ts` 形成环 | `server/enrich.ts:10` import `"../index.js"`（即 executable/index.ts），而 index.ts 又从 thinkable re-export，thinkable 又依赖 executable 的类型 | 虽然 TypeScript 类型层面能 resolve，但这是一个结构脆弱的环。 |

### 3.4 (d) deprecated / dead code

| # | 问题 | 锚定位置 | 说明 |
|---|------|---------|------|
| d1 | `server/loader.ts` 全 deprecated | `server/loader.ts:1-41` | 所有导出都是 thin wrapper 委托 `runtime/server-loader`。文件头已标注 @deprecated M1 2026-06-02，应删除（对齐 A4）。 |
| d2 | `collectExecutableKnowledgeEntries` deprecated re-export | `executable/index.ts:13-14` | Phase F 已由 ContextPipeline 替代，应删除。 |
| d3 | `windows/relation/` 全 deprecated | `relation/types.ts:2-36`, `relation/index.ts:1-16` | ooc-6 Phase 6 已被 peer Object 自动注入替代。保留向后兼容一个 release 后应移除。 |
| d4 | `executable/index.ts` barrel 本身无价值 | `executable/index.ts:1-16` | 除了从 thinkable 反向 re-export 4 个符号，没有任何 executable 自己的导出。应删除或替换为真正的 executable 公共 API 导出（对齐 A3）。 |
| d5 | `server/window-types.ts` 中 `prototype` deprecated alias | `server/window-types.ts:71-74` | 已降级为 `parentClass` 的配置别名，过渡期保留。 |
| d6 | `server/window-types.ts` 中 `commands` vs `methods` 双字段 | `server/window-types.ts:86-92` | `methods` 作为 `commands` 的别名，过渡期保留。应统一为一个字段。 |
| d7 | `command_exec` legacy type 注册 | `method_exec/index.ts:78-84` | `"command_exec"` 作为 `"method_exec"` 的 legacy alias 注册。thread-json.ts 读路径已做迁移，可评估是否还需要。 |

### 3.5 (e) 代码质量

| # | 问题 | 锚定位置 | 说明 |
|---|------|---------|------|
| e1 | `console.warn` 散落 7+ 处 | `_shared/manager.ts:806, 820, 826, 853, 858, 902, 905, 967, 975`（共 9 处） | WindowManager 持久化失败全部裸 `console.warn`。应统一走 observable 注入的 logger，debug 开关联动（对齐 D6）。 |
| e2 | `manager.ts` 体积 1160 行 | `_shared/manager.ts` | 一个 class 承担了 form 生命周期、typed window 插入、权限守门？不——权限在 permissions.ts、持久化双写（12 个持久化相关方法）、report hooks、sharing 守门、schema/fill 验证、intentCache 更新、onFormChange dispatch、guidance window 管理。应拆分为：`manager-core.ts`(CRUD+submit)、`manager-persistence.ts`(双写+refs)、`manager-schema.ts`(fill+validate)、`manager-intent.ts`(intentCache+onFormChange)。 |
| e3 | 权限模块直接 `readFileSync policies.json` | `permissions.ts:24-25, 99` | `loadPoliciesJson` 直接用 `readFileSync` 读文件，未通过 persistable 层。虽然是同步读取且容错足够，但与"IO 统一走 persistable"的边界不符。 |
| e4 | compress.ts 中同样直接 `readFileSync context-budget.json` | `tools/compress.ts:19-20, 197` | 同上，同步 IO 不走 persistable。 |
| e5 | 各 `command.*.ts` 中逐字重复的 `guidanceWindows()` helper | 见 a7 的 11 处文件 | 每处 24 行完全相同的函数体，严重 DRY 违反。 |
| e6 | do/talk 的 `waitCommand` 实现几乎逐字相同 | `do/command.wait.ts:42-49`, `talk/command.wait.ts:42-49` | 仅错误消息前缀不同（`[do_window.wait]` vs `[talk_window.wait]`）。可抽到 _shared。 |
| e7 | do/talk 的 `closeCommand` 实现差异大但模式相同 | `do/command.close.ts:50-60`, `talk/command.close.ts:42-52` | 结构都是：定义 knowledge 常量 + guidanceWindows() + exec。模式重复。 |
| e8 | `makeSnapshot` / `generateThreadId` / `generateMessageId` / `guidanceWindows` 等工具函数在多处复制定义 | `do/index.ts:232-249`, `do/helpers.ts:8-21`, `talk/delivery.ts:60-62` | `generateMessageId` 在 do/helpers.ts 和 talk/delivery.ts 各有一份；`generateThreadId` 在 do/index.ts；`makeSnapshot` 在 do/command.move.ts:126。 |
| e9 | `_shared/session-path.ts` 中 `rewritePoolsPath` 现在是 no-op | `_shared/session-path.ts:73-75` | 注释说"保留为 no-op 以便调用方保持统一接口"，但 pools path 重写逻辑已废弃，可以删除简化。 |
| e10 | `enrichProgramFormMethod` 仅 exec tool 中 program command 特判调用 | `tools/exec.ts:123-127` + `server/enrich.ts:17-22` | enrich 逻辑只针对 program command，但写在通用 enrich 函数里。特判逻辑散落在调用方，不够优雅。 |

---

## 4. 理想的我

```
executable/
├── index.ts                      # 真正的 executable 公共 API barrel（tool dispatch / permissions / WindowManager / registry）
├── permissions.ts                # 三档权限决策链（保持，但 IO 走 persistable）
├── tools.ts                      # getAvailableTools / dispatchToolCall（保持）
│
├── tools/                        # LLM 4 原语（保持）
│   ├── index.ts
│   ├── schema.ts
│   ├── close.ts
│   ├── compress.ts               # 保持，但 config 读取走 persistable
│   ├── exec.ts
│   └── wait.ts
│
├── windows/
│   ├── index.ts                  # barrel + side-effect registration（精简：不再 re-export thinkable 的类型）
│   │
│   ├── _shared/                  # 执行侧共享（类型迁去 _shared/types/ 后，这里只留执行逻辑）
│   │   ├── types.ts              # ← 只保留 executable 执行侧特有的类型（不再是所有 Window 类型的主定义）
│   │   ├── manager.ts            # ← 拆分为 manager-core / manager-persistence / manager-schema / manager-intent
│   │   ├── manager-core.ts       #   (new) CRUD + openMethodExec + refine + submit + close 核心状态机
│   │   ├── manager-persistence.ts#   (new) 双写 context/ + flows/ + registry + report hooks
│   │   ├── manager-schema.ts     #   (new) buildFillState + validateArgValue
│   │   ├── manager-intent.ts     #   (new) fireStatusChanged + intentCache + onFormChange + guidance unload
│   │   ├── init.ts               # 保持（但 Window 类型从 _shared/types/ 引用）
│   │   ├── viewport.ts           # 保持 executeWindowSetViewport；纯函数迁 _shared/utils/viewport.ts
│   │   ├── transcript-viewport.ts# 保持 executeWindowSetTranscriptViewport；纯函数迁 _shared/utils/transcript-viewport.ts
│   │   ├── session-path.ts       # 保持，但删除 StonesPathClass / classifyStonesPath / rewritePoolsPath
│   │   └── super-constants.ts    # 保持
│   │
│   ├── do/                       # 保持，但文件改名 command.*.ts → method.*.ts
│   │   ├── index.ts              #   注册 definition；renderXml / compressView 抽到 thinkable renderers
│   │   ├── types.ts              #   (类型所有权迁 _shared/types/，这里仅 re-export 或删除)
│   │   ├── helpers.ts            #   保持；generateMessageId 等抽公共
│   │   ├── method.continue.ts    #   ← 从 command.continue.ts 改名
│   │   ├── method.wait.ts        #   ← 从 command.wait.ts 改名
│   │   ├── method.close.ts       #   ← 从 command.close.ts 改名
│   │   ├── method.move.ts        #   ← 从 command.move.ts 改名
│   │   └── method.set-transcript-window.ts
│   │
│   ├── talk/                     # 同 do 模式
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── delivery.ts
│   │   ├── method.say.ts
│   │   ├── method.wait.ts
│   │   ├── method.close.ts
│   │   └── method.set-transcript-window.ts
│   │
│   ├── method_exec/              # 保持
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── refine.ts
│   │   ├── submit.ts
│   │   └── readable.ts           #   (渲染逻辑所有权迁 thinkable，但实现可暂留此处)
│   │
│   └── relation/                 # ← Phase 9 cleanup 时整个目录删除
│       ├── index.ts  (@deprecated, to remove)
│       └── types.ts   (@deprecated, to remove)
│
├── object/                       # ← 从 server/ 改名
│   ├── types.ts                  #   ProgramSelf / UiServerMethod* / ServerLoaderEntry
│   ├── object-types.ts           #   ← 从 window-types.ts 改名；ObjectWindowDefinition → StoneObjectDeclaration
│   ├── self.ts                   #   createProgramSelf（保持）
│   └── enrich.ts                 #   改名 enrichMethodExecForm 或删除（一行透传）
│   # loader.ts 删除（A4 批次已覆盖）
│
└── program/                      # 按 D1 约束 **保留不移动**
    ├── types.ts
    ├── shell.ts
    ├── self-env.ts
    ├── format.ts
    └── sandbox/
        ├── executor.ts
        ├── wrap.ts
        └── console.ts
```

**设计原则**：
- 类型所有权迁 `_shared/types/`，我只持有**执行逻辑**
- 纯函数（viewport 截断、path 归一化）迁 `_shared/utils/`
- 渲染逻辑（renderXml / readable / compressView / basicKnowledge 文本）迁 thinkable/renderers（或 builtins 的 visible 层）
- 命名统一：`server/` → `object/`，`command.*.ts` → `method.*.ts`
- `WindowManager` 拆分 4 文件，降低单文件复杂度
- 删除所有 deprecated thin wrapper 和 relation

---

## 5. 我的优化方案（分批次）

对齐总纲 README.md 的 A/B/C/D 批次，以下是 executable 视角的具体行动。

### 批次 A：死代码删除（≤ 1 天）

| 行动 | 影响文件 | 说明 |
|------|---------|------|
| A3 | 删除 `executable/index.ts` barrel（替换为真正的 executable API 导出） | `executable/index.ts` | 当前 barrel 只剩从 thinkable 反向 re-export。删除后调用方改从 thinkable/knowledge import。executable 自己的公共 API（WindowManager、builtinRegistry、getAvailableTools、dispatchToolCall、decidePermission 等）应从各自文件直接 import，或我新建最小 barrel 只导出我自己的符号。 |
| A4 | 删除 `executable/server/loader.ts` deprecated thin wrapper | `executable/server/loader.ts` + 若干 import 点 | 所有调用方改 `import { createServerLoader, ServerLoader } from "@ooc/core/runtime/server-loader"` 或 `WorldRuntime.serverLoader`。 |
| *(后续)* A2/A5/A6/A7/A8/A9/A10/A11 | 见 thinkable / persistable 子方案 | 这些批次主要影响其他模块，我只被动配合 import 更新。 |

**executable 视角预估**：改 2 文件 + 搜索替换所有 `from "../../executable"` 对 deprecated 符号的引用。

### 批次 B：builtins 重复代码抽取 + 命名统一（≤ 2 天）

| 行动 | 影响文件 | 说明 |
|------|---------|------|
| B1 | 配合 builtins 抽取 `guidanceWindows()` 到 `builtins/_shared/executable/guidance.ts` | `do/command.*.ts` (5)、`talk/command.*.ts` (4)、`method_exec/refine.ts`、`method_exec/submit.ts` — 共 11 文件 | executable 自身的 11 处 `guidanceWindows()` 重复同样需要替换。这个 helper 实际上是"构造 GuidanceWindow 数组"的通用逻辑，与 builtins 中 root command 的版本完全一致。 |
| B5 | **executable 侧：** `windows/do/command.*.ts` → `method.*.ts`（5 文件）；`windows/talk/command.*.ts` → `method.*.ts`（4 文件） | 9 文件改名 + 所有 import 更新 | 对齐 builtins/root 的命名统一（B5）。注意：这些文件在 `windows/<type>/index.ts` 中被 import，所以 index.ts 的 import 路径也要更新。 |

**executable 视角预估**：9 文件改名 + ~20 import 更新 + 11 文件删除重复 helper。

### 批次 C：中立共享类型包建立（2-3 天，最大单项）

| 行动 | 说明 |
|------|------|
| C2 | 迁出 `ContextWindow` 家族类型到 `_shared/types/` | `windows/_shared/types.ts` 中 `BaseContextWindow`、`ContextObject`、`ContextWindow`、`ObjectType`、`WindowStatus`、`GuidanceWindow`、`SharingState`、`ContextWindowProvenance`、`ContextWindowRelevance`；以及 `do/types.ts` 的 `DoWindow`、`talk/types.ts` 的 `TalkWindow`、`method_exec/types.ts` 的 `MethodExecWindow`、`relation/types.ts` 的 `RelationWindow`(@deprecated)。执行侧文件改为从 `@ooc/core/_shared/types` import。 |
| C3 | 迁出 `ObjectMethod` / `MethodExecutionContext` / `MethodKnowledgeEntries` / `MethodOutcome` 到 `_shared/types/` | `windows/_shared/command-types.ts` 全部类型迁出。executable 改为 re-export（保持对外兼容）。 |
| C4 | 迁出 `ObjectDefinition` / `ObjectRegistry` 接口（实现留 runtime） | `windows/_shared/registry.ts` 中的 interface 定义迁出，保留 `builtinRegistry` / `createObjectRegistry` / `filterMethodsByVisibility` 的 value re-export。 |
| C5 | 配合迁出 `ThreadContext` / `ProcessEvent` / `ThreadMessage` 到 `_shared/types/` | executable 大量 import 这些类型，需要批量更新 import 路径。 |
| C6 | 配合迁出 `Intent` / `FormChangeEvent` / `IntentCache` / `MethodCallSchema` / `MethodArgSpec` | `manager.ts`、`command-types.ts` 等大量引用。 |
| C7 | 配合迁出 `XmlNode` / `xmlElement` / `xmlText` / `serializeXml` | `do/index.ts`、`talk/index.ts`、`method_exec/readable.ts`、`relation/index.ts`、`registry.ts` 中的 renderXml/readable 返回类型。 |
| C9 | 更新 executable 的 barrel re-export | 如果删除 executable/index.ts（A3），则在各子模块 barrel 中保持对外兼容的 re-export。 |

**executable 视角预估**：几乎所有源文件的 import 路径需要更新（~40 文件）。但只是 import 路径改变，不涉及逻辑变更。

### 批次 D：executable 内部清理 + 命名（≤ 1 天）

| 行动 | 影响文件 | 说明 |
|------|---------|------|
| D1 | `executable/server/` → `executable/object/`（5 文件）；`window-types.ts` → `object-types.ts`；`ObjectWindowDefinition` → `StoneObjectDeclaration` | `server/types.ts`, `server/loader.ts`(已删), `server/enrich.ts`, `server/self.ts`, `server/window-types.ts` + 所有引用这些路径的 import | `persistable/`、`runtime/`、`app/server/`、`builtins/*` 中会有若干 import `@ooc/core/executable/server/...` 需要更新。 |
| D2 | `MethodExecWindow.command` → `MethodExecWindow.method`（~26 处引用） | `method_exec/types.ts:27` + `manager.ts`, `exec.ts`, `enrich.ts`, 所有 command.*.ts / method.*.ts | thread-json backward-compat 层需要在 persistable 侧处理（读旧 "command" 字段迁移到 "method"）。executable 自身全部改写字段名。 |
| D3 | 删除 `StonesPathClass` / `classifyStonesPath` | `_shared/session-path.ts:89-114` | 删除旧命名。检查是否有外部调用方仍在使用。 |
| D4 | `enrichProgramFormMethod` 更名或删除 | `server/enrich.ts`, `tools/exec.ts:123-127` | 若实际只有 program 特判调用，可直接 inline 到 exec.ts，删除 enrich.ts。 |
| D5 | `openMethodExec` 更名评估 | `_shared/manager.ts:356` + 所有调用方 | 可选行动。若改为 `dispatchMethodCall` 更语义准确，但涉及面较广。建议先保持现状，在后续批次再评估。 |
| D6 | 统一 logger：9 处 `console.warn` → observable 注入的 logger | `_shared/manager.ts` (9 处) | 需要 observable 暴露统一 logger API。如果 F1 批次 observable 先并入 runtime，则改从 runtime 取 logger。 |
| *(附加)* D7 | `WindowManager` 拆分：1160 行 → 4 文件 | `_shared/manager.ts` → `manager-core.ts` + `manager-persistence.ts` + `manager-schema.ts` + `manager-intent.ts` | 可选增强项。A/B/C/D 批次完成后做，降低复杂度。 |
| *(附加)* D8 | 删除 `relation/` 整个 deprecated 目录 | `windows/relation/` (2 文件) | 如果向后兼容数据已全部迁移完成，可执行。 |

**executable 视角预估**：D1-D6 主项覆盖 ~35 文件。D7/D8 为附加增强。

---

## 6. 我对其他模块的要求

以下是 executable 为了完成自身清理，需要其他模块配合的事项：

### 对 `_shared/types/`（新建，shared-types 子方案）
1. **必须提供**：`ContextWindow` 家族（含所有子类型）、`ObjectMethod` / `MethodExecutionContext`、`ObjectDefinition` / `ObjectRegistry` 接口、`ThreadContext` / `ProcessEvent` / `ThreadMessage`、`Intent` / `FormChangeEvent` / `IntentCache` / `MethodCallSchema` / `MethodArgSpec`、`XmlNode` / `xmlElement` / `xmlText` / `serializeXml`。
2. **期望提供**：`Viewport` / `TranscriptViewport` 接口类型（纯类型部分，纯函数实现放 `_shared/utils/`）。
3. 所有类型导出必须在 `packages/@ooc/core/_shared/` 的 package.json exports 中正确声明，bun/ts 都能 resolve。

### 对 `_shared/utils/`（新建，shared-types 子方案）
1. **期望迁入**：`mergeViewport` / `applyViewport` / `sliceColumn` / `hasAnyViewportField`（从 `windows/_shared/viewport.ts`）；`mergeTranscriptViewport` / `applyTranscriptViewport` / `hasAnyTranscriptViewportField`（从 `windows/_shared/transcript-viewport.ts`）。
2. 这些函数必须保持纯函数签名，不依赖 executable 的任何类型（使用 `_shared/types/` 中的类型）。

### 对 `thinkable/`（thinkable 子方案）
1. **C2-C7 配合**：thinkable 侧同步把类型引用切换到 `_shared/types/`，确保 executable 完成 import 切换后无类型错误。
2. **渲染逻辑归属**：`do/index.ts`、`talk/index.ts`、`method_exec/readable.ts`、`relation/index.ts` 中的 `renderXml` / `compressView` / `readable` 函数——是迁到 thinkable/renderers 还是继续通过 registry 注入但实现留在 builtins visible 层，需要 thinkable 子方案明确决策边界。
3. **basicKnowledge 文本**：`TALK_WINDOW_BASIC_KNOWLEDGE`、`METHOD_EXEC_BASIC_KNOWLEDGE`、`RELATION_WINDOW_BASIC_KNOWLEDGE` 等 protocol knowledge 文本——是否应由 thinkable/knowledge 统一管理（executable 只需引用 path）？
4. **解除 executable/index.ts 反向 re-export 的依赖**：thinkable 侧若有从 executable import knowledge 相关符号的代码，应改为直接从 thinkable/knowledge 导入。
5. **G4 XmlRenderer 通过 registry 抽象**：thinkable 的 XmlRenderer 当前直接 import `filterMessagesForDoWindow` / `filterMessagesForTalkWindow`（`thinkable/context/render.ts` 需确认），应改为通过 `ObjectDefinition` 上的 render hook 走 registry 抽象，消除对 executable 具体子模块的直接依赖。

### 对 `persistable/`（persistable 子方案）
1. **IO 统一入口**：`permissions.ts:loadPoliciesJson` 和 `tools/compress.ts:loadEventsRingConfig` 当前直接 `readFileSync`。persistable 应暴露 `readStoneConfig(stoneRef, configName)` 之类的同步/异步 API，供 executable 调用。
2. **D2 backward-compat**：`MethodExecWindow.command` → `method` 字段重命名，thread-json 读路径需要在 persistable 层做旧数据迁移（从 `"command"` 读到新字段 `"method"`）。
3. **E5 过期 backward-compat 删除**：如果 persistable 删除 `command_exec → method_exec`、`status: executed → failed` 等迁移层，需要 executable 同步确认不再产生旧格式数据。

### 对 `runtime/`（隐含在 app-and-observable 子方案中）
1. **D6 统一 logger**：observable 并入 runtime 后（F1），runtime 应暴露统一 logger API（如 `runtime.logger.warn()`），executable 的 9 处 `console.warn` 改走这个 logger。
2. **server-loader 已经在 runtime**：`runtime/server-loader.ts` 是 canonical source，executable 删除 loader.ts 后所有调用方应能直接从 runtime import。
3. **object-registry 已经在 runtime**：`runtime/object-registry.ts` 是实现层，executable 的 `registry.ts` 已经 re-export，继续保持这个模式即可。

### 对 `builtins/`（builtins 子方案）
1. **B1 guidanceWindows() 抽取**：executable 的 11 处和 builtins 的 19+ 处 `guidanceWindows()` 需要统一抽到 `builtins/_shared/executable/guidance.ts`。需要 builtins 侧先落地抽取，executable 再跟进替换。
2. **B5 命名统一对齐**：builtins 改 `command.*.ts` → `method.*.ts` 时，executable 同步改 windows/do 和 windows/talk 下的同名文件，保证命名一致。
3. **root methods 依赖**：`windows/index.ts:76-81` 从 `@ooc/builtins/root` re-export `ROOT_METHODS` / `getOpenableMethods` 等——如果 builtins 调整这些符号的导出位置，需要同步更新。
4. **a2 renderXml 归属决策**：builtins/file / knowledge / search / program / todo / plan / skill_index 的 renderXml 实现都在各自 builtin 包中。executable 的 do/talk/method_exec/relation 的 renderXml 与 builtins 的 renderXml 是否应统一收纳在同一位置（如 builtins/_shared/visible/），需要 builtins 子方案给出结论。

### 对 `app/server/`（app-and-observable 子方案）
1. **F4 UI API 逻辑下沉**：`app/server/modules/ui/api.list-window-types.ts` 中 70+ 行 `extractBasicDescription` 逻辑应下沉到 executable 的 registry 层（如 `registry.listVisibleWindowTypes()`），HTTP 层只做暴露。app/server 侧执行下沉时需要 executable 提供对应 API。
2. **D1 server/ → object/ 路径更新**：如果 app/server 中有 import `@ooc/core/executable/server/`，需要同步改路径。

---

## 附录前补充：ContextWindow ↔ OOC Object 关系重定义 + readable 展示控制 method 归属澄清

> 2026-06-04 设计澄清：与 thinkable 子方案对齐。纠正 executable 侧对"window method vs object method 的边界理解。影响批次 D（命名）、批次 C（_shared/types/ ObjectDefinition 接口）。

### 一、ContextWindow 与 OOC Object 是交

**先前断言："ContextWindow 是 OOC Object 出现在 context 中的形态"** 草率。从 executable 视角纠正：

- **我负责执行 OOC Object.method 的调度**（WindowManager.submit → exec），也负责 ContextWindow 的 CRUD（WindowManager.insertTypedWindow / close 等）。两者不是一回事：
  - **OOC Object**：是 persistable stone 中的实体，有 stone self.md / executable / visible / knowledge 四件套。Context pipeline 中把某个 Object 作为一个 window 注入时，这是"Object 作为 ContextWindow"——只是 ContextWindow 的**一种**。
  - **ContextWindow**：是 thread 中 LLM 能看到的一切上下文单元。除 Object 外还有：
    - `talk`：跨 Object 的通信管道，不是 Object 本身
    - `do`：同 Object 内的子线程 fork 产物，不是 Object 本身
    - `method_exec`：Object.method 调用过程中的临时 form，不是 Object 本身
    - `GuidanceWindow`：form-bound 的 transient 引导窗

对 executable 的核心含义：
1. **WindowManager（我负责）只管 ContextWindow 的生命周期**，不区分这个 window 是不是 OOC Object。`ctx.self` 永远是 ContextWindow 对象，不是 Object。
2. **ObjectMethod（我注册在 registry 上）只服务 OOC Object**。`talk/do/method_exec` 这三个非 Object 的 window type，它们的 method（continue/say/refine/submit/set_transcript_window 等）虽然也通过同一套 ObjectMethod 接口注册，但语义上它们是**window method**而非 object method。区分：
   - **Object method**：exec 内会改 Object 的状态（如 file.edit 写磁盘、plan.add_step 改 step 列表、todo.close 改 todo state）
   - **Window method（展示控制）**：exec 内只改 `ctx.self`（ContextWindow）的 viewport/transcriptViewport 等展示字段，不碰 Object 状态

### 二、展示控制 method 不该是 Object method，应归 readable

当前我注册了以下"展示控制" method 作为 ObjectMethod：

| method | 当前注册位置 | 副作用 | 是否改 Object |
|--------|---------|-----|-----|
| `file.set_viewport` | `builtins/file/executable/index.ts:208` | 写 `ctx.self.viewport` | 否 |
| `knowledge.set_viewport` | `builtins/knowledge/executable/index.ts:125` | 写 `ctx.self.viewport` | 否 |
| `file.set_range` | `builtins/file/executable/index.ts:192` | 写 `ctx.self.lines/columns`（遗留） | 否 |
| `talk.set_transcript_window` | `executable/windows/talk/command.set-transcript-window.ts:79` | 写 `ctx.self.transcriptViewport` | 否 |
| `do.set_transcript_window` | `executable/windows/do/command.set-transcript-window.ts:79` | 写 `ctx.self.transcriptViewport` | 否 |
| `search.set_results_window` | `builtins/search/executable/command.set-results-window.ts:82` | 写 `ctx.self.resultsViewport` | 否 |
| `program.set_history_window` | `builtins/program/executable/index.ts:169` | 写 `ctx.self.historyViewport` | 否 |

它们**全部只改 window 自身的展示字段**，与 Object 无关。当前放在 executable/ 层注册是因为：历史上所有 method 都走 ObjectMethod 接口，没有区分。

**设计修正**：`ObjectDefinition.readableMethods` 字段（在 _shared/types/registry.ts 中新增）由 readable 层声明这些 method。executable 的 ObjectMethod 接口保持不变，**但 WindowManager 在 dispatch 时区分：**
- Object method → 走原路径（exec 可写 Object 状态、可写磁盘、可跨线程）
- 展示控制 window method → 受限路径：exec 只能读/写 `ctx.self`（ContextWindow），禁止访问 Object 的任何持久化状态

对 executable 的影响（后续批次）：
1. 批次 C：`ObjectDefinition` 接口新增 `readableMethods?: Record<string, ObjectMethod>` 字段。
2. 批次 D 扩展：把上表 7 个展示控制 method 从 `executable/windows/*/command.*.ts` 和 `builtins/*/executable/index.ts` 的 `methods:` 表迁移到同 object 的 readable.ts（或 readable.ts 旁边的 readable-methods.ts）。
3. WindowManager.submit/exec 时增加执行环境隔离：展示控制 method 的 ctx 不含 Object 引用、不含 reportStateEdit/reportContextEdit（只有 window 级变更）。

### 三、对 executable 内部结构的影响

1. `executable/windows/_shared/viewport.ts` 中的 `Viewport` 类型、`applyViewport` 纯函数，按原批次 C3 迁到 `_shared/types/viewport.ts` 和 `_shared/utils/viewport.ts`。**这个迁移不受影响**——viewport 仍然是 ContextWindow 的字段，不管 method 在哪声明。
2. `executable/windows/_shared/transcript-viewport.ts` 同理。
3. **`executeWindowSetViewport`（viewport.ts:144）和 `executeWindowSetTranscriptViewport`（transcript-viewport.ts:175）** 这两个函数目前是 ObjectMethod.exec 里的 helper，迁移后它们仍然是纯 window mutator——只是调用方从 executable/windows/* 的 ObjectMethod.exec 变成 readable 层注册的展示控制 method。它们仍留在 executable（它们改 ctx.self 是 WindowManager 的事）。
4. 本次澄清**不改变 executable/program/ 保留的决策**（用户明确指示）。program 的 `exec` method（真正跑 shell/ts 代码）属于 Object method，与展示控制的 `set_history_window` 是两回事。

---

> 本方案对应总纲 `docs/refactor_0604/README.md` 的 A/B/C/D 批次。各批次可独立推进，依赖关系已在对应行动中注明。

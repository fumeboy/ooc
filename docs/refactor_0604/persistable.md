# persistable 模块自审方案

> 第一人称：persistable（持久化能力维度）
> 对齐总纲：`docs/refactor_0604/README.md` 批次 E + 批次 A 的 A2/A10

---

## 1. 我是谁

我是 **OOC 8 维度中的 persistable（持久化能力）**。我的职责是把 OOC 的运行时状态落到磁盘上，并从磁盘恢复。纯正的我只做三件事：

1. **路径构造**：根据 `StoneObjectRef` / `FlowObjectRef` / `PoolObjectRef` / `ThreadPersistenceRef` 计算磁盘绝对路径。
2. **纯 IO**：JSON/CSV/Markdown/TSX 文件的读写（含 ENOENT 静默、JSON parse fail-loud、串行写队列）。
3. **持久化数据的 backward-compat 迁移**：thread.json、context.json 等历史格式的读时迁移。

**不属于我的事**：git CLI 封装、metaprog 工作流编排、权限校验、业务字符串正则、上下文重建逻辑。

我对应 meta/object.doc.ts 中 `persistable` 节点——stones（设计层 + git review）、flows（运行层 ephemeral）、pools（事实层长期积累）三分的磁盘锚点。

---

## 2. 我有什么（符号全景）

按功能分组列出所有源文件与导出符号。

### stones 相关

| 文件 | 导出符号 | 一句话说明 |
|------|---------|-----------|
| `persistable/common.ts` | `FlowObjectRef` (type) | flow object 磁盘定位三元组 `{baseDir, sessionId, objectId}` |
| | `ThreadPersistenceRef` (type) | thread 级磁盘定位，扩展 FlowObjectRef 加 `threadId` |
| | `StoneObjectRef` (type) | stone 磁盘定位 `{baseDir, objectId, _stonesBranch?}` |
| | `STONE_CHILDREN_SUBDIR = "children"` | B-tree 嵌套 marker，stone/flow/pool 共用 |
| | `STONE_OBJECTS_SUBDIR = "objects"` | **deprecated**，2026-06-01 bun workspace 迁移后已不用 |
| | `BUILTIN_OBJECT_IDS` (Set) | 内置 Object id 集合（supervisor/user） |
| | `nestedObjectPath(id)` | 把 `"a/b/c"` 翻译成 `["a","children","b","children","c"]` |
| | `objectDir(ref)` | 计算 flow object 目录绝对路径 |
| | `threadDir(ref)` | 计算 thread 目录绝对路径（flow object + `threads/<tid>`） |
| | `stoneDir(ref)` | 计算 stone 目录（含 worktree routing / builtin routing / flat layout / packages fallback 四路） |
| | `resolveStoneDir(ref)` | 异步多路径 fallback 解析现存 stone 目录 |
| | `_deprecatedPackageDir(ref)` | deprecated packages/ 布局路径计算 |
| | `isBuiltinObjectId(id)` | 判断 objectId 是否指向 Builtin Object |
| | `deriveStoneFromThread(ref)` | 从 ThreadPersistenceRef 派生 StoneObjectRef |
| | `toJson(value)` | 统一 JSON 序列化（2 空格缩进 + 末尾换行） |
| `persistable/stone-object.ts` | `executableDir(ref)` | stone executable/ 目录路径（原 server/） |
| | `visibleDir(ref)` | stone visible/ 目录路径（原 client/） |
| | `stoneKnowledgeDir(ref)` | stone knowledge/ 目录（seed knowledge，进 git） |
| | `stoneChildrenDir(ref)` | stone children/ 目录（B-tree marker） |
| | `ancestorObjectIds(id)` | 嵌套 objectId 的祖先 id 列表（知识继承链） |
| | `discoverStoneHierarchicalPeers(ref)` | 扫描同级 siblings 与直接子级 children peers |
| | `createStoneObject(ref)` | 创建 stone 最小骨架（package.json + 空 self.md + 空 readable.md） |
| | `stoneDir(ref)` (re-export) | 从 common 重导出 |
| `persistable/stone-self.ts` | `selfFile(ref)` | stone self.md 路径 |
| | `readSelf(ref)` | 读取 self.md，ENOENT 返回 undefined |
| | `writeSelf(ref, text)` | 写入 self.md |
| `persistable/stone-readme.ts` | `readableFile(ref)` | stone readable.md 路径（原 readme.md） |
| | `readableTsFile(ref)` | stone readable.ts 动态渲染函数路径 |
| | `readReadable(ref)` | 读取 readable.md，fallback 到 legacy readme.md |
| | `writeReadable(ref, text)` | 写入 readable.md |
| `persistable/stone-server.ts` | `executableIndexFile(ref)` | stone executable/index.ts 路径 |
| | `readExecutableSource(ref)` | 读取 executable/index.ts，fallback 到 legacy server/ |
| | `writeExecutableSource(ref, code)` | 写入 executable/index.ts，自动 mkdir |
| `persistable/stone-client.ts` | `visibleIndexFile(ref)` | stone visible/index.tsx 路径 |
| | `flowClientPagesDir(ref)` | flow object client/pages/ 目录 |
| | `flowClientPageFile(ref, pageName)` | flow object 某 page tsx 路径（含 pageName 安全校验） |
| | `readVisibleSource(ref)` | 读取 stone visible/index.tsx，fallback 到 legacy client/ |
| | `writeVisibleSource(ref, code)` | 写入 stone visible/index.tsx |
| | `readFlowClientPage(ref, name)` | 读取 flow object 某 page tsx |
| | `writeFlowClientPage(ref, name, code)` | 写入 flow object 某 page tsx |
| `persistable/stone-skills.ts` | `SkillEntry` (type) | skill 索引项 `{name, description, skillFilePath, scope}` |
| | `branchSkillsDir(baseDir)` | workspace 级 skills 目录 `stones/@ooc/skills/` |
| | `objectSkillsDir(ref)` | object 级 skills 目录 `stones/<id>/skills/` |
| | `listBranchSkills(baseDir)` | 列出 workspace 级 skills（10s TTL 缓存） |
| | `listObjectSkills(ref)` | 列出 object 级 skills（10s TTL 缓存） |
| | `listExternalSkills(dir)` | 列出外部 skills 目录（10s TTL 缓存） |
| | `clearStoneSkillsCache()` | 清空 skills 缓存（测试钩子） |
| `persistable/stone-bootstrap.ts` | `STONES_MAIN_BRANCH = "main"` | stones git 主分支名常量 |
| | `EnsureStoneRepoResult` (type) | ensureStoneRepo 返回值 `{initialized, migrated, layout, bootstrapCommit?}` |
| | `ensureStoneRepo({baseDir})` | **git worktree bootstrap**：迁移旧布局、init bare repo、挂 main worktree |
| `persistable/stone-git.ts` | `GitResult<T>` (type) | git 命令统一返回 `{ok:true, value?}` / `{ok:false, code, stderr}` |
| | `GitErrorCode` (type) | 已知错误码集合（10 种） |
| | `CommitInput` (type) | gitCommit 参数 `{authorName, authorEmail, message, allowEmpty?}` |
| | `WorktreeAddInput` (type) | `{path, branch, baseRef}` |
| | `WorktreeEntry` (type) | `git worktree list` 解析结果 |
| | `isValidBranchName(value)` | branch/ref 名校验 |
| | `gitInit / gitCurrentBranch / gitHead / gitRevParse / gitStatus` | repo 基础命令薄封装 |
| | `gitDiffNames / gitDiffPatch` | diff/log 命令薄封装 |
| | `gitCommit / gitCommitAll` | commit 命令薄封装（per-call author 注入） |
| | `gitBranchCreate / gitBranchDelete` | branch 命令薄封装 |
| | `gitWorktreeAdd / gitWorktreeRemove / gitWorktreeList / gitWorktreePrune` | worktree 命令薄封装 |
| | `gitRebase / gitMergeFastForward / gitMergeBase / gitCheckout` | rebase/merge 命令薄封装 |
| | `gitArchiveBranch(branch)` | 把被 reject 的 branch 归档到 `refs/ooc/rejected/` |
| `persistable/stone-versioning.ts` | `SUPERVISOR_OBJECT_ID = "supervisor"` | 治理身份常量 |
| | `MetaprogWorktreeRef` (type) | metaprog worktree 定位 `{baseDir, objectId, branch, path, baseCommit}` |
| | `ScopeClass` (type) | `"self-scope" | "cross-scope"` |
| | `PrIssueDecision` (type) | `"merge" | "reject" | "request-changes"` |
| | `RollbackInput / RollbackResult` (types) | rollback 输入输出 |
| | `SupervisorCreateObjectInput / SupervisorCreateObjectResult` (types) | supervisor 创建新 Object 快捷路径 |
| | `TryMergeSelfResult` (type) | 6 种结果（merged/must-pr-issue/rebase-conflict/...） |
| | `RequestPrIssueResult` (type) | PR-Issue 请求结果 |
| | `ResolvePrIssueResult` (type) | PR-Issue 决议结果 |
| | `openMetaprogWorktree(input)` | 创建 metaprog worktree（分支命名 `metaprog/{id}/{token}`） |
| | `commitWorktree(input)` | 在 worktree 内 stage + commit |
| | `classifyWorktreeBranch(ref, authorId)` | 路径划界判定（self-scope vs cross-scope） |
| | `tryMergeSelf(ref, authorId)` | 自治区 ff merge：rebase → classify → ff（cross-scope 返回 must-pr-issue） |
| | `requestPrIssueReview(input)` | cross-scope 时创建 PR-Issue 给 Supervisor |
| | `resolvePrIssue(input)` | Supervisor 决议生效（merge/reject/request-changes） |
| | `rollback(input)` | Supervisor 署名回滚（persistable 层强制 supervisor-only 校验） |
| | `supervisorCreateObject(input)` | Supervisor 创建新 Object 快捷路径（绕过 PR-Issue 自审噪音） |
| | `pruneStaleWorktrees(baseDir)` | 启动 hygiene：清 stale worktree admin 记录 |
| `persistable/versioned-write.ts` | `VersionedStoneWriteInput` (type) | 输入：`{baseDir, authorObjectId, intent, write(ctx)}` |
| | `VersionedWriteContext` (type) | write callback 上下文 `{path, baseDir, branch}` |
| | `VersionedWriteOk / VersionedWriteErr` (types) | 成功/失败返回 |
| | `versionedStoneWrite(input)` | 把一次写 stone 包进完整 versioning 流程（4 步编排） |

### flows 相关

| 文件 | 导出符号 | 一句话说明 |
|------|---------|-----------|
| `persistable/flow-object.ts` | `FlowSessionMetadata` (type) | `.session.json` 内容 `{type:"flow-session", sessionId, title}` |
| | `FlowObjectMetadata` (type) | `.flow.json` 内容 `{type:"flow-object", sessionId, objectId, class?}` |
| | `ClassNotFoundError` | P6 section 7 新增：createFlowObject 时 class 未注册抛出 |
| | `flowMetadataFile(ref)` | `.flow.json` 路径 |
| | `sessionDir(baseDir, sid)` | session 根目录 `flows/<sid>/` |
| | `sessionMetadataFile(baseDir, sid)` | `.session.json` 路径 |
| | `createFlowSession(baseDir, sid, title?)` | 创建 session 目录 + 写 `.session.json` |
| | `createFlowObject(ref, opts?, registry?)` | 创建 flow object 目录 + 写 `.flow.json`（含 class 校验） |
| `persistable/flow-data.ts` | `flowDataFile(ref)` | flow data.json 路径 |
| | `readData(ref)` | 读取 data.json，ENOENT 返回 `{}` |
| | `writeData(ref, data)` | 覆盖写入 data.json（串行化） |
| | `mergeData(ref, patch)` | 顶层 spread merge data.json（read-modify-write 串行化） |
| `persistable/flow-relation.ts` | `flowRelationsDir(ref)` | flow knowledge/relations/ 目录 |
| | `flowRelationFile(ref, peerId)` | `<peerId>.md` 路径 |
| | `readFlowRelation(ref, peerId)` | 读取 session-scoped relation |
| | `writeFlowRelation(ref, peerId, content)` | 写入 session-scoped relation |
| `persistable/flow-runtime-object.ts` | `runtimeObjectStateFile(ref)` | flow runtime object state.json 路径 |
| | `writeRuntimeObjectState(ref, state)` | 写 state.json（strip contextWindows 字段，串行化） |
| | `readRuntimeObjectState(ref)` | 读 state.json，ENOENT 返回 undefined |
| | `deleteRuntimeObject(ref)` | 删除 runtime object 整个目录（幂等） |
| | `createRuntimeObject(ref, state)` | 创建 runtime object（当前等价 writeRuntimeObjectState） |
| `persistable/flow-context-registry.ts` | `ContextRegistry` (type) | `{version:1, members: ContextMember[]}` |
| | `ContextMember` (type) | `{objectId, params: ContextParams}` |
| | `ContextParams` (type) | `{compressLevel?, decayMeta?, order?, parentObjectId?}` |
| | `EMPTY_REGISTRY` | 默认空 registry |
| | `contextRegistryFile(ref)` | thread context.json 路径（legacy P5'.1） |
| | `readContextRegistry(ref)` | 读 registry，ENOENT 返回 EMPTY_REGISTRY |
| | `writeContextRegistry(ref, registry)` | 整体写 registry（串行化） |
| `persistable/flow-thread-context.ts` | `ThreadContextEntry` (type) | inline ContextWindow 或轻量 ref `{id, type, _ref:true, refObjectId}` |
| | `ThreadContextFile` (type) | `{threadId, contextWindows: ThreadContextEntry[]}` |
| | `ThreadContextRef` (type) | ThreadPersistenceRef 的别名 |
| | `threadContextFile(ref)` | thread-context.json 路径（P6 section 6 权威路径） |
| | `writeThreadContext(ref, entries)` | 写 thread contextWindows（串行化） |
| | `readThreadContext(ref)` | 读 thread contextWindows，ENOENT 返回 null |

### pools 相关

| 文件 | 导出符号 | 一句话说明 |
|------|---------|-----------|
| `persistable/pool-object.ts` | `PoolObjectRef` (type) | pool 磁盘定位 `{baseDir, objectId}` |
| | `PoolObjectMetadata` (type) | `.pool.json` 内容 `{type:"pool", objectId}` |
| | `POOL_OBJECTS_SUBDIR = "objects"` | **deprecated**，pools 不再有 objects/ 中间层 |
| | `poolDir(ref)` | pool 目录路径（children/ 嵌套，与 stone/flow 对齐） |
| | `poolMetadataFile(ref)` | `.pool.json` 路径 |
| | `poolKnowledgeDir(ref)` | pool knowledge/ 目录 |
| | `poolKnowledgeMemoryDir(ref)` | pool knowledge/memory/（reflectable 长期记忆） |
| | `poolKnowledgeRelationsDir(ref)` | pool knowledge/relations/（跨 session relation） |
| | `poolKnowledgeRelationFile(ref, peerId)` | `<peerId>.md` 路径 |
| | `poolFilesDir(ref)` | pool files/ 目录 |
| | `poolDataDir(ref)` | pool data/ 目录（csv 表根） |
| | `poolDataFile(ref, name)` | 某 csv 表路径（含 kebab-case 名校验） |
| | `readPoolRelation(ref, peerId)` | 读取 pool relation |
| | `createPoolObject(ref)` | 创建 pool 骨架（data/ + knowledge/{memory,relations}/ + files/ + .pool.json） |
| | `derivePoolFromThread(ref)` | 从 ThreadPersistenceRef 派生 PoolObjectRef |
| `persistable/csv-pool.ts` | `readCsv<T>(ref, name)` | 读整张 csv 为对象数组，ENOENT 返回 `[]` |
| | `writeCsv<T>(ref, name, rows)` | 覆盖写 csv（write-then-rename 原子写 + 串行化） |
| | `appendRow<T>(ref, name, row)` | 追加一行（read-modify-write + 原子 rename + 串行化） |
| | （内部）`parseCsv / stringifyRow` | RFC 4180 子集 CSV 编解码，~100 行 |

### thread 相关

| 文件 | 导出符号 | 一句话说明 |
|------|---------|-----------|
| `persistable/thread-json.ts` | `threadFile(ref)` | thread.json 路径 |
| | `writeThread(thread)` | 剥离 volatile 字段后写 thread.json |
| | `readThread(ref, tid, registry?)` | **263 行超大函数**：读 thread.json + context 重建 + 3 层 backward-compat（thread-context.json → registry → legacy windows） + 迁移（command_exec→method_exec、executed→failed） + unregistered type filter |
| | （内部）`stripVolatileForPersist(thread)` | 剥离 intentCache / zero compressLevel / effectiveVisibleType |

### debug

| 文件 | 导出符号 | 一句话说明 |
|------|---------|-----------|
| `persistable/debug-file.ts` | `ContextSnapshot` (type) | LLM 调用时刻的 thread 结构化快照 |
| | `LlmInputDebugRecord` (type) | `{threadId, inputItems, contextSnapshot?}` |
| | `LlmOutputDebugRecord` (type) | `{threadId, outputItems, provider?, model?}` |
| | `LlmLoopDebugMetaRecord` (type) | 单轮 loop 元数据（耗时/token/windowsSnapshot 等 13 字段） |
| | `captureContextSnapshot(thread, registry?)` | 从 thread 抽取快照（含 effectiveVisibleType enrichment） |
| | `normalizeInputItems(items)` | 兼容旧 `LlmMessage[]` 到 `LlmInputItem[]` |
| | `deriveOutputItems(result)` | 从 LlmGenerateResult 投影 output items |
| | `llmInputFile / llmOutputFile(ref)` | 最新一轮 LLM 输入/输出 debug 文件路径 |
| | `loopInputFile / loopOutputFile / loopMetaFile(ref, idx)` | 第 N 轮 LLM 输入/输出/元数据 debug 文件路径 |
| | `writeDebugInput / writeDebugOutput(ref, record)` | 写最新一轮 debug |
| | `writeLoopDebugInput / writeLoopDebugOutput / writeLoopDebugMeta(ref, idx, record)` | 写单轮 debug |
| | `readLoopDebugMeta(ref, idx)` | 读单轮 loop meta（失败返回 undefined） |

### pr-issue

| 文件 | 导出符号 | 一句话说明 |
|------|---------|-----------|
| `persistable/pr-issue.ts` | `PR_ISSUE_SESSION_ID = "super"` | PR-Issue 落盘的固定 session id |
| | `PrIssuePayload` (type) | `{intent, branch, diff, paths, baseSha}` |
| | `PrIssueRecord` (type) | 完整 PR-Issue 记录（含 prPayload） |
| | `PrIssueIndex` (type) | `{nextId, issues: PrIssueIndexEntry[]}` |
| | `PrIssueIndexEntry` (type) | 索引摘要（id/title/status/时间戳/创建者） |
| | `CreatePrIssueInput` (type) | 创建 PR-Issue 输入 |
| | `CreateRecoveryIssueInput` (type) | 创建 recovery-needed issue 输入 |
| | `createPrIssue(input)` | 在 flows/super/issues/ 创建 PR-Issue（串行化 + author 存在性校验 + payload 校验） |
| | `createRecoveryIssue(input)` | 创建无 prPayload 的 recovery-needed issue |
| | `closePrIssue({baseDir, issueId})` | 关闭 issue（idempotent） |
| | `readPrIssue(baseDir, id)` | 读取单条 issue |
| | `readPrIssueIndex(baseDir)` | 读取 issue 索引 |

### 杂项

| 文件 | 导出符号 | 一句话说明 |
|------|---------|-----------|
| `persistable/serial-queue.ts` | `SerialQueue` (type re-export) | **deprecated** wrapper，逻辑已委托到 `runtime/serial-queue` |
| | `createSerialQueue` (re-export) | 同上 |
| | `enqueueSessionWrite(key, task)` | module-level wrapper：delegate 到 `defaultSerialQueue.enqueue` |
| | `__resetSerialQueueForTests()` | 清空所有队列（测试钩子） |
| `persistable/mention.ts` | `parseMentions(text)` | 纯字符串正则：从文本中抽取 `@objectId` 列表（去重保序） |
| `persistable/world-config.ts` | `WorldConfig` (type) | `{siteName, externalSkillsDir?, larkTenantHost, larkAppId?, larkAppSecret?, workerMaxTicks?}` |
| | `DEFAULT_SITE_NAME` | 默认站名 "Oriented Object Context" |
| | `DEFAULT_LARK_TENANT_HOST` | 默认飞书租户 "feishu.cn" |
| | `WORLD_CONFIG_FILENAME = ".world.json"` | 配置文件名 |
| | `readWorldConfig(baseDir)` | 读 `.world.json`（10s TTL 缓存 + 大小写兼容 + 永不抛错） |
| | `clearWorldConfigCache()` | 清空缓存（测试钩子） |
| `persistable/index.ts` | （全量 barrel re-export） | persistable 对外 API 面 |

---

## 3. 哪些不属于我 / 哪些我做得不好

锚定文件与行号。

### 3.1 越权：metaprog 工作流编排（应迁 programmable/）

- **`persistable/stone-versioning.ts`（~900 行）**：这是 metaprog 全流程编排——开 worktree、commit、scope 分类、self-merge、PR-Issue 请求/决议、rollback、GC。核心是 git 工作流决策（selfScopePrefix 路径划界算法、supervisor-only 权限校验、extractObjectIdsFromPaths 对象提取、tryMergeSelf 四步编排），与"持久化"仅弱相关。持久化只是它副作用之一。

  证据：`stone-versioning.ts:57-59` 依赖 `stone-git`、`pr-issue`、`serial-queue`——全是 git + 协作工具，不是 IO。`stone-versioning.ts:136-138` 的 `selfScopePrefix` 是自治区边界算法，属于可编程治理层。

- **`persistable/stone-git.ts`（381 行）**：git CLI 薄包装。Bun.spawnSync 调用 git 命令、错误码映射、worktree 输出解析——这是"可编程层的基础设施"，跟持久化无关。持久化不应该懂 worktree、rebase、ff-merge。

- **`persistable/stone-bootstrap.ts`（365 行）**：bare repo 初始化 + flat→main 布局迁移 + worktree 挂载。这是 stone versioning 系统的启动初始化，跟"读写文件"是两个概念。

- **`persistable/versioned-write.ts`（153 行）**：把写文件包装进 versioning 流程的 4 步编排器。属于 programmable 层 facade，不是 IO。

### 3.2 越权：纯数据转换与字符串处理（应迁 _shared/utils/）

- **`persistable/mention.ts`（27 行）**：`parseMentions` 是纯正则字符串处理，不碰磁盘。放在 persistable 唯一原因是历史上它被 PR-Issue comment 流使用（已被移除）。

- **`persistable/csv-pool.ts` 中的 `parseCsv` / `stringifyRow`（~100 行，L28-L126）**：RFC 4180 子集 CSV 编解码是纯函数。IO wrapper（readCsv/writeCsv/appendRow）才属于 persistable。

### 3.3 越权：context 重建业务逻辑（应迁 thinkable/ 或 executable/）

- **`persistable/thread-json.ts:68-262`** 共约 195 行：`readThread` 函数承担了 3 层 context 重建逻辑：
  - L134-L197：thread-context.json 命中路径（P6 section 6），含 inline/ref entry 分派、state.json hydrate、type registry 校验、seenIds 去重合并
  - L202-L252：legacy contextRegistry 路径（P5'.1），含按 order 排序、state.json hydrate、registry params 到 ContextWindow 字段投影
  - L102-L116：Round 13 + Phase H 数据迁移（command_exec→method_exec、executed→failed）
  - L81-L96：unregistered type filter + console.warn

  这些都不是"IO"——是 thinkable/context 的恢复逻辑。IO 部分只占 `readThread` 的 3 行（L74-L76 读 JSON parse）。

- 相关反向 import：`thread-json.ts:4` import `ThreadContext` from `../thinkable/context`，`:5` import `initContextWindows` from `../executable/windows/_shared/init`，`:6-7` import ObjectRegistry + builtinRegistry from executable，`:11` import ContextWindow type from executable。

### 3.4 反向 import（持久化层不该 import 业务层）

总纲 DAG 规定 persistable 只依赖 _shared 层。当前我反向 import 了 executable / thinkable / observable / runtime：

| 文件 | 反向 import | 说明 |
|------|------------|------|
| `flow-object.ts:4-5` | `ObjectRegistry` type + `builtinRegistry` (executable) | createFlowObject 的 class 校验 |
| `flow-runtime-object.ts:22` | `ContextObject` type (executable) | state.json 类型 |
| `flow-thread-context.ts:28` | `ContextWindow` type (executable) | ThreadContextEntry 类型 |
| `debug-file.ts:4-9` | `LlmGenerateResult/InputItem` (thinkable) + `ThreadContext/ProcessEvent/ThreadMessage` (thinkable) + `ContextWindow/ObjectRegistry` (executable) + `builtinRegistry` (executable) + `WindowSnapshotEntry` (observable) | debug 快照的类型定义 + enrichment |
| `stone-skills.ts:4` | `parseKnowledgeFile` (thinkable/knowledge/parser) | skill SKILL.md frontmatter 解析 |
| `thread-json.ts:4-11` | thinkable + executable（6 个符号） | context 重建需要 |
| `serial-queue.ts:13` | `runtime/serial-queue` | deprecated wrapper |

### 3.5 "objects" 字符串硬编码 10+ 处

总纲 A10 指出 `STONE_OBJECTS_SUBDIR` 常量统一替换。在 persistable 源文件中非测试代码中 `"objects"` / `"objects/"` 硬编码至少 10+ 处：

- `common.ts:99,110,129,181,208`（注释 + worktree layout 路径）
- `stone-bootstrap.ts:80,315`（`stones/main/objects` 路径 + `git add objects/`）
- `stone-versioning.ts:137,147,164,165,684`（selfScopePrefix 拼接、sync 路径、extractObjectIdsFromPaths、rollback checkout 路径）
- `pool-object.ts:8,46`（注释 + deprecated 常量）
- `csv-pool.ts:5`（注释路径）
- `stone-object.ts:30`（注释）

这些大多在 versioning 路径（迁 programmable/ 后由 programmable 统一常量管理），但 canonical flat layout 确实没有 `objects/` 中间层——硬编码主要存在于 versioning worktree 语义中。

### 3.6 过期 backward-compat（应删）

- **`persistable/common.ts:49`** `STONE_OBJECTS_SUBDIR = "objects"` — deprecated 常量，bun workspace 迁移后不再使用。
- **`persistable/common.ts:164-174`** `_deprecatedPackageDir()` + `resolveStoneDir` 的 packages/ fallback 路径（2026-06-03 M2 说明"过渡期至少一个 release"）。
- **`persistable/stone-readme.ts:29-36`** `readReadable` fallback 到 legacy `readme.md`（2026-05-28 改名）。
- **`persistable/stone-server.ts:24-29`** `readExecutableSource` fallback 到 legacy `server/`（2026-05-28 改名）。
- **`persistable/stone-client.ts:43-45`** `readVisibleSource` fallback 到 legacy `client/`（2026-05-28 改名）。
- **`persistable/thread-json.ts:102-116`** `command_exec → method_exec` + `status: "executed" → "failed"` 迁移（Phase H + Round 13，已超过一个月）。
- **`persistable/flow-context-registry.ts` 全文件**：P5'.1 的 legacy registry，P6 section 6 已被 `flow-thread-context.ts` 替代。双写阶段应在 section 10 cleanup 阶段整体删除。
- **`persistable/pool-object.ts:46`** `POOL_OBJECTS_SUBDIR = "objects"` deprecated 常量。

### 3.7 其他问题

- **`persistable/stone-versioning.ts:683-684`** rollback 中 `git checkout {target} -- objects/${objectId}/` 直接拼字符串路径，没有用 `nestedObjectPath` 做嵌套翻译——嵌套 Object 的 rollback 可能路径错误。
- **`persistable/index.ts`** barrel re-export 了 ~80 个符号，其中约 1/3 属于 programmable（迁走后 index.ts 需要重写）。
- **`persistable/debug-file.ts:captureContextSnapshot`**（L43-L65）做了 `resolveEffectiveVisibleType` enrichment——这是 executable registry 的业务逻辑，不是 IO 层该做的。debug 快照应该直接从 thread 取数据，不做 enrichment。
- **`persistable/stone-skills.ts`** 的 10s TTL 缓存 + `parseKnowledgeFile` 调用——skills 扫描是业务语义（SKILL.md frontmatter），不是纯 IO。IO 层只应该返回文件路径列表，frontmatter 解析在上层。

---

## 4. 理想的我

### 4.1 目录结构

迁出 programmable/ 和 _shared/utils/ 后，persistable 的理想形态：

```
persistable/
├── index.ts                  # barrel（~30 个符号，砍掉 versioning 族）
├── common.ts                 # Ref 类型 + 路径计算 + toJson（保持）
├── serial-queue.ts           # 删除（deprecated，见 A2）
│
├── stone/                    # NEW: stone IO 子目录
│   ├── object.ts             # createStoneObject + dir helpers（原 stone-object.ts）
│   ├── self.ts               # self.md 读写（原 stone-self.ts）
│   ├── readable.ts           # readable.md / readable.ts 读写（原 stone-readme.ts，去掉 legacy fallback）
│   ├── executable.ts         # executable/index.ts 读写（原 stone-server.ts，去掉 legacy fallback）
│   ├── visible.ts            # visible/index.tsx + flow client pages 读写（原 stone-client.ts，去掉 legacy fallback）
│   └── skills.ts             # skills 目录扫描 IO（去掉 parseKnowledgeFile 调用，返回文件路径 raw 列表）
│
├── flow/                     # NEW: flow IO 子目录
│   ├── object.ts             # createFlowObject/Session + metadata（原 flow-object.ts，去掉 registry import）
│   ├── data.ts               # data.json 读写（原 flow-data.ts，保持）
│   ├── relation.ts           # relation md 读写（原 flow-relation.ts，保持）
│   ├── runtime-object.ts     # state.json CRUD（原 flow-runtime-object.ts，ContextObject 改从 _shared/types 导入）
│   ├── context-registry.ts   # legacy P5'.1，标记删除（section 10 cleanup 阶段）
│   └── thread-context.ts     # thread-context.json IO（ThreadContextEntry 改从 _shared/types 导入）
│
├── pool/                     # NEW: pool IO 子目录
│   ├── object.ts             # pool 骨架创建 + dir helpers（原 pool-object.ts，去掉 deprecated 常量）
│   └── csv.ts                # csv IO wrapper（原 csv-pool.ts，parser 迁 _shared/utils/csv.ts）
│
├── thread/                   # NEW: thread IO 子目录
│   ├── io.ts                 # 纯 IO：threadFile + writeThread（含 stripVolatile）+ 裸 JSON read
│   └── migrate.ts            # 数据迁移：command_exec->method_exec 等（逐步删减）
│                               # 注：context 重建逻辑整体迁 thinkable/context/rehydrate.ts
│
├── debug/                    # NEW: debug IO 子目录
│   ├── files.ts              # debug 文件路径 + writeDebugXxx / writeLoopDebugXxx
│   └── snapshot.ts           # captureContextSnapshot（enrichment 去掉，类型从 _shared/types 导入）
│
├── pr-issue/                 # NEW: pr-issue IO 子目录
│   └── index.ts              # PR-Issue 读写 + 索引（保持，author 校验抽 service 层）
│
└── world-config.ts           # 保留（属于 world-level IO 配置）
```

### 4.2 迁出到 programmable/（新建）

| 文件 | 目标路径 | 说明 |
|------|---------|------|
| `stone-git.ts` | `programmable/git.ts` | git CLI 薄包装 |
| `stone-bootstrap.ts` | `programmable/bootstrap.ts` | stones bare repo + worktree 初始化 |
| `stone-versioning.ts` | `programmable/versioning.ts` | metaprog 工作流全编排 |
| `versioned-write.ts` | `programmable/versioned-write.ts` | versioned write 4 步 facade |

programmable/ 作为独立模块，import persistable（做 IO）、import runtime（serial-queue）、依赖方向正确。

### 4.3 迁出到 _shared/utils/（新建）

| 内容 | 目标路径 | 说明 |
|------|---------|------|
| `parseMentions` | `_shared/utils/mention.ts` | 纯字符串正则 |
| `parseCsv` / `stringifyRow` | `_shared/utils/csv.ts` | RFC 4180 CSV 编解码纯函数 |

### 4.4 迁出到 thinkable/context/

| 内容 | 目标路径 | 说明 |
|------|---------|------|
| `readThread` 的 195 行 context 重建逻辑 | `thinkable/context/rehydrate.ts` | 3 层 backward-compat + registry + hydrate |

persistable/thread/io.ts 只暴露：
- `writeThread(thread)` — 同现状
- `readThreadRaw(ref)` — 只读 JSON parse，返回 `ThreadContext | undefined`，不含任何重建

thinkable/context/rehydrate.ts 负责把 raw thread + registry + state.json + thread-context.json 合成 in-memory ThreadContext。

### 4.5 约束

- 所有 import 只能来自：`node:*`、`_shared/types/*`、`_shared/utils/*`（不再反向 import thinkable/executable/observable/runtime）。
- 所有路径常量集中化：`STONE_CHILDREN_SUBDIR`、`THREADS_SUBDIR`、`KNOWLEDGE_SUBDIR` 等在 `common.ts` 统一定义。
- "objects/" 仅在 programmable/ 中作为 versioning worktree 常量存在；persistable 侧删除所有硬编码。

---

## 5. 我的优化方案（分批次）

对齐总纲：批次 A（A2、A10）+ 批次 E（E1-E6）。

### 批次 A：死代码删除 + 轻量修复（<= 半天，可独立执行）

| # | 行动 | 影响范围 | 验收 |
|---|------|---------|------|
| A2 | 删除 `persistable/serial-queue.ts`，所有调用方（flow-data.ts、flow-runtime-object.ts、flow-context-registry.ts、flow-thread-context.ts、csv-pool.ts、pr-issue.ts、stone-versioning.ts）改直接 import `runtime/serial-queue` 的 `defaultSerialQueue.enqueue` | 1 文件删除 + 8 个文件改 import | `bun tsc --noEmit` 通过，`bun test persistable` 全绿 |
| A10a | 在 `persistable/common.ts` 新增 `VERSIONING_OBJECTS_SUBDIR = "objects"` 常量（语义上它是 programmable 版本化 worktree 的内部路径，不是 persistable canonical 路径），替换 persistable 内所有 `"objects"` 硬编码 | common.ts + stone-bootstrap.ts + stone-versioning.ts + pool-object.ts(注释) | grep 不再命中裸 `"objects"` 字符串（注释除外） |
| A10b | 修复 `stone-versioning.ts:683-684` rollback 路径：`objects/${input.objectId}/` -> `objects/${nestedObjectPath(input.objectId).join("/")}/`（嵌套 objectId 场景） | stone-versioning.ts 2 行 | 写一个 nested object rollback 单测 |

### 批次 E1：programmable/ 模块拆分（1 天，独立于其他 persistable 改动）

| # | 行动 | 影响范围 | 验收 |
|---|------|---------|------|
| E1.1 | 新建 `packages/@ooc/core/programmable/` 包骨架（package.json + index.ts） | +2 文件 | bun workspace 识别 |
| E1.2 | 迁移 `stone-git.ts` -> `programmable/git.ts`：更新 import 路径，persistable 侧加 re-export shim（保持对外 API） | +1/-1 文件，persistable/index.ts 加 re-export | `bun tsc --noEmit` + 原 stone-git.test.ts 全绿 |
| E1.3 | 迁移 `stone-bootstrap.ts` -> `programmable/bootstrap.ts`：同上 re-export | +1/-1 文件 | stone-bootstrap.test.ts（如有）全绿 |
| E1.4 | 迁移 `stone-versioning.ts` -> `programmable/versioning.ts`：它内部 import stone-git 路径更新；persistable 侧 re-export | +1/-1 文件 | persistable/__tests__/stone-versioning.test.ts 全绿 |
| E1.5 | 迁移 `versioned-write.ts` -> `programmable/versioned-write.ts`：同上 | +1/-1 文件 | 相关测试全绿 |
| E1.6 | persistable/index.ts 中 stone-git / bootstrap / versioning / versioned-write 的导出改为从 programmable re-export；**保留符号名不变**（调用方零改动） | persistable/index.ts | grep 全项目：无调用方需要改 import |

### 批次 E2-E3：_shared/utils 抽取（<= 半天，可独立）

| # | 行动 | 影响范围 | 验收 |
|---|------|---------|------|
| E2 | `persistable/mention.ts` -> `_shared/utils/mention.ts`：迁移 `parseMentions`。persistable 侧删除 mention.ts，调用方（检查谁 import parseMentions——如果是 persistable 内部用，改为从 _shared 导入；如果是外部用，persistable/index.ts 暂时 re-export 或调用方直接改路径） | +1/-1 文件 | tsc 通过 |
| E3.1 | 新建 `_shared/utils/csv.ts`：导出 `parseCsv(text): string[][]` 和 `stringifyCsvRow(fields: string[]): string`（从 csv-pool.ts L28-L126 迁出） | +1 文件 | 单元测试（新建）覆盖转义/CRLF/空文件 |
| E3.2 | `persistable/csv-pool.ts` 改为 import `_shared/utils/csv`，删除内部 parser 实现，只保留 IO wrapper（readCsv/writeCsv/appendRow） | csv-pool.ts 从 ~274 行缩到 ~170 行 | persistable/__tests__/csv-pool.test.ts 全绿 |

### 批次 E4：thread-json 拆分（1 天，依赖批次 C 的 _shared/types 就绪）

| # | 行动 | 影响范围 | 验收 |
|---|------|---------|------|
| E4.1 | 新建 `persistable/thread/io.ts`：从 thread-json.ts 抽出 `threadFile`、`stripVolatileForPersist`、`writeThread`、`readThreadRaw`（只读 JSON parse + ThreadPersistenceRef 挂回 + unregistered type filter 去掉——filter 是业务逻辑） | +1 文件 | tsc 通过 |
| E4.2 | **若批次 C 已完成**（ThreadContext/ContextWindow/ObjectRegistry 已在 _shared/types）：新建 `thinkable/context/rehydrate.ts`，迁移 `readThread` 的 context 重建逻辑（L68-L262，195 行）。对外暴露 `rehydrateThread(rawThread, ref, registry)`。 | thinkable 新增 1 文件，persistable/thread-json.ts 删 195 行 | 相关 thread reload 测试全绿 |
| E4.3 | 若批次 C 未完成：先做"最小拆分"——`readThread` 留在 persistable 但内部调 `readThreadRaw`，后续批次 C 后再迁。确保反向 import 数量不增加 | thread-json.ts 瘦身到 ~80 行 | tsc 通过 |

### 批次 E5-E6：过期 backward-compat 清理（<= 半天，**需先确认测试数据已更新**）

| # | 行动 | 影响范围 | 验收 |
|---|------|---------|------|
| E5.1 | 删除 `thread-json.ts:102-116` 的 `command_exec -> method_exec` + `status:"executed" -> "failed"` 迁移 | thread-json.ts -15 行 | `.ooc-world/` 下无旧格式 thread.json，或已有迁移脚本；相关测试全绿 |
| E5.2 | 删除 `STONE_OBJECTS_SUBDIR` 常量（common.ts:49）+ `POOL_OBJECTS_SUBDIR` 常量（pool-object.ts:46） | 2 文件 | tsc 通过（确保 VERSIONING_OBJECTS_SUBDIR 已覆盖 programmable 需求） |
| E6.1 | 删除 `_deprecatedPackageDir()` + `resolveStoneDir` 的 packages/ fallback（common.ts:164-243 的第 3 步 + `_deprecatedPackageDir` 函数） | common.ts -40 行 | 所有 stones 已迁到 stones/ flat layout，`.ooc-world/` 下无 packages/ 布局 |
| E6.2 | 删除 3 个 legacy 双读 fallback：`stone-readme.ts` readme.md -> readable.md、`stone-server.ts` server/ -> executable/、`stone-client.ts` client/ -> visible/ | 3 文件各 -6~10 行 | 所有 builtins + 测试 stones 已用新命名；tsc + test 全绿 |
| E6.3 | 标记 `flow-context-registry.ts` 为 deprecated（P5'.1 -> P6 section 6 已被 thread-context.json 取代），section 10 cleanup 阶段整体删除 | 加 JSDoc @deprecated | 无新增调用方 |

### 批次 E7：子目录化 + 反向 import 清理（1 天，**依赖批次 C 的 _shared/types 就绪**）

| # | 行动 | 影响范围 | 验收 |
|---|------|---------|------|
| E7.1 | 按 section 4.1 结构创建 `stone/`、`flow/`、`pool/`、`thread/`、`debug/`、`pr-issue/` 子目录，文件改名迁移 | ~20 文件 restructured | persistable/index.ts barrel 全部从子目录 re-export；调用方零改动 |
| E7.2 | 类型从 `_shared/types` 导入，去掉 executable/thinkable/observable/runtime 的反向 import：`ContextObject`、`ContextWindow`、`ThreadContext`、`ProcessEvent`、`ObjectRegistry` type、`WindowSnapshotEntry`、`LlmGenerateResult` 等 | 约 8 个文件的 import 行改写 | tsc 通过；grep `from.*\.\./executable\|from.*\.\./thinkable\|from.*\.\./observable\|from.*\.\./runtime` 返回 0 条（serial-queue 除外，但 A2 已删） |
| E7.3 | `debug-file.ts:captureContextSnapshot` 去掉 `resolveEffectiveVisibleType` enrichment（改为在上层 thinkable/context 或 executable registry 调用方做 enrichment） | debug/snapshot.ts -8 行 | 相关 debug 测试需验证：如果前端依赖 effectiveVisibleType，则调用方在写 debug 前显式 enrich |
| E7.4 | `stone-skills.ts` 去掉 `parseKnowledgeFile` 调用，改为返回 `{name, skillFilePath, scope}` 的 raw 列表。description 解析移到上层（skill_index window 或 thinkable/knowledge/parser） | stone/skills.ts -6 行 | skill_index 渲染不依赖 description 的 fallback 逻辑验证 |

---

## 6. 我对其他模块的要求

### 6.1 对 `_shared/types`（批次 C）的要求

我需要以下类型尽早迁入 `_shared/types`，才能做 E7.2 的反向 import 清理：

| 类型 | 当前位置 | 用途 |
|------|---------|------|
| `ContextWindow` / `BaseContextWindow` / 所有子 window 类型 | executable/windows/_shared/types.ts | flow-thread-context.ts ThreadContextEntry、debug snapshot |
| `ContextObject` | executable/windows/_shared/types.ts | flow-runtime-object.ts state.json 类型 |
| `ThreadContext` / `ProcessEvent` / `ThreadMessage` | thinkable/context/index.ts | thread.json IO、debug snapshot |
| `ObjectRegistry` 接口 | executable/windows/_shared/registry.ts | createFlowObject、readThread、debug 的 registry 参数类型 |
| `Intent` / `FormChangeEvent` 等 | thinkable/context（分散） | ThreadContext 字段类型 |
| `LlmGenerateResult` / `LlmInputItem` / `LlmMessage` | thinkable/llm/types.ts | debug-file.ts LLM 输入输出快照类型 |
| `WindowSnapshotEntry` | observable/window-hash.ts | debug-file.ts loop meta windowsSnapshot |
| `KnowledgeFrontmatter` | thinkable/knowledge/parser.ts | stone-skills description 解析返回类型 |

**关键路径**：E7.2 完全阻塞在批次 C。如果批次 C 延后，我可以先做 E1（programmable 迁出，不涉及类型）、E2-E3（_shared/utils 纯函数抽取）、A2（删 serial-queue wrapper），这些不依赖 _shared/types。

### 6.2 对 `thinkable/context` 的要求

- 需要在 thinkable 侧新增 `rehydrateThread(raw, ref, registry)` API，承接 thread-json 的 195 行 context 重建。
- `initContextWindows` 目前在 `executable/windows/_shared/init`，应迁到 `_shared/utils` 或 thinkable，因为 persistable/thread-json 的 readThread 末尾调用了它（兜底补 creator do_window）。

### 6.3 对 `runtime/` 的要求

- `runtime/serial-queue` 的 `defaultSerialQueue` 导出需要保持稳定（A2 删除 persistable wrapper 后所有 IO 层直接 import 它）。
- 如后续 observable 并入 runtime（批次 F1），`window-hash.ts` 的 `WindowSnapshotEntry` 类型需跟随暴露给 _shared/types。

### 6.4 对 `app/server` 的要求

- `app/server/modules/stones/versioning-helper.ts` 目前 re-export persistable 的 versionedStoneWrite（persistable/index.ts:218-223）。E1 迁出 programmable 后，versioning-helper.ts 可以直接 import `programmable/versioned-write`，无需经 persistable 中转。但 persistable 侧的 re-export shim 会保留，所以 app/server 侧零改动即可。

### 6.5 对 `builtins` 的要求

- 无直接依赖。如果 builtins 侧有直接 import `persistable/stone-versioning` 等可编程符号，E1 后它们可以改为直接 import `programmable/*`（性能更好），但 persistable 的 re-export shim 保证零改动兼容。

### 6.6 对测试数据的要求

- 批次 E5/E6 删除 backward-compat 前，需确认 `.ooc-world/` 和所有测试 fixture 已迁移到新格式（readable.md 而非 readme.md、executable/ 而非 server/、method_exec 而非 command_exec、status: "failed" 而非 "executed"、stones/ flat layout 而非 packages/）。否则删除迁移后历史数据不可读。

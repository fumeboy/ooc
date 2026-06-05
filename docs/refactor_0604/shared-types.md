# _shared 中立共享类型包设计

> Refactor batch C (ooc-6) — 中立共享类型层建立
>
> 目标：终结 `thinkable` ↔ `executable` 双向耦合，抽出零依赖核心类型作为所有包的共同底座。
>
> 产出目录：`packages/@ooc/core/_shared/`

---

## 1. 我是谁（为什么需要我）

### 1.1 现状：双向耦合

当前 `@ooc/core` 内的 5 个一级子包（`thinkable` / `executable` / `persistable` / `runtime` / `extendable`）之间存在多处**双向 import** 和**类型定义散落**的问题：

**executable → thinkable（类型反向依赖）：**

| 文件 | import 目标 |
|------|-------------|
| `executable/windows/_shared/command-types.ts:13` | `thinkable/context` (ThreadContext) |
| `executable/windows/_shared/command-types.ts:14` | `thinkable/context/intent` (Intent, FormChangeEvent, MethodCallSchema) |
| `executable/windows/_shared/registry.ts:27` | `thinkable/context` (ThreadContext) |
| `executable/windows/_shared/registry.ts:28` | `thinkable/context/xml` (XmlNode) |
| `executable/windows/_shared/session-path.ts:27` | `thinkable/context` (ThreadContext) |
| `executable/windows/_shared/manager.ts:28-29` | `thinkable/context`, `thinkable/context/intent` |
| `executable/windows/_shared/init.ts:27` | `thinkable/context` (ThreadContext) |

**thinkable → executable（类型反向依赖）：**

| 文件 | import 目标 |
|------|-------------|
| `thinkable/context/index.ts:2` | `executable/windows/_shared/types` (ContextWindow) |

**persistable → thinkable + executable：**

| 文件 | import 目标 |
|------|-------------|
| `persistable/thread-json.ts` | `thinkable/context` (ThreadContext), `executable/windows/_shared/types` (ContextWindow) |
| `persistable/flow-thread-context.ts` | `thinkable/context` |

**runtime → 四向桥接：**

`runtime/object-registry.ts` 同时依赖 `executable` 类型、`thinkable` 类型、`persistable` 类型。

**builtins → core 多包 import：**

所有 10 个 `@ooc/builtins/*` 包分别从 `executable/windows/_shared/*`、`thinkable/context/*`、`persistable/*` 多个路径 import 同一份类型。

### 1.2 耦合后果

1. **构建/类型检查存在隐式环**：`thinkable` import `executable` 的类型，`executable` import `thinkable` 的类型。虽然 TS 的 `import type` 在编译期不会产生运行时环，但在**语义层面**形成了双向认知——两个包互相以为"对方拥有基础类型"，新人无法判断"类型 X 的 canonical source 到底在哪"。
2. **重复定义风险**：`Viewport` 同时出现在 `executable/windows/_shared/viewport.ts` 和 `extendable/_shared/viewport.ts`（后者仅是 re-export），`super-constants.ts` 在两处都有拷贝。未来容易出现"改了 A 处忘了 B 处"。
3. **builtins 包耦合 core 内部结构**：`@ooc/builtins/program` 直接 import `@ooc/core/thinkable/context`，这意味着 thinkable 目录结构变动会级联破坏 10+ 个 builtin 包。
4. **测试中类型 import 路径混乱**：同一个 `Intent` 类型，测试里既有人从 `thinkable/context/intent` 引，也有人从 `thinkable/context` re-export 引，也有人从 executable 的间接 re-export 引。

### 1.3 解

建立 **`@ooc/core/_shared`** 作为中立共享类型层：

- 所有"跨包被引用的纯类型 + 无副作用纯函数"收口到此处
- `thinkable` / `executable` / `persistable` / `runtime` / `extendable` / `builtins` **单向** import `_shared`
- `_shared` 不 import 任何同层或上层包，仅依赖 TS stdlib（`node:*` 纯 stdlib 允许）
- 每个 symbol 只有一个 canonical 源（`_shared/` 下），其余位置以 barrel re-export 形式向后兼容

---

## 2. 设计原则

### 2.1 零业务

`_shared` 中**不允许**出现以下内容：
- Window 类型的具体实现（RootWindow 等具体 interface 的实现细节留给各 builtin 包）
- LLM 调用、网络、文件 IO 的业务逻辑
- 任何带副作用的初始化（如 module-level singleton、side-effect import）

### 2.2 零内部依赖（除 stdlib）

允许的依赖：
- TypeScript 语言自身
- Node.js `node:*` stdlib（如 `node:path`、`node:crypto`），仅当函数是纯函数或类型声明
- 同 `_shared` 目录内的其他文件（`types/` 之间互引，`utils/` 可引 `types/`）

**禁止的依赖：**
- `@ooc/core/thinkable`
- `@ooc/core/executable`
- `@ooc/core/persistable`
- `@ooc/core/runtime`
- `@ooc/core/extendable`
- `@ooc/builtins/*`
- 任何 npm 包（`bun`、`elysia`、`react` 等均禁止）

### 2.3 零 IO

- 不 `import` `node:fs` 或 `node:fs/promises`
- 不执行磁盘读写（`existsSync` 也不行）—— session-path 工具保留在原位置，仅提取类型或引入显式参数回调
- 不发起网络请求
- 不调用全局状态（`process.env` 可通过参数形式透传，但不可直接读取）

> **特殊说明：** `classifyPackagesPath` 使用 `existsSync(package.json)` 做"包归属判定"。该函数保留在 `executable/windows/_shared/session-path.ts`，不迁移到 `_shared`。迁移走的是 `resolveSessionPath` 的纯路径重写部分和 `PackagesPathClass` 类型。

### 2.4 单一职责

每个文件只承载一类概念：
- `types/` 下只放 `interface` / `type` / `const enum` / 无状态常量
- `utils/` 下只放纯函数（相同输入必产生相同输出，无 observable 副作用）

---

## 3. 我有什么（文件结构 + 内容清单）

```
packages/@ooc/core/_shared/
├── package.json          # 独立 workspace 包，无 dependencies
├── index.ts              # barrel export
├── types/
│   ├── context-window.ts
│   ├── method.ts
│   ├── registry.ts
│   ├── thread.ts
│   ├── intent.ts
│   ├── xml.ts
│   ├── knowledge.ts
│   ├── viewport.ts
│   └── constants.ts
└── utils/
    ├── mention.ts
    ├── csv.ts
    └── session-path.ts
```

### 3.1 `types/context-window.ts`

**来源：** `executable/windows/_shared/types.ts`

**迁移符号：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `ObjectType` | `type` | window 类型字面量联合（含 `(string & {})` 扩展位） |
| `WindowStatus` | `type` | 9 个状态字面量联合 |
| `ContextWindowProvenance` | `interface` | 上下文来源标记 |
| `ContextWindowRelevance` | `interface` | 预算评分标记 |
| `BaseContextWindow` | `interface` | 所有 window 共通字段 |
| `SharingState` | `type` | 跨 thread 共享状态（ref / lent_out） |
| `GuidanceWindow` | `interface` | 内嵌于 form 的 guidance 子 window |
| `ContextObject` | `type` | 注意：**不再是 union**——union 依赖 builtins 各具体 window 类型，无法零依赖。此处仅导出 `ContextObject` 作为 `BaseContextWindow & Record<string, unknown>` 的最小别名（见下方"ContextObject union 处理"） |
| `ContextWindow` | `type alias` | 别名 = ContextObject（保留历史名） |
| `ROOT_WINDOW_ID` | `const` | `"root"` |
| `SKILL_INDEX_WINDOW_ID` | `const` | `"skill_index"` |
| `SESSION_CREATOR_THREAD_ID` | `const` | `"__session__"` |
| `generateWindowId(type)` | `function` | 纯函数：随机 id 生成 |
| `creatorWindowIdOf(threadId)` | `function` | 纯函数：稳定派生 creator window id |

**ContextObject union 处理：**

原 `types.ts` 中的 `ContextObject` 是 `RootWindow | MethodExecWindow | ... | GuidanceWindow` 的大 union，这个 union 依赖 builtins 各包的具体类型，**无法**放在零依赖的 `_shared` 中。

迁移方案：
- `_shared/types/context-window.ts` 仅导出最小 base：`export type ContextObject = BaseContextWindow & { [k: string]: unknown };`
- `executable/windows/_shared/types.ts` 保留为 canonical 的完整 union 源：`import { BaseContextWindow } from "@ooc/core/_shared"` 后拼装具体 window 类型
- 其他 import 方按需使用：只需要 base 字段时直接从 `_shared` 引，需要完整 union discriminant 时从 `executable/windows/_shared/types` 引
- 该拆分是"类型分层"而非"完全替换"——后续 ooc-7 再考虑把 builtins 类型也下沉到 `_shared`

**不迁移的符号（留在 `executable/windows/_shared/types.ts`）：**

- 所有具体 window type 的 re-export：`RootWindow` / `MethodExecWindow` / `DoWindow` / `TodoWindow` / `TalkWindow` / `ProgramWindow` / `FileWindow` / `KnowledgeWindow` / `SearchWindow` / `RelationWindow` / `SkillIndexWindow` / `PlanWindow` / `FeishuChatWindow` / `FeishuDocWindow`
- 完整 union 版的 `ContextObject`（见上）

### 3.2 `types/method.ts`

**来源：** `executable/windows/_shared/command-types.ts`

**迁移符号：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `MethodKnowledgeEntries` | `type` | `Record<string, string>` |
| `MethodOutcome` | `type` | exec 返回值联合（ok/error/object） |
| `ObjectMethod` | `interface` | **注意：`exec` 字段的签名中引用的 `MethodExecutionContext` 也在这里** |
| `MethodExecutionContext` | `interface` | **注意：以下字段类型需要用 _shared 内定义替代** |

`MethodExecutionContext` 的依赖替换：

| 原引用 | 替换为 |
|--------|--------|
| `ThreadContext` from `thinkable/context` | `ThreadContext` from `_shared/types/thread`（提取类型版） |
| `MethodExecWindow` from `./types` | 保留为 `ContextObject`（已有 `form?: ContextObject` 即可，具体 MethodExecWindow 的 discriminant 在 runtime 层 narrowing） |
| `ContextObject` / `ContextWindow` from `./types` | `ContextObject` / `ContextWindow` from `_shared/types/context-window` |
| `WindowManager` from `./manager` | **不迁移**——保留为 type-only import，或改为 `unknown` + 说明：`manager?: unknown` 留给 runtime 层 cast。**决策**：由于 WindowManager 本身有大量 runtime 逻辑，MethodExecutionContext 的 `manager` 字段在共享类型中声明为 `unknown` 并附带 TSDoc。executable 层定义 subtype 带具体类型。 |
| `FlowObjectRef` / `ThreadPersistenceRef` from `persistable/common` | 迁移到 `_shared/types/thread.ts`（见 3.4） |

**不迁移的符号：**

- 原文件没有其他符号，其余字段均在迁移范围内。

### 3.3 `types/registry.ts`

**来源：** `executable/windows/_shared/registry.ts`

**迁移符号：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `OnCloseContext` | `interface` | `{ thread, window }` |
| `OnCloseHook` | `type` | hook 签名 |
| `RenderContext` | `interface` | `{ thread, window }` |
| `RenderHook` | `type` | hook 签名 |
| `ReadableFn` | `type` | 可读函数签名 |
| `CompressViewHook` | `type` | 压缩视图 hook 签名 |
| `ObjectDefinition` | `interface` | object 类型定义（methods / onClose / renderXml 等） |
| `MethodVisibilityContext` | `type` | 三档可见性上下文 |

依赖替换：
- `ThreadContext` → `_shared/types/thread`
- `XmlNode` → `_shared/types/xml`
- `ObjectMethod` → `_shared/types/method`
- `ContextWindow` / `ObjectType` / `ContextObject` → `_shared/types/context-window`

**不迁移的符号（留在 executable 和 runtime）：**

| 符号 | 理由 |
|------|------|
| `ObjectRegistry` class | 含可变状态（注册、查询方法），属于 runtime |
| `builtinRegistry` singleton | 模块级可变状态，属于 runtime |
| `createObjectRegistry()` | 工厂函数，属于 runtime |
| `filterMethodsByVisibility()` | **迁移**——这是纯函数，移到 `_shared/utils/registry.ts` 或就地在 `types/registry.ts` 里（纯函数允许和类型同文件） |

**决策**：`filterMethodsByVisibility` 是纯函数，放在 `_shared/types/registry.ts` 末尾即可（类型 + 配套纯函数同文件）。

### 3.4 `types/thread.ts`

**来源：**
- `thinkable/context/index.ts`（ThreadContext 等类型）
- `persistable/common.ts`（FlowObjectRef 等引用类型 + `nestedObjectPath` 纯函数）

**迁移符号（来自 thinkable/context/index.ts）：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `ProcessEventCommon` | `type` | id + _foldedBy 共通字段 |
| `ProcessEvent` | `type` | 完整事件联合（call_started / text / tool_use / inject / permission_ask 等） |
| `ThreadMessage` | `type` | inbox/outbox 消息 |
| `ThreadContext` | `type` | **仅类型，不含 runtime 函数** |
| `ThreadStatus` | `type`（新增） | 从 ThreadContext.status 提取 `"running" \| "waiting" \| "done" \| "failed" \| "paused"`，显式导出便于复用 |

`ThreadContext` 的类型字段依赖处理：
- `ContextWindow[]` → `_shared/types/context-window`
- `IntentCache` → `_shared/types/intent`
- `ThreadPersistenceRef` → 从 persistable 迁移（见下）

**迁移符号（来自 persistable/common.ts）：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `FlowObjectRef` | `interface` | `{ baseDir, sessionId, objectId }` |
| `ThreadPersistenceRef` | `interface` | extends FlowObjectRef + threadId |
| `StoneObjectRef` | `interface` | `{ baseDir, objectId, _stonesBranch? }` |
| `STONE_CHILDREN_SUBDIR` | `const` | `"children"` |
| `BUILTIN_OBJECT_IDS` | `Set` | 只读集合，声明为 `ReadonlySet<string>` |
| `nestedObjectPath()` | `function` | 纯函数：objectId → path segments |
| `isBuiltinObjectId()` | `function` | 纯函数：objectId 是否是 builtin |
| `toJson()` | `function` | 纯函数：JSON 序列化（两空格 + 换行） |

**不迁移的符号（留在 persistable/common.ts）：**

| 符号 | 理由 |
|------|------|
| `objectDir(ref)` | 用到 `join` + 路径拼接，虽不直接 IO 但语义绑定 flow 布局；`nestedObjectPath` 已提供纯 segment 生成，上层自行 join |
| `threadDir(ref)` | 同上 |
| `stoneDir(ref)` | 路由逻辑含分支判定 + 路径拼接，绑定 persistable 语义 |
| `_deprecatedPackageDir(ref)` | deprecated，不搬 |
| `resolveStoneDir(ref)` | 含 `readdir` + `stat` IO |
| `deriveStoneFromThread(threadRef)` | 类型简单，保留在 persistable 即可（或作为一行 type helper 迁移也行——决策：迁移到 `_shared/types/thread.ts`，纯 field extraction） |

**决策**：`deriveStoneFromThread` 是 `{ baseDir, objectId } = pick(threadRef, ['baseDir', 'objectId'])` 的纯提取，迁移。

**不迁移的符号（留在 thinkable/context/index.ts）：**

| 符号 | 理由 |
|------|------|
| `buildContext(thread)` | 调用 pipeline / renderer，含 IO / 业务逻辑 |
| `buildInputItems(thread)` | 同上 |
| `processEventToItems()` | 依赖 LLM message 类型 + 具体渲染逻辑 |
| `findInboxMessage()` | 业务 helper |
| `resolveInboxWindowId()` | 业务 helper |
| `loadSelfInstructions()` | 含磁盘读取 IO |
| `buildPathsItem()` | 含 stoneDir 等业务路径 |
| `BudgetManager` 等 export | 运行时类 |
| `ContextPipeline` 等 export | 运行时类 |

### 3.5 `types/intent.ts`

**来源：** `thinkable/context/intent.ts`

**迁移符号：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `Intent` | `interface` | `{ name, tags? }` |
| `MethodCallSchema` | `interface` | 参数 schema |
| `MethodArgSpec` | `interface` | 单个参数规格 |
| `FormChangeEvent` | `type` | args_refined / status_changed / intent_changed |
| `IntentCacheEntry` | `interface` | 缓存条目 |
| `IntentCache` | `type` | `Map<string, IntentCacheEntry>` |
| `hashArgs(args)` | `function` | 纯函数：sorted keys JSON stringify |
| `diffArgs(prev, next)` | `function` | 纯函数：比较两个 args 对象 |

**不迁移的符号：**

无——该文件全部内容都是纯类型或纯函数。

### 3.6 `types/xml.ts`

**来源：** `thinkable/context/xml.ts`

**迁移符号：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `XmlNode` | `type` | element / text / comment 三变体 |
| `escapeXml(text)` | `function` | 纯函数 |
| `xmlElement(tag, attrs, children)` | `function` | 纯函数构造 |
| `xmlText(value)` | `function` | 纯函数构造 |
| `xmlComment(value)` | `function` | 纯函数构造 |
| `optionalElement(tag, value)` | `function` | 纯函数 |
| `renderPathList(tag, paths)` | `function` | 纯函数 |
| `appendNode(nodes, node)` | `function` | 纯函数（对入参数组 in-place 追加，但返回 void，语义上是 helper） |
| `serializeXml(node, depth)` | `function` | 纯函数：XmlNode → string |
| `truncateBytes(body, limit)` | `function` | 纯函数：UTF-8 安全字节截断 |

**不迁移的符号：**

- `shouldUseCdata` / `wrapCdata` / `renderXmlTextValue` / `escapeXmlComment`：内部 helper，保留为文件内 `export` 也可以，或不 export。**决策**：全部迁移，包括内部 helper，保持文件完整。
- `INDENT`：常量 `"  "`，迁移。

### 3.7 `types/knowledge.ts`

**来源：** `thinkable/knowledge/types.ts`

**迁移符号：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `ActivationLevel` | `type` | `"show_description" \| "show_content"` |
| `ActivatesOn` | `type` | `Record<string, ActivationLevel>` |
| `KnowledgeFrontmatter` | `interface` | yaml frontmatter 字段 |
| `KnowledgeDoc` | `interface` | 解析后单篇文档 |
| `KnowledgeIndex` | `interface` | `{ byPath: Map<string, KnowledgeDoc> }` |
| `ActivationResult` | `interface` | 激活器输出条目 |

**不迁移的符号：**

无——该文件全部是类型。

### 3.8 `types/viewport.ts`

**来源：**
- `executable/windows/_shared/viewport.ts`
- `executable/windows/_shared/transcript-viewport.ts`
- `extendable/_shared/viewport.ts`（re-export，将被删除）
- `extendable/_shared/transcript-viewport.ts`（re-export，将被删除）

**迁移符号（file/knowledge viewport）：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `Viewport` | `interface` | `{ lineStart, lineEnd, columnStart, columnEnd }` |
| `DEFAULT_VIEWPORT` | `const` | frozen 默认值 |
| `ViewportArgs` | `interface` | snake_case 入参 |
| `mergeViewport(current, args)` | `function` | 纯函数：校验+合并 |
| `hasAnyViewportField(args)` | `function` | 纯函数：谓词 |
| `applyViewport(raw, viewport)` | `function` | 纯函数：按 viewport 切片文本 |
| `sliceColumn(line, cs, ce)` | `function` | 纯函数：单列切片 |

**迁移符号（talk/do transcript viewport）：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `TranscriptViewport` | `interface` | `{ tail? } \| { rangeStart?, rangeEnd? }` |
| `DEFAULT_TRANSCRIPT_VIEWPORT` | `const` | frozen 默认值 |
| `TranscriptViewportArgs` | `interface` | snake_case 入参 |
| `mergeTranscriptViewport(current, args)` | `function` | 纯函数：校验+合并 |
| `hasAnyTranscriptViewportField(args)` | `function` | 纯函数：谓词 |
| `applyTranscriptViewport<M>(messages, viewport)` | `function` | 纯函数：泛型切片 |

**不迁移的符号（留在 executable）：**

| 符号 | 理由 |
|------|------|
| `executeWindowSetViewport(ctx, expectedType)` | 依赖 `MethodExecutionContext` 的 runtime + `Object.assign` 对 `ctx.self` 写副作用 |
| `executeWindowSetTranscriptViewport(ctx, expectedTypes)` | 同上，含对 window 状态的 in-place 修改 |

### 3.9 `types/constants.ts`

**来源：**
- `executable/windows/_shared/super-constants.ts`
- `extendable/_shared/super-constants.ts`（re-export，将被删除）

**迁移符号：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `SUPER_SESSION_ID` | `const` | `"super"` |
| `SUPER_ALIAS_TARGET` | `const` | = SUPER_SESSION_ID |
| `isSuperSessionId(id)` | `function` | 纯函数：大小写无关比较 |

### 3.10 `utils/mention.ts`

**来源：** `persistable/mention.ts`

**迁移符号：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `parseMentions(text)` | `function` | 纯函数：正则抽取 @mentions，去重保序 |
| `MENTION_PATTERN` | `RegExp` | 正则常量，导出便于测试 |

**不迁移的符号：**

无——该文件内容是纯字符串处理，全部迁移。

### 3.11 `utils/csv.ts`

**来源：** `persistable/csv-pool.ts`

**迁移符号（纯编解码部分）：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `stringifyCsvRow(fields)` | `function` | 原 `stringifyRow`，重命名以示 public |
| `parseCsv(text)` | `function` | RFC 4180 子集解析器，纯函数 |

**不迁移的符号（留在 persistable/csv-pool.ts）：**

| 符号 | 理由 |
|------|------|
| `readCsv(ref, name)` | 含 `readFile` IO |
| `writeCsv(ref, name, rows)` | 含 `writeFile` / `rename` IO |
| `appendCsv(ref, name, row)` | 含 IO + 串行队列 |
| `poolDataHeader(ref, name)` | 含 IO |
| `upsertCsvRows(...)` | 含 IO |
| `enqueueSessionWrite` 调用 | 所有带 IO 的持久化逻辑 |

### 3.12 `utils/session-path.ts`

**来源：** `executable/windows/_shared/session-path.ts`

**迁移符号（纯路径操作部分）：**

| 符号 | 类型 | 说明 |
|------|------|------|
| `PackagesPathClass` | `type` | path 分类结果 union |
| `StonesPathClass` | `type` | 旧命名兼容 union |
| `rewritePackagesPath(p)` | `function` | 纯字符串操作（stones/ → packages/ 兼容重写） |
| `rewritePoolsPath(p)` | `function` | 目前是 no-op，保留接口 |

**不迁移的符号（留在 executable/windows/_shared/session-path.ts）：**

| 符号 | 理由 |
|------|------|
| `resolveSessionPath(thread, p)` | 间接依赖 `existsSync`（通过 `classifyPackagesPath` 的实现实际上不在里面——但它依赖 `ThreadContext` type，ThreadContext 已迁移，需要重新评估） |
| `classifyStonesPath(...)` | 内部调 `classifyPackagesPath`，后者用 `existsSync` IO |
| `classifyPackagesPath(...)` | 用 `existsSync` 判断 package.json——**违反零 IO 原则** |
| `__testing` 导出 | 随保留函数一起 |

> 重新评估 `resolveSessionPath`：它内部只用到 `rewritePackagesPath`、`rewritePoolsPath`、`isAbsolute`、`resolve`、`process.cwd()`。`process.cwd()` 在纯函数语义下等同于"读全局状态"。**决策**：`resolveSessionPath` 留在 executable，因为它读取 `process.cwd()` 作为 fallback。迁移走的只有类型和两个 rewrite 纯函数。

---

## 4. 依赖方向验证

### 4.1 迁移后依赖图

```
                         +----------------+
                         |   _shared      |  ← 零内部依赖（仅 stdlib）
                         +-------+--------+
                +--------+--------+-------+--------+
                |        |        |       |        |
          +-----v--+ +---v---+ +--v---+ +-v---+ +--v-------+
          |thinkable| |executable| |persistable| |runtime| |extendable|
          +-----+--+ +---+---+ +------+-+ +--+--+ +----------+
                |        |         |        |
                +--------+----+----+--------+
                             |
                       +-----v------+
                       |  builtins/* |
                       +------------+
```

**关键性质：**

- `_shared` **不** import 任何 arrow 起点的包
- thinkable / executable / persistable / runtime / extendable **只** 单向 import `_shared`（它们之间仍可以有运行时 import，但**核心类型**不再互相 import）
- `builtins/*` 只 import `_shared`（核心类型）+ `executable`（runtime method 入口），不再直接穿透到 thinkable

### 4.2 验证清单（每批次完成后需检查）

| 检查项 | 命令 / 方法 |
|--------|-------------|
| `_shared/**` 中无 `from "@ooc/core/(thinkable\|executable\|persistable\|runtime)"` | `grep -r 'from.*@ooc/core/(thinkable\|executable\|persistable\|runtime\|extendable)' packages/@ooc/core/_shared/` 应为空 |
| `_shared/**` 中无 `from "node:fs"` | `grep -rn 'node:fs' packages/@ooc/core/_shared/` 应为空 |
| thinkable 中对 executable 的类型 import 只剩 runtime 级别（不再 import ContextWindow） | 检查 `thinkable/context/index.ts` 顶部 import |
| executable 中 import ThreadContext / Intent 改为从 `_shared` 引 | 检查 `executable/windows/_shared/command-types.ts` 顶部 |
| builtins 中 import 核心类型优先从 `_shared` | grep 抽样 5 个 builtin 包 |
| `bun tsc --noEmit` 全仓无新增错误 | 根目录执行 |
| `bun test packages/@ooc/core` 全绿 | 根目录执行 |

### 4.3 环检测

**迁移前**（存在的隐式环）：
```
executable/types.ts → thinkable/context/index.ts → executable/types.ts
    (import ContextWindow)              (import ThreadContext type)
```

**迁移后**（环被打断）：
```
executable/types.ts → _shared/thread.ts（无反向）
thinkable/context/index.ts → _shared/context-window.ts（无反向）
_shared/* → 不 import 任何一方
```

---

## 5. 迁移步骤（批次 C 总纲，C1-C10 详细展开）

批次总原则：**每步可独立提交，每步通过 tsc + test。** 每步在旧位置保留 barrel re-export，等所有下游迁移完后再删除。

### C1：创建 `_shared` 包骨架 + barrel re-export 机制

**产出：**
- 创建 `packages/@ooc/core/_shared/package.json`
- 创建 `packages/@ooc/core/_shared/index.ts`（空 barrel，后续逐步填充）
- 在根 `tsconfig.json` 的 paths 中注册 `"@ooc/core/_shared": ["packages/@ooc/core/_shared/index.ts"]`（或确认 bun workspace 自动解析）
- 在 `packages/@ooc/core/package.json` 中添加 `"@ooc/core/_shared": "workspace:*"`

**验收：** `bun tsc --noEmit` 无错误；`import { foo } from "@ooc/core/_shared"` 路径可解析。

### C2：迁移 `types/constants.ts` + `types/viewport.ts`（零交叉依赖）

这两个文件**不依赖其他 _shared 文件**，是最安全的切入点。

**步骤：**
1. 复制常量到 `_shared/types/constants.ts`
2. 复制 viewport 纯类型+纯函数到 `_shared/types/viewport.ts`
3. `executable/windows/_shared/super-constants.ts` 改为 `export * from "../../../_shared/types/constants.js"`
4. `extendable/_shared/super-constants.ts` 改为 `export * from "../../../core/_shared/types/constants.js"`
5. `executable/windows/_shared/viewport.ts` 顶部保留不迁移函数，末尾 `export * from "../../../_shared/types/viewport.js"`
6. `executable/windows/_shared/transcript-viewport.ts` 同上处理
7. `extendable/_shared/viewport.ts` / `extendable/_shared/transcript-viewport.ts` 改为 re-export 到 `_shared`

**验收：** viewport.test.ts、transcript-viewport.test.ts 全绿。

### C3：迁移 `types/xml.ts` + `utils/csv.ts` + `utils/mention.ts`（零交叉依赖）

三个文件都只依赖 stdlib：

1. `_shared/types/xml.ts`：完整复制
2. `_shared/utils/csv.ts`：复制 `parseCsv` + `stringifyCsvRow`
3. `_shared/utils/mention.ts`：完整复制
4. 原文件末尾追加 barrel re-export（`export * from "../../..._shared/..."`），注意 csv-pool.ts 中 parseCsv 原本是 private，改为 public 导出

**验收：** 相关单测全绿。

### C4：迁移 `types/intent.ts` + `types/knowledge.ts`

依赖：`types/intent.ts` 零依赖；`types/knowledge.ts` 零依赖。

1. 复制到各自文件
2. `thinkable/context/intent.ts` 改为 `export * from "../../_shared/types/intent.js"`
3. `thinkable/knowledge/types.ts` 改为 `export * from "../../_shared/types/knowledge.js"`
4. 确认 `executable/windows/_shared/command-types.ts` 中对 intent 的 import 仍通过旧路径可用

**验收：** `bun test packages/@ooc/core/thinkable` 全绿。

### C5：迁移 `types/thread.ts`

这是**核心步骤**——`ThreadContext` 是被引用最多的类型。

**步骤：**
1. 在 `_shared/types/thread.ts` 中定义 `ProcessEventCommon` / `ProcessEvent` / `ThreadMessage` / `ThreadContext` / `ThreadStatus` 类型，以及从 persistable 搬来的 `FlowObjectRef` / `ThreadPersistenceRef` / `StoneObjectRef` / `STONE_CHILDREN_SUBDIR` / `BUILTIN_OBJECT_IDS` / `nestedObjectPath` / `isBuiltinObjectId` / `deriveStoneFromThread` / `toJson`
2. `ThreadContext` 中 `intentCache?: IntentCache` 需 import `_shared/types/intent.ts`
3. `ThreadContext` 中 `contextWindows: ContextWindow[]` 需 import `_shared/types/context-window.ts`
4. `thinkable/context/index.ts`：类型部分改为从 `_shared/types/thread.ts` re-export，runtime 函数（`buildContext` 等）保留
5. `persistable/common.ts`：迁移走的符号改为 re-export 自 `_shared/types/thread.ts`

**验收：** 全仓 `bun tsc --noEmit` + `bun test packages/@ooc/core` 全绿。

### C6：迁移 `types/context-window.ts`

1. 定义 `BaseContextWindow` / `ObjectType` / `WindowStatus` / `GuidanceWindow` / `SharingState` / 相关常量 + 纯函数
2. `ContextObject` 在 `_shared` 中定义为 **base 版**：`type ContextObject = BaseContextWindow & { [k: string]: unknown }`
3. `executable/windows/_shared/types.ts`：
   - import base types from `_shared`
   - 拼接具体 window types 生成完整 union `ContextObject`（覆盖 base 版）
   - re-export 所有 base 符号
4. `thinkable/context/index.ts` 中 `import type { ContextWindow } from "../../executable/..."` 改为 `import type { ContextWindow } from "../../_shared/types/context-window.js"`

**验收：** 全仓 tsc 无错误。关键验证：thinkable 中 no longer import executable。

### C7：迁移 `types/method.ts` + `types/registry.ts`

1. `_shared/types/method.ts`：定义 `ObjectMethod` / `MethodExecutionContext` / `MethodOutcome` / `MethodKnowledgeEntries`
   - `MethodExecutionContext.manager` 声明为 `unknown`，附 TSDoc 说明 runtime 层使用时 cast
   - `MethodExecutionContext.thread` 使用 `_shared/types/thread` 的 `ThreadContext`
2. `_shared/types/registry.ts`：定义 `ObjectDefinition` 及各 hook 类型 + `filterMethodsByVisibility` 纯函数
3. `executable/windows/_shared/command-types.ts` 改为 re-export + 具体 MethodExecutionContext 增强（如有需要）
4. `executable/windows/_shared/registry.ts` 改为 re-export + runtime 部分（`ObjectRegistry` class 等）

**验收：** executable/windows 下所有测试全绿。

### C8：迁移 `utils/session-path.ts`

1. `_shared/utils/session-path.ts`：迁移 `PackagesPathClass` / `StonesPathClass` / `rewritePackagesPath` / `rewritePoolsPath`
2. `executable/windows/_shared/session-path.ts` 保留 `resolveSessionPath` / `classifyPackagesPath` / `classifyStonesPath` / `__testing`
3. 原文件顶部 import 类型和纯函数改为从 `_shared` 引

**验收：** session-path 相关测试（如在 `__tests__` 中）全绿。

### C9：下游迁移——`builtins/*` 包

逐个 `@ooc/builtins/*` 包，将其 import 路径从：
- `@ooc/core/thinkable/context` → `@ooc/core/_shared`（核心类型）
- `@ooc/core/executable/windows/_shared/*` → `@ooc/core/_shared`（类型/纯函数部分）

保留对 `@ooc/core/executable/windows/_shared/types.ts` 的 import 仅当需要**完整 union** `ContextObject`（discriminant narrowing）时。

策略：**批量替换 + 人工核查**，每个 builtin 包一次 PR。

### C10：清理（可选，可延迟到 ooc-7）

确认所有下游均已迁移到 `_shared` 后：
1. 删除 `extendable/_shared/` 目录下的 viewport / super-constants / transcript-viewport 文件（该目录在 ooc-6 cleanup 中确认只是 re-export 壳）
2. 为 `executable/windows/_shared/` 下不再需要的 re-export 文件添加 `@deprecated` JSDoc（不急删，至少保留一个 release）
3. 在 `meta/*.doc.ts` 中更新"类型 canonical 源"的说明

---

## 6. 风险与回滚

### 6.1 风险矩阵

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| `ContextObject` base 版 vs union 版 narrowing 不一致 | 中 | 高 | C6 步骤中在 `executable/types.ts` 保留完整 union 作为 canonical；thinkable 如需要 narrowing 时显式 import executable 版 |
| `MethodExecutionContext.manager: unknown` 需要大量 cast | 中 | 中 | 定义 `MethodExecutionContextRuntime extends MethodExecutionContext { manager: WindowManager }` 供 executable 内部使用 |
| session-path 中的 `process.cwd()` fallback 被误迁移 | 低 | 中 | C8 明确不迁移 `resolveSessionPath`；review 时 grep `process.cwd` |
| builtins 批量替换路径遗漏 | 中 | 低（编译器会抓） | `bun tsc --noEmit` + CI 作为 gate |
| `parseCsv` / `stringifyCsvRow` 原本是 private，改为 export 后被误用 | 低 | 低 | TSDoc 说明是 RFC 4180 子集，不处理自定义分隔符 |
| `ObjectRegistry` 类 vs 接口混淆 | 低 | 中 | 严格命名：`ObjectDefinition` 是 interface（在 _shared），`ObjectRegistry` 是 class（在 runtime），从不混用 |

### 6.2 回滚策略

**每批次独立可回滚**，因为：

1. **Barrel re-export 保留**：C1-C8 的所有旧路径都不删除，只改为 re-export 指向 `_shared`。回滚时把 re-export 改回原实现即可（git revert 单 commit）。
2. **类型而非运行时**：迁移的绝大多数内容是类型。类型层的回滚不会影响运行时行为（除非同时改了函数实现）。
3. **_shared 是纯新增目录**：C1 创建的 `_shared/` 目录本身是纯加性。最坏情况删除该目录 + revert 所有 re-export 修改，完全回到迁移前状态。

**回滚命令（单批次）：**
```bash
git revert <commit_sha_of_batch>
bun tsc --noEmit
bun test packages/@ooc/core
```

### 6.3 灰度验证

每批次完成后的验证步骤（必须全绿才能继续下一批次）：

1. `bun tsc --noEmit` 全仓无错误
2. `bun test packages/@ooc/core` 所有测试通过
3. 抽样 3 个 `@ooc/builtins/*` 包的测试通过
4. e2e 测试中至少 1 条"完整对话链路"场景通过（详见 `meta/engineering.testing.doc.ts`）

---

## 附录 A：符号迁移总表

| 源文件 | 目标文件 | 迁移符号数 | 留守符号数 |
|--------|----------|-----------|-----------|
| `executable/windows/_shared/types.ts` | `_shared/types/context-window.ts` | 13 | ~14 (具体 window re-exports) |
| `executable/windows/_shared/command-types.ts` | `_shared/types/method.ts` | 4 | 0 |
| `executable/windows/_shared/registry.ts` | `_shared/types/registry.ts` | 8 | 3 (ObjectRegistry/singletons) |
| `thinkable/context/index.ts` | `_shared/types/thread.ts` | 5 types + 2 fns | 7+ runtime fns |
| `thinkable/context/intent.ts` | `_shared/types/intent.ts` | 8 | 0 |
| `thinkable/context/xml.ts` | `_shared/types/xml.ts` | 11 | 0 |
| `thinkable/knowledge/types.ts` | `_shared/types/knowledge.ts` | 6 | 0 |
| `executable/windows/_shared/viewport.ts` | `_shared/types/viewport.ts` | 8 | 1 (executeWindowSetViewport) |
| `executable/windows/_shared/transcript-viewport.ts` | `_shared/types/viewport.ts` | 6 | 1 (executeWindowSetTranscriptViewport) |
| `executable/windows/_shared/super-constants.ts` | `_shared/types/constants.ts` | 3 | 0 |
| `persistable/mention.ts` | `_shared/utils/mention.ts` | 2 | 0 |
| `persistable/csv-pool.ts` | `_shared/utils/csv.ts` | 2 | 5+ (IO 函数) |
| `executable/windows/_shared/session-path.ts` | `_shared/utils/session-path.ts` | 4 | 3 (含 IO 的函数) |
| `persistable/common.ts` | `_shared/types/thread.ts` | 8 | 7 (含 IO / 路径路由) |

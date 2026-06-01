# OOC Object Unification Design

**日期：** 2026-05-28
**分支：** ooc-6
**前提：** 基于 ooc-2 增量迭代，不做全量重写；不参考 ooc-3/4/5 实现。

## 目标

把当前 OOC 系统中并行的两套概念——**ContextWindow**（运行时上下文单元）和 **OOC Object**（Agent 身份单元）——统一为一套概念：

> **Context Window 就是 OOC Object 出现在 Context 中的形态。**

收益：
1. **概念归一**：LLM 只需要理解"Object"这一个实体，而不是"window / object / command / method"四个并列概念
2. **能力复用**：Object 的 method / UI / readable 天然可作为 window 的 command / 渲染 / 上下文展示，消除重复定义
3. **原型继承**：Object 之间通过原型链继承方法、UI、readable，为 Agent 专业化分层提供基础
4. **持久化统一**：运行时创建的 window 不再是匿名临时数据结构，而是有身份、可嵌套、可继承的 Object
5. **Web UI 统一**：前端不再按 window type 硬编码渲染分支，而是通过 Object 的 visible 模块动态加载 UI

---

## 核心概念重定义

### 1. Context Window = Object in Context

**旧模型**：
- `ContextWindow` 是运行时上下文单元，有 `type`（root/file/do/talk/...），挂 `command`
- `OOC Object` 是持久化身份单元，有 `self.md`/`readme.md`/`server/`/`client/`

**新模型**：
- `ContextWindow` **就是** OOC Object 出现在当前 thread context 中的形态
- 所有挂在 window 上的 `command` 改称为 Object 的 **method**
- Object 可以出现在多个 thread 的 context 中（共享身份，独立状态）

### 2. Method 概念合并

**旧模型**：
- Window command：`src/executable/windows/<type>/command.*.ts` 中定义
- Object server method：`stones/<id>/server/index.ts` 中 `export const window = { commands: {...} }`

**新模型**：
- 统一称为 **Object Method**，由 Object 的 `executable/` 目录提供
- Method 有两个可见性标记：
  - `public?: boolean`：是否对其他 Object 可见（默认 `false`，仅自己 context 中展示）
  - `for_ui_access?: boolean`：是否可被前端 HTTP API 调用（对应原 `llm_methods`）

### 3. Builtin Objects

**旧模型**：`src/executable/windows/<type>/` 定义各 window type 的行为

**新模型**：这些改为 **builtin objects**，存放在 `src/extendable/base/<type>/`：
- `root` / `command_exec` / `todo` / `program` / `file` / `knowledge` / `search` / `skill_index` / `plan` / `custom`
- 每个 builtin object 遵循与 user-defined object 相同的目录结构（见 §6）

**重要澄清（2026-06-01 补充设计）**：
`do` 和 `talk` **不**是独立的 builtin objects，而是**所有 OOC Object 的基础属性/能力**：
- `do`：Object 执行任务的能力（executable 维度的体现）
- `talk`：Object 与其他 Object 通信的能力（collaborable 维度的体现）

它们仍然会以 context window 的形式出现在 context 中（表示"该 Object 正在做 X"或"该 Object 正在与 Y 对话"），但这是 Object 状态的一种呈现方式，而非独立的 Object。这也意味着：
- 每一个 OOC Object 天然具备 `do` 和 `talk` 的方法
- `do` context window 显示 Object 的执行状态（对应子 thread、进度等）
- `talk` context window 显示 Object 的对话状态（对应 inbox/outbox、消息历史等）
- 迁移时 `do`/`talk` 的代码逻辑保留在 `src/executable/windows/` 下，作为 Object 的通用能力层，而非独立 builtin object

### 3.1 Do & Talk 作为 Object 固有能力

**do 能力**：每个 Object 天然具备以下方法（由系统自动注入，无需 Object 自己实现）：
- `exec(command, args)`：在本 Object 上执行一个方法
- `continue()`：继续被中断的任务
- `wait()`：等待 IO 完成
- `close()`：关闭当前任务上下文

**talk 能力**：每个 Object 天然具备以下方法：
- `say(target, message)`：向另一个 Object 发送消息
- `inbox()`：查看收件箱
- `outbox()`：查看发件箱
- `mentions()`：查看 @提及

这些能力不需要单独注册为 builtin object，而是作为所有 Object 的基础接口存在。

### 4. Readable 概念（新增）

Object 可以控制自己如何在 Context 中呈现给 LLM：

- `readable.md`：静态文本展示（对应原 `readme.md`，给外部看的介绍）
- `readable.ts`：动态函数 `(ctx: ReadableContext) => XmlNode[] | Promise<XmlNode[]>`

**渲染优先级**：
1. 若存在 `readable.ts`，调用它获取 XML 节点
2. 否则若存在 `readable.md`，将其内容作为 `<readable>` 节点
3. 否则使用默认渲染（title + status + 方法列表）

### 5. Prototype Chain（原型链）

Object 可以通过 `self.md` frontmatter 声明 `prototype: "<objectId>"`，继承原型对象的：
- Methods（executable/ 下的方法）
- UI 组件（visible/ 下的组件）
- Readable 函数（readable.ts）

**继承规则**（类似 JavaScript 原型链）：
- 自身定义覆盖原型定义
- 方法查找：self → prototype → prototype.prototype → ... → builtin base
- `public` 和 `for_ui_access` 标记在继承时保留，可被覆盖
- `readable` 继承：若无自身 readable，使用原型的 readable

### 6. 目录结构重命名

**旧 stone object 结构**：
```
stones/<branch>/objects/<id>/
├── .stone.json
├── self.md
├── readme.md
├── server/          # 方法实现
│   └── index.ts
├── client/          # UI 实现
│   └── index.tsx
├── knowledge/
└── children/
```

**新 stone object 结构**：
```
stones/<branch>/objects/<id>/
├── .stone.json
├── self.md          # 身份说明（不变）
├── readable.md      # 静态上下文展示（原 readme.md 重命名）
├── readable.ts      # 动态上下文展示（新增，可选）
├── executable/      # 方法实现（原 server/ 重命名）
│   └── index.ts
├── visible/         # UI 实现（原 client/ 重命名）
│   └── index.tsx
├── knowledge/       # 不变
└── children/        # 不变
```

### 7. Runtime Object 持久化

**旧模型**：运行时创建的 window 仅存在于 `thread.json` 的 `contextWindows[]` 数组中

**新模型**：运行中创建的 Object 持久化在 flow 目录下，形成 **Context Object Tree**：

```
flows/<sessionId>/objects/<objectId>/
├── .flow.json
├── context/                    # 本对象 context 中出现的子对象
│   ├── <newObjectId1>/         # 第一个子对象（如 file_window）
│   │   ├── .flow.json
│   │   ├── state.json          # 对象状态（对应原 window 的 type-specific 字段）
│   │   └── context/            # 可继续嵌套
│   │       └── <newObjectId2>/
│   └── <newObjectId3>/
└── threads/
    └── <threadId>/
        └── thread.json
```

- 每个 `context/<childId>/` 对应原 `contextWindows[]` 中的一个 window
- 嵌套结构对应原 `parentWindowId` 形成的树
- `state.json` 存储对象的运行时状态（path / content / transcript 等）

### 8. Command Exec → Object Creation

**旧模型**：LLM 调 `exec(window_id, command, args)` → 创建 `command_exec` form → submit → 可能创建新 window（do/file/talk/...）

**新模型**：
- LLM 调 `exec(object_id, method, args)`（原语不变，语义变：在某 object 上调某 method）
- method 执行若需要创建新的上下文实体 → **创建新 Object** 并放入当前 Object 的 `context/` 目录
- 新 Object 自动出现在当前 thread 的 context 中（作为 Context Window）
- `command_exec` 本身也是一个 builtin object（承载渐进式参数填充）

### 9. Relation Window 取消 → Peer/Children Auto-Entry

**旧模型**：`relation` type window 展示同级和子级 Agent 列表

**新模型**：
- 取消 `relation` window type
- 每轮 buildContext 时，系统自动收集：
  - **Peer objects**：同级 stone objects（同父或同顶层）
  - **Children objects**：直接子级 stone objects
- 这些对象以"轻量引用"形式自动进入 context（压缩态，仅 title + id + public methods 摘要）
- LLM 可通过 `exec(peer_id, "enter")` 将其从引用态转为全量 context window

---

## 各组件变更清单

### A. 类型系统 (`src/executable/windows/_shared/` → `src/extendable/base/_shared/`)

| 旧概念 | 新概念 | 说明 |
|--------|--------|------|
| `ContextWindow` | `ContextObject` | 别名保留兼容，语义变为"Object 在 context 中的形态" |
| `WindowType` | `ObjectType` | 还是字符串枚举，值不变（`root`/`file`/`do`/...） |
| `CommandTableEntry` | `ObjectMethod` | 新增 `public?: boolean`、`for_ui_access?: boolean` 字段 |
| `WindowTypeDefinition` | `ObjectDefinition` | 新增 `readable?: ReadableFn`、`prototype?: string` |
| `WindowRegistry` | `ObjectRegistry` | 注册 builtin objects；支持 prototype 查找 |

**`ObjectMethod` 新增字段**：
```typescript
interface ObjectMethod extends CommandTableEntry {
  /** 是否对其他 Object 可见；默认 false = 仅自己 context 中展示 */
  public?: boolean;
  /** 是否可被前端 HTTP API 调用；对应原 llm_methods */
  for_ui_access?: boolean;
}
```

**`ObjectDefinition` 新增字段**：
```typescript
interface ObjectDefinition extends WindowTypeDefinition {
  /** 原型 object id；继承其 methods / visible / readable */
  prototype?: string;
  /** 动态上下文渲染函数；优先级高于 readable.md */
  readable?: ReadableFn;
}
```

### B. Persistence 层

#### B1. 目录重命名辅助函数（向后兼容）

| 旧函数 | 新函数 | 说明 |
|--------|--------|------|
| `serverDir(ref)` | `executableDir(ref)` | 新方法优先；旧函数保留 alias 直到迁移完成 |
| `serverIndexFile(ref)` | `executableIndexFile(ref)` | 同上 |
| `clientDir(ref)` | `visibleDir(ref)` | 同上 |
| `clientIndexFile(ref)` | `visibleIndexFile(ref)` | 同上 |
| `readmeFile(ref)` | `readableFile(ref)` | 返回 `readable.md` 路径 |
| `readReadme(ref)` | `readReadable(ref)` | 读取 readable.md |

**兼容性策略**：旧函数保留为 alias 并标记 `@deprecated`，指向新函数。所有内部调用逐步迁移到新函数名。

#### B2. Runtime Object 目录辅助函数（新增）

```typescript
/** flows/<sid>/objects/<oid>/context/<childOid>/ */
function contextObjectDir(ref: FlowObjectRef, childId: string): string;

/** flows/<sid>/objects/<oid>/context/<childOid>/state.json */
function contextObjectStateFile(ref: FlowObjectRef, childId: string): string;

/** 递归查找 context tree 中的对象 */
function findContextObject(ref: FlowObjectRef, path: string[]): FlowObjectRef | undefined;
```

#### B3. `createStoneObject` 更新

创建的初始文件从 `readme.md` 改为 `readable.md`（空文件占位）。`server/` 和 `client/` 目录 lazy 创建的行为保留，但新代码应使用 `executable/` 和 `visible/`。

### C. Runtime 层（`src/thinkable/context/`、`src/executable/`）

#### C1. `buildContext` 流程变更

**旧流程**：
1. 从 `thread.contextWindows[]` 收集 windows
2. 按 type 从 WindowRegistry 拿 renderXml
3. 合成 XML

**新流程**：
1. 从 `thread.contextWindows[]` 收集（兼容）+ 从 `context/` 目录扫描 runtime objects
2. 对每个 object：
   - 若有 `readable.ts` → 调用它
   - 否则若有 `readable.md` → 渲染为 `<readable>` 节点
   - 否则走 type 默认渲染（保持现状）
3. 注入 peer/children 引用（取代 relation window）
4. 合成 XML

#### C2. Method 可见性过滤

- **自 context**：展示所有 methods（public + private）
- **其他 object 的 context 引用**：仅展示 `public: true` 的 methods
- **前端 API**：仅调用 `for_ui_access: true` 的 methods

#### C3. Prototype Chain 解析

```typescript
function resolveObjectMethods(objectId: string, ref: StoneObjectRef): ObjectMethod[] {
  // 1. 加载自身 executable/index.ts 的 methods
  // 2. 若 self.md frontmatter 有 prototype，递归加载原型 methods
  // 3. 合并：自身覆盖原型
  // 4. 最终落到 builtin base object
}
```

#### C4. Peer/Children Auto-Entry

每轮 `buildContext` 末尾追加：
```xml
<context_peers>
  <object_ref id="sentry/sentry_event" public_methods="query,analyze" status="idle"/>
  <object_ref id="sentry/sentry_factor" public_methods="create,list" status="idle"/>
</context_peers>
<context_children>
  <object_ref id="sentry/children/sentry_event_factor" public_methods="run" status="idle"/>
</context_children>
```

LLM 可通过 `exec(<id>, "enter")` 将引用转为全量 window。

### D. Web UI 层（`web/src/`）

#### D1. Window Type Renderers → Object Visible Modules

**旧模型**：`web/src/domains/sessions/components/window-diff-renderers/<Type>Diff.tsx` 按 type 硬编码

**新模型**：
- 每个 object 可以有 `visible/index.tsx`，`export default function ObjectRenderer(props: ObjectViewProps)`
- 前端通过 `/api/objects/:id/visible` 动态加载渲染组件
- 内置 fallback：若 object 无 visible 模块，使用通用 JSON diff 渲染

#### D2. Window Diff Registry 更新

`registry.ts` 从静态 switch-case 改为动态 object id 查找：
```typescript
// 旧
const renderers = { file: FileWindowDiff, do: DoWindowDiff, ... };

// 新
async function getRenderer(objectType: string, objectId?: string) {
  // 1. 尝试加载 object 自身的 visible 模块
  // 2. 尝试加载 builtin object 的 visible 模块
  // 3. fallback 到通用 JSON 渲染
}
```

#### D3. API 路由

| 旧路由 | 新路由 | 说明 |
|--------|--------|------|
| `GET /api/windows/types` | `GET /api/objects/types` | 列出所有 object types |
| `GET /api/windows/_shared/types` | `GET /api/objects/catalog` | 列出 object catalog（含 methods） |
| `POST /api/windows/:id/exec` | `POST /api/objects/:id/exec` | 调用 method（仅 `for_ui_access: true`） |

### E. Knowledge 激活

**旧 trigger 格式**：
- `window::<type>`
- `command::<window_type>::<command>`

**新 trigger 格式**（旧格式兼容到迁移完成）：
- `object::<type>` → 该 type 的 object 出现在 context 中时命中
- `method::<object_type>::<method>` → 该 method 的 form 打开时命中
- `object_id::<objectId>` → 特定 id 的 object 出现时命中

**兼容性**：旧 trigger 格式在迁移期仍有效，但新 knowledge 应使用新格式。系统内部将旧格式自动映射到新格式。

---

## 迁移策略（小步迭代，每步可回滚）

### 原则
1. **Alias first**：新函数/类型先作为 alias 加入，旧的标记 deprecated
2. **Migrate one at a time**：每次只迁移一个 window type / 一个模块
3. **Tests green between steps**：每步完成后测试必须全绿
4. **Dual-read, single-write**：持久化层先支持两种路径读取，写入只走新路径

### 阶段划分

#### Phase 0: Design & Documentation
- 本 spec 完成
- 更新 `meta/object.doc.ts` 中的概念定义
- 验证 TypeScript 类型通过

#### Phase 1: Type System & Helpers
- 新增 `ObjectMethod` / `ObjectDefinition` 类型（扩展现有类型，不删除）
- 新增 persistence 目录辅助函数（`executableDir` / `visibleDir` / `readableFile`）
- 旧函数标记 `@deprecated` 但保留实现
- 迁移 `src/executable/windows/_shared/` → `src/extendable/base/_shared/`（目录移动，内容先不变）
- 更新 barrel imports

#### Phase 2: Registry & Method Visibility
- `WindowRegistry` → `ObjectRegistry`（名称迁移，内部逻辑先不变）
- 在 `CommandTableEntry` 上添加可选 `public` / `for_ui_access` 字段
- 更新 method 查找逻辑支持 prototype chain（先支持 builtin 之间的继承）
- 添加 method 可见性过滤（自 context vs 其他 object 引用）

#### Phase 3: Readable Concept
- 新增 `readable.md` / `readable.ts` 加载逻辑
- 更新 context 渲染流程：优先调用 readable，fallback 到 type renderXml
- 迁移 `readme.md` → `readable.md`（先双读，再写新路径）
- 更新 `createStoneObject` 创建 `readable.md` 而非 `readme.md`

#### Phase 4: Builtin Objects Migration（逐个迁移）

**重要澄清（2026-06-01）**：`do` 和 `talk` 不作为独立 builtin object 迁移，它们是所有 OOC Object 的基础属性/能力（详见 §3.1）。
它们的 window 类型保留（用于上下文呈现），但代码逻辑作为 Object 通用能力层保留在 `src/executable/windows/do/` 和 `src/executable/windows/talk/`，不迁移到 `src/extendable/base/`。

按依赖顺序逐个迁移 window type → builtin object：
1. `knowledge`（最简单，无 command exec 副作用）
2. `file`（有 command，依赖少）
3. `todo`（简单状态机）
4. `search`（有结果展示）
5. `skill_index`
6. `plan`
7. `command_exec`（核心 form 机制）
8. `program`（有 sandbox 依赖）
9. `root`（最后，全局命令）
10. `custom`（最后，用户自定义）

每步内容：
- 移动目录：`src/executable/windows/<type>/` → `src/extendable/base/<type>/`
- 按新结构拆分：`executable/index.ts`（methods）、`visible/index.tsx`（UI）、`readable.ts`（渲染）
- 更新 imports
- 跑测试

#### Phase 5: Runtime Object Persistence
- 新增 `context/` 目录辅助函数
- 更新 WindowManager：创建 window 时同步写入 `context/<id>/state.json`
- 更新 buildContext：从 `context/` 目录 + `thread.contextWindows[]` 双源读取
- 移除 `thread.contextWindows[]` 的写入（只读旧数据兼容）
- 最终移除 `thread.contextWindows[]` 字段

#### Phase 6: Relation Window → Peer/Children Auto-Entry
- 移除 `relation` window type 注册
- 在 `buildContext` 末尾添加 peer/children 引用注入
- 添加 `enter` method 将引用转为全量 window
- 更新 relation 相关的 knowledge triggers

#### Phase 7: Web UI Migration
- 更新 API 路由：`/api/windows/*` → `/api/objects/*`（旧路由保留 alias）
- 更新前端 `useWindowTypes` → `useObjectTypes`
- 更新 window-diff renderers registry 为动态加载
- 逐个迁移 `*Diff.tsx` 到对应 builtin object 的 `visible/` 目录

#### Phase 8: Knowledge Trigger Migration
- 系统内部自动映射旧 trigger 格式到新格式
- 更新所有 builtin knowledge 的 `activates_on` 到新格式
- 添加 lint 规则禁止旧格式

#### Phase 9: Cleanup
- 移除所有 `@deprecated` 标记的旧函数
- 移除 `thread.contextWindows[]` 字段
- 移除 `serverDir` / `clientDir` / `readmeFile` 等旧辅助函数
- 移除旧 API 路由 alias
- 移除旧 trigger 格式兼容代码

---

## 不变约束（迁移中不可破坏）

1. **LLM 原语不变**：`exec` / `close` / `wait` / `compress` 四个 tool 的调用形态不变
2. **持久化数据兼容**：旧 `thread.json` 必须能被新代码读取（双读阶段）
3. **Test 全绿**：每阶段完成后 `bun test` 必须全通过
4. **E2E 场景不退化**：R1-R3 评分必须保持或提升
5. **Progressive disclosure**：command 的渐进式参数填充机制不变
6. **C 规则**：open 时 args 齐全且无新知识则自动 submit 的规则不变
7. **Stone git versioning**：stone 对象的 git 版本控制机制不变

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 目录移动导致 import 断裂 | 高 | 中 | 使用 barrel re-exports，旧路径保留 alias 到 cleanup 阶段 |
| 新旧类型同时存在导致混淆 | 中 | 中 | TypeScript 类型用 `extends` 关联，旧类型标记 deprecated |
| Runtime object 持久化影响性能 | 中 | 高 | state.json 写入走 `enqueueSessionWrite` 队列，不阻塞 thinkloop |
| Prototype chain 循环引用 | 低 | 中 | 加载时检测循环，抛错并终止 |
| Web UI 动态加载导致闪屏 | 中 | 低 | 内置 skeleton 加载态，常用 builtin 预打包 |

---

## 验收标准

1. ✅ 所有现有测试通过（`bun test`）
2. ✅ 所有 e2e 场景通过（R1/R2/R3 ≥ Good）
3. ✅ 每个 builtin object 有 `executable/` / `visible/` / `readable.ts` 结构
4. ✅ `readable.ts` 动态渲染可以正确控制 LLM 看到的内容
5. ✅ Prototype chain 方法继承正确（自身覆盖原型）
6. ✅ `public: false` 的方法不出现在其他 object 的 context 中
7. ✅ `for_ui_access: false` 的方法不能通过 HTTP API 调用
8. ✅ Runtime objects 正确持久化在 `context/` 目录下
9. ✅ Peer/children 对象自动以引用形式进入 context
10. ✅ Web UI 可以动态加载 object 的 visible 模块
11. ✅ `bun tsc --noEmit meta/object.doc.ts` 通过

---

## 不在本设计范围内

- 跨 session 的 runtime object 持久化（flow 对象仍是 session-scoped）
- Object 之间的 state 共享（仍通过 inbox/outbox）
- 多继承 / mixin（仅单原型链）
- 旧 `thread.json` 的迁移脚本（历史数据不迁移，仅兼容读取）
- ooc-3/4/5 的任何代码或设计（明确不参考）

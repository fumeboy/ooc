# Window 自定义渲染(visible) + Window Method 归位(readable) 设计

> 日期：2026-06-08 ｜ 维度：visible + readable + executable ｜ 状态：设计已批准，待实现计划

## 背景与动机

OOC 核心哲学：**ContextWindow 既是信息展示单元，也是可调用 method 的交互对象**；object（无论 builtin class 还是 user 实例）应自己掌控"作为 window 时的展示"。当前实现有两处偏离：

1. **visible 未在 window 级落地**：thread_context 视图（`ContextSnapshotViewer`）展示 window 时，builtin window 走前端**硬编码 import + type switch**，user-defined window **降级成 JSON 只读**。object 自己的 visible 组件没有作为统一渲染入口。
2. **window method 未与 object method 分离**：控制展示的方法（`set_viewport` 等）和控制 object 自身的方法都挤在 `ObjectDefinition.methods`，由 executable 统一注册。`ObjectMethod.kind` 只有 `"constructor" | "method"`，没有 window/object 之分。readable 维度（`ReadableFn`）只渲染、不注册 method。

**两者是同一愿景的两面**：让 object 完整掌控自己作为 window 时的展示——**视觉(visible) + 控制方法(readable window method)**。

## 现状锚点（代码事实）

| 事实 | 位置 |
|------|------|
| builtin visible 约定 = `export default function ({ window }) => JSX` | `packages/@ooc/builtins/file/visible/index.tsx:6,32` |
| 前端 window 渲染硬编码 import builtin `WindowDetail` | `packages/@ooc/web/src/domains/files/components/ContextSnapshotViewer.tsx:65-73` |
| 前端 type switch 分发 + user-defined JSON 降级 | `ContextSnapshotViewer.tsx:733-769, 797-805` |
| `effectiveVisibleType` 后端沿 parentClass 继承链回退 | `context-snapshot.ts:290-298` |
| object visible 源 URL API（stone/flow scope） | `packages/@ooc/core/app/server/modules/ui/api.client-source-url.ts:45-116` |
| 前端动态加载 object visible（`/@fs` dynamic import） | `packages/@ooc/web/src/domains/clients/ObjectClientRenderer.tsx:159-253` |
| `ObjectMethod` 定义（kind 仅 constructor/method） | `packages/@ooc/core/_shared/types/method.ts:48-101` |
| `ObjectDefinition`（methods / readable 字段） | `packages/@ooc/core/_shared/types/registry.ts:57-72` |
| `filterMethodsByVisibility`（self/peer/ui 三档） | `registry.ts:88-107` |
| set_viewport 注册在 executable methods | `packages/@ooc/builtins/file/executable/index.ts:190-217` |
| readable 函数读 `window.viewport` 渲染 | `packages/@ooc/builtins/file/readable.ts:34-69` |
| viewport 协议设计文档 | `packages/@ooc/meta/object.doc.ts:1317-1454` |

## Part 1 — 统一 window 渲染解析层（visible 维度）

### 目标
thread_context 视图展示任意 window 时，用该 window 所属 class/object 自己的 visible 组件渲染；前端**无 per-type switch、无 `HANDLED_WINDOW_TYPES` 硬编码集合**。builtin class 与 user-defined object 一视同仁。

### 约定
object 的 `visible/index.tsx` **default export** 一个 `({ window }: { window: ContextWindow }) => JSX` 组件（builtin 已遵循，user object 照此写）。

### 解析层
前端新增 `resolveWindowVisible(window)`，统一解析顺序沿 `effectiveVisibleType` / `parentClass` 继承链回退：

1. **builtin class** → 从**静态注册表**取组件。注册表在前端一处集中 `import` 各 builtin `WindowDetail`（编译时打包进 bundle，稳定/快），key 为 builtin type。
2. **user-defined class/object** → 经现有 `api.client-source-url` 拿 visible 源 URL，运行时动态 `import` default export（复用 `ObjectClientRenderer` 链路）。
3. 继承链全程无 visible → **fallback JSON**（保留现有兜底）。

### 改动面
- `ContextSnapshotViewer.tsx`：删除 type switch（:733-769）与 user-defined JSON 分支（:797-805），改调 `resolveWindowVisible` + 渲染（loading/error 边界）。
- 新增前端 builtin visible 静态注册表模块（组织位置见下方待验证项）。
- 后端基本不动：builtin 静态注册无需后端；user-defined 复用 `client-source-url`。

## Part 2 — window method 归 readable（物理分表 b）

### 目标
window method（控制展示）作为独立类别，由 readable 维度注册；与 object method（控制 object 自身，归 executable）物理分离。两者**函数签名不同**：window method 额外接收一个 window 状态对象。

### window 状态对象（display state）—— 设计核心
- 新概念 **`WindowState`**：持有 window 的展示参数（viewport 行列范围 / transcript range / results range / history range 等）。逻辑上与 window 的业务数据（file path、program history…）**分离**。
- **持久化**：作为 window 的一部分存于 thread-context 文件（`thread.contextWindows`）；现有散落字段（`window.viewport` 等，见 `file/readable.ts:39`）归拢为统一 state 对象（存放形态见待验证项）。
- **协作闭环**：window method 写 state → 持久化到 thread-context → readable 读 state 构造输出 → LLM 看到新展示。state 是 window method 与 readable 共享的契约，这正是二者同归展示维度（readable）、与业务维度（executable）分开的根据。

### 结构
- **window method 独立类型 `WindowMethod`**：签名不同于 `ObjectMethod`——在 object method 入参基础上**额外接收 window 状态对象**，读写展示参数而非业务数据。`ObjectDefinition` 新增 `windowMethods?: Record<string, WindowMethod>` 归 **readable**；`methods: Record<string, ObjectMethod>` 保留为 object method 归 **executable**。
- **readable 签名**：`RenderContext` 提供 window 状态对象，readable 据它构造输出（替代当前直接读 `window.viewport`）。
- **迁移**：builtin 把 `set_viewport` / `set_range` / `set_transcript_window` / `set_results_window` / `set_history_window` 从 `methods` 移到 `windowMethods`，签名改为 `WindowMethod`（接 window state）。
- **dispatch**：exec 按名查两表；命中 windowMethod 时注入对应 window 状态对象再执行。可见性过滤复用 `filterMethodsByVisibility`（self/peer/ui 三档对两表同样适用）。
- **概念文档**：`meta/object.doc.ts` readable 节点收编"注册 window method + 持有 window 状态对象 控制展示"职责；executable 节点明确"只管 object method（业务数据）"。改后 `bun tsc --noEmit` 验证。

### 两 Part 呼应
window 的 visible 组件（Part 1）上可暴露调用 windowMethod（Part 2）的交互控件——如 viewport 行列调节器——经 `for_ui_access` 走 `POST /api/objects/:id/exec`。visible 渲染 + readable 控制方法在 window 上合体，落地"window 即交互对象"。

## 测试

- **Tier A 控制面（CI gate，零真 LLM）**：
  - window 渲染解析：builtin（静态命中）+ user-defined（动态加载命中）+ 继承链回退 + JSON 兜底。
  - windowMethods dispatch：set_viewport 经新分表正确执行、改 window 字段、下轮 readable 按新字段渲染。
  - 可见性：windowMethods 的 self/peer/ui 过滤。
- **storybook**：更新 `visible` / `readable` story + spec，反映 window 级 visible 渲染与 window method 归属。
- **Tier B agent-native**：可选——agent 对 user object 写 visible 后，在 thread_context 视图自渲染验证。

## 待验证 / 风险

1. **window 定位信息**：window 是否携带足够字段（objectId + scope: stone/flow + sessionId/page）供 `client-source-url` 反解到 source object。实现首步先验证；不足则需后端 enrich window。
2. **命名冲突策略**：`windowMethods` 与 `methods` 同名时的优先级/禁止规则——倾向**禁止重名**（注册期校验报错），保持 exec 名字全局唯一。
3. **builtin 静态注册表位置**：前端 `web/` 内集中模块 vs builtins 包各自导出再聚合。倾向前端一处聚合，避免 builtins 包反向依赖 web。
4. **继承链解析一致性**：前端 `resolveWindowVisible` 的回退顺序须与后端 `effectiveVisibleType` 语义一致，避免双解析漂移。
5. **window 状态对象存放形态**：window 顶层独立子字段（如 `window.state`）vs 现有散落字段（`viewport` / `transcriptViewport` / `resultsViewport` / `historyViewport` …）就地归拢；以及无展示状态的 window 类型是否允许 state 缺省。倾向统一收口到一个具名子字段，迁移期对旧字段做兼容读取。

## 落地拆分

两条独立线，可分派对应 AgentOfX：
- **线 A（visible / 前端）**：Part 1 解析层 + ContextSnapshotViewer 改造 + 静态注册表。
- **线 B（readable + executable / 后端）**：Part 2 `windowMethods` 分表 + builtin 迁移 + exec dispatch + object.doc.ts 概念收编。

线 B 的概念归属（readable 收编 window method）是 Supervisor 设计裁决，须先于 builtin 迁移落 doc。

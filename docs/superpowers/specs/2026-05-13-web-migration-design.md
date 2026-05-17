# Web Migration Design

**Date:** 2026-05-13

**Scope:** 在当前仓库初始化独立 `web/` 前端项目，参考 `~/x/ooc/ooc-0/kernel/web` 的网站架构与视觉组件，迁移一个最小可用 Web 控制面：flows / stones 目录树展示、create session、chat 会话、文件查看。同时在 `src/app/server` 增加最小 Web 支撑 API，补齐当前服务端缺失但本轮 UI 必需的目录树与文件读取能力。

---

## 背景

当前重构目标要求文档与代码同步，并避免机械搬运旧系统。旧 Web 项目已经具备较完整的网站结构：

- 左侧网站边栏：Logo、Tab、session list、文件树
- 中央内容区：欢迎页、路径内容、文件/视图展示
- 右侧或主区 Chat：面向当前 session 的对话
- 组件资产：`OocLogo`、`MainLogo`、`FileTree`、基础 UI 样式

但旧 Web 依赖大量旧服务端接口和旧运行时模型。当前 `ooc-2` 的 `src/app/server` 已经提供新的控制面 API，但它的边界更小、更明确，尚未提供旧 Web 所需的聚合接口、SSE、Kanban、分组配置、完整 FlowData 等能力。

因此本次迁移采用“保留网站骨架与核心交互，重写最小 API 适配”的方式，而不是复制旧 Web 的全部功能。

---

## 已确认决策

1. Web 项目位置使用顶层 `web/`。
   - 原因：最接近旧项目 `kernel/web` 的边界。
   - 避免 React/Vite/Tailwind 的 `tsconfig`、依赖和根目录 Bun 服务端混在一起。

2. 允许在 `src/app/server` 增加最小 Web 支撑 API。
   - 只补本轮 UI 必需接口。
   - 不恢复旧 Web 的全量后端接口。
   - 不引入新的隐式状态迁移。

3. 本轮按方案 A 推进：最小可用迁移。
   - 复用旧网站布局和可独立组件。
   - 重写 `transport + domain query`、Chat、FileViewer。
   - 后端补目录树、文件读取、session 列表等最小能力。

---

## 目标

本次迁移完成后，用户应能通过新 Web UI 完成以下操作：

1. 查看 `flows` 列表。
2. 查看 `stones` 列表。
3. 在左侧以目录树方式浏览 `flows` / `stones` 文件结构。
4. 创建一个 session。
5. 为 session 创建入口 object，并发送初始消息。
6. 在已有 session 的 root thread 上继续 chat。
7. 查看 thread 内容与普通文件内容。

同时，文档中必须能明确说明：

- 新 Web 为什么存在。
- 它依赖哪些服务端接口。
- 它复用了旧 Web 的哪些部分。
- 它主动放弃了旧 Web 的哪些复杂能力。

---

## 非目标

本轮不迁移下列能力：

- 旧 Web 的 Kanban / Issue / Task 页面。
- 旧 Web 的 SSE 实时流式事件系统。
- 旧 Web 的 flow groups / stone groups 配置编辑。
- 旧 Web 的复杂 `FlowData` 聚合模型。
- 旧 Web 的 `ViewRegistry` 动态 UI 全量能力。
- 旧 Web 的 `ooc://` 链接预览。
- 旧 Web 的 Command Palette。
- 旧 Web 的 MemoryStats、traits、edit plans、context visibility 等附加视图。
- 旧接口 `POST /api/talk/:target` 的兼容层。

这些能力不是否定价值，而是暂不进入本轮最小 Web 闭环。后续是否迁移，应先在 `meta/app/web` 中定义职责和边界，再进入实现。

---

## 前端架构

新增独立前端项目。目录不采用旧 Web 的 `api/ + components/ + features/ + store/` 技术分层，而采用 `app + domains + transport + shared` 的概念边界：

```text
web/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx
    ├── styles.css
    ├── app/
    │   ├── index.tsx
    │   ├── shell.tsx
    │   ├── routes.ts
    │   ├── state.ts
    │   └── layout/
    │       ├── AppLayout.tsx
    │       ├── Sidebar.tsx
    │       ├── MainPanel.tsx
    │       └── RightPanel.tsx
    ├── domains/
    │   ├── flows/
    │   │   ├── index.ts
    │   │   ├── model.ts
    │   │   ├── query.ts
    │   │   ├── components/
    │   │   │   ├── FlowList.tsx
    │   │   │   └── FlowTree.tsx
    │   │   └── adapter.ts
    │   ├── stones/
    │   │   ├── index.ts
    │   │   ├── model.ts
    │   │   ├── query.ts
    │   │   ├── components/
    │   │   │   ├── StoneList.tsx
    │   │   │   └── StoneTree.tsx
    │   │   └── adapter.ts
    │   ├── chat/
    │   │   ├── index.ts
    │   │   ├── model.ts
    │   │   ├── query.ts
    │   │   ├── policy.ts
    │   │   ├── components/
    │   │   │   ├── ChatPanel.tsx
    │   │   │   ├── ChatComposer.tsx
    │   │   │   └── ThreadTimeline.tsx
    │   │   └── formatter.ts
    │   ├── files/
    │   │   ├── index.ts
    │   │   ├── model.ts
    │   │   ├── query.ts
    │   │   ├── components/
    │   │   │   ├── FileTree.tsx
    │   │   │   └── FileViewer.tsx
    │   │   └── formatter.ts
    │   └── sessions/
    │       ├── index.ts
    │       ├── model.ts
    │       ├── query.ts
    │       ├── policy.ts
    │       └── components/
    │           ├── SessionCreator.tsx
    │           └── SessionList.tsx
    ├── transport/
    │   ├── http.ts
    │   ├── errors.ts
    │   └── endpoints.ts
    ├── shared/
    │   ├── brand/
    │   │   ├── MainLogo.tsx
    │   │   └── OocLogo.tsx
    │   ├── ui/
    │   │   ├── Button.tsx
    │   │   ├── EmptyState.tsx
    │   │   ├── Loading.tsx
    │   │   └── MarkdownContent.tsx
    │   └── utils/
    │       ├── cn.ts
    │       └── time.ts
    └── test/
        ├── fixtures.ts
        └── render.tsx
```

前端结构保留旧 Web 的网站骨架：

- `app/`：Web 主干入口，组织整体三栏布局、tab / route 规则与全局选中态。
- `domains/flows`：负责 flow session 列表和 flow 目录树。
- `domains/stones`：负责 stone 列表和 stone 目录树。
- `domains/sessions`：负责 session 创建入口、默认 object 选择和 session 级动作规则。
- `domains/chat`：负责 create / continue chat 的前端动作编排和 thread timeline 展示。
- `domains/files`：负责目录树、文件读取和文件内容格式化展示。
- `transport/`：集中 HTTP 请求、endpoint 拼接和错误解析，组件不直接 `fetch`。
- `shared/`：只放真正跨 domain 的无业务组件，例如 Logo、基础 UI 与通用工具。

目录治理原则：

- 主干概念集中：`app/shell.tsx` 和 `app/layout/*` 是阅读入口，不混入 API、formatter、protocol 噪音。
- 旁生概念下沉：`adapter.ts` 处理服务端响应到前端模型的映射，`formatter.ts` 处理展示格式，`query.ts` 处理读取副作用。
- 状态语义集中：`sessions/policy.ts` 管 sessionId 生成和默认入口 object，`chat/policy.ts` 管 create / continue chat 的前端动作规则。
- 副作用边界清楚：网络副作用只通过 `transport/` 和各 domain `query.ts`，避免组件、layout、formatter 各自拼请求。
- 同名目录升级：`chat`、`files`、`flows`、`stones`、`sessions` 都是稳定子系统，不继续塞进一个平铺 `features/` 目录。

本轮前端不保留旧 Web 中依赖旧 `FlowData.subFlows/process/messages` 聚合模型的复杂组件。需要展示 thread 时直接读取当前 root thread JSON，并在 UI 中按 `inbox` 与 `events` 的实际结构做最小呈现。

---

## 服务端架构

当前服务端保留 `src/app/server` 的 feature-based 结构与 one api per file 约束。新增一个最小模块，建议命名为 `web`：

```text
src/app/server/modules/ui/
├── index.ts
├── service.ts
├── model.ts
├── api.list-flows.ts
├── api.get-tree.ts
└── api.get-file.ts
```

职责边界：

- `ui` 模块只提供 UI 文件浏览与 session 列表所需的 read-only 能力。
- session 创建、object 创建、thread continue 仍复用现有 `flows` 模块。
- stone 创建、stone 基础信息仍复用现有 `stones` 模块。
- runtime job 查询仍复用现有 `runtime` 模块。

安全约束：

- 所有文件路径必须限制在 `config.baseDir` 内。
- `path` 参数必须规范化，拒绝 `..` 逃逸。
- 文件读取默认只读文本；二进制文件返回不可预览或 base64 支持不进入本轮。
- 缺失文件或目录返回明确失败，不返回误导性的 `ok: true`。

---

## API 设计

### 已有 API

本轮前端直接复用：

- `GET /api/stones`
  - 返回当前 world 下的 stone 列表。
- `POST /api/flows/`
  - 创建 session。
- `POST /api/flows/:sessionId/objects/`
  - 在 session 中创建 flow object，可带 `initialMessage`。
- `GET /api/flows/:sessionId/objects/:objectId/threads/:threadId`
  - 读取 thread。
- `POST /api/flows/:sessionId/objects/:objectId/threads/:threadId/continue`
  - 向 thread 追加用户消息并入队运行。
- `GET /api/runtime/jobs/:jobId`
  - 轮询异步 job 状态。

### 新增 API

#### `GET /api/flows`

列出 `baseDir/flows` 下的 session。

响应示例：

```json
{
  "items": [
    {
      "sessionId": "debug-1778604478264",
      "title": "Debug Chat",
      "dir": "/abs/world/flows/debug-1778604478264",
      "createdAt": 1778604478264,
      "updatedAt": 1778604480000
    }
  ]
}
```

说明：

- `title` 优先读取 `.session.json`。
- 时间字段可来自目录 stat。
- 不合成旧 Web 的 `FlowSummary.status/messageCount/actionCount`，避免虚构状态。

#### `GET /api/tree`

读取 world 内目录树。

Query：

- `scope`: `world | flows | stones`
- `path`: 可选，相对于 scope root 的路径

响应示例：

```json
{
  "name": "flows",
  "type": "directory",
  "path": "flows",
  "children": [
    {
      "name": "debug-1778604478264",
      "type": "directory",
      "path": "flows/debug-1778604478264",
      "marker": "flow"
    }
  ]
}
```

说明：

- `scope=flows` 的 root 是 `baseDir/flows`。
- `scope=stones` 的 root 是 `baseDir/stones`。
- `scope=world` 的 root 是 `baseDir`。
- marker 只保留 `flow` 和 `stone` 两类最小语义。

#### `GET /api/tree/file`

读取 world 内文件内容。

Query：

- `path`: 相对于 `baseDir` 的文件路径，例如 `flows/s1/objects/assistant/threads/root/thread.json`

响应示例：

```json
{
  "path": "flows/s1/objects/assistant/threads/root/thread.json",
  "content": "{...}",
  "size": 1234
}
```

说明：

- 只读文件，不写文件。
- 文件不存在返回 `NOT_FOUND`。
- 路径逃逸返回 `INVALID_INPUT`。

---

## Chat 流程

### 创建 session

前端流程：

1. 用户选择入口 object，默认使用已有第一个 stone；若没有 stone，UI 显示需要先创建 stone。
2. 前端生成 sessionId，或由用户输入。
3. 调用 `POST /api/flows/` 创建 session。
4. 调用 `POST /api/flows/:sessionId/objects/` 创建 flow object，并传入 `initialMessage`。
5. 如果返回 `jobId`，轮询 `GET /api/runtime/jobs/:jobId`。
6. 读取 `GET /api/flows/:sid/objects/:oid/threads/root` 并渲染 thread。

### 继续 chat

前端流程：

1. 用户在当前 session / object / root thread 下输入消息。
2. 调用 `POST /api/flows/:sid/objects/:oid/threads/root/continue`。
3. 如果返回 `jobId`，轮询 job。
4. 再读取 root thread 并刷新 ChatPanel。

### Chat 展示

本轮只做 thread 的最小真实展示：

- `thread.inbox` 中的消息展示为用户输入。
- `thread.events` 中可识别的文本事件展示为 assistant / action。
- 不能识别的事件以折叠 JSON 或简化 action card 展示。

不把旧 Web 的 `FlowMessage` / `Action` 旧类型强行套到新 thread 模型上。

---

## 文件查看流程

用户点击目录树中的 file node 后：

1. 前端保存 `activePath`。
2. 调用 `GET /api/tree/file?path=...`。
3. 中央 `FileViewer` 显示内容。

渲染策略：

- `.md`：Markdown 渲染。
- `.json`：格式化 JSON；解析失败则原文显示。
- 其他文本：`pre` 只读显示。
- 大文件或二进制文件：显示不可预览提示。

---

## 文档映射

需要新增 `meta/app/web/index.doc.js`：

```text
meta/app/web/index.doc.js
```

文档职责：

- 说明 Web 是 OOC app 层的浏览和人工操作入口。
- 说明它不拥有核心业务状态，只调用 app server。
- 说明本轮 Web 只覆盖最小控制面闭环。
- 引用 `web/src/*` 与 `src/app/server/modules/ui/*`。

需要更新：

- `meta/app/index.doc.js`
  - 将 `web` 与 `server` 并列纳入 app tree。
- `meta/index.doc.js`
  - 保持顶层 app tree 可追踪。

---

## 从旧系统保留什么

保留：

- 网站左边栏 + 主内容 + Chat 区域的整体架构。
- `Logo / Sidebar / FileTree` 的视觉与交互基调。
- flows / stones / world 这种信息架构。
- 文件树点击后在主区查看内容的交互。

简化：

- 去掉旧 Web 的复杂 ViewRegistry 动态视图系统。
- 去掉旧 Web 的 SSE 流式状态和复杂状态同步。
- 去掉旧 Web 的 Kanban、Issue、Task 等协作外围能力。
- 去掉旧 Web 对旧 `FlowData` 聚合模型的依赖。

删除：

- 旧 `/api/talk/:target` 适配。
- 旧分组配置 `.flows.json` / `.stones.json` 编辑入口。
- 旧对象详情页中依赖 traits / memory / views 的多 tab 页面。

---

## 验证策略

### 前端构建验证

在 `web/` 下运行：

```bash
bun install
bun run build
```

成功标准：

- TypeScript 编译通过。
- Vite 构建通过。

### 服务端测试

新增或扩展 app server route/service 测试：

```bash
bun test src/app/server
```

需要覆盖：

- `GET /api/flows` 空目录与有 session 的情况。
- `GET /api/tree` 对 `flows/stones/world` 的目录树读取。
- `GET /api/tree/file` 正常读取、缺失文件、路径逃逸。

### 真实链路验证

启动 app server 指向一个测试 world：

```bash
bun --env-file=.env src/app/server/index.ts --world .ooc-world-test
```

再启动 `web` dev server：

```bash
cd web
bun run dev
```

手动或脚本验证：

- 打开 Web 页面能看到 stones / flows。
- 能创建 session。
- 能发送初始消息。
- 能继续 chat。
- 能打开并查看 `thread.json` 或普通文本文件。

---

## 成功标准

本次迁移完成后应满足：

1. `web/` 是独立、可构建的 Vite React 项目。
2. 新 Web 复用旧项目的 Logo、网站侧边栏结构与 FileTree 基础组件。
3. 新 Web 能通过当前 `src/app/server` 的真实 API 展示 flows / stones 目录树。
4. 新 Web 能创建 session、发送初始消息、继续 root thread chat。
5. 新 Web 能查看 world 内文本文件。
6. `src/app/server` 新增 API 有明确边界，不兼容旧 Web 全量接口。
7. `meta/app/web` 文档引用对应前端与服务端实现，避免孤儿文档或孤儿代码。
8. 相比旧 Web，本轮迁移减少依赖面和状态模型，不引入旧系统的复杂外围能力。

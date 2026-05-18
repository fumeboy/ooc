# Web 路由层（react-router v7）+ FileTree 接入 ObjectClientRenderer plan

> **状态**：drafting（v2 — 改用 react-router v7）
> **范围**：(1) 主 web app 内识别 client tsx 路径并渲染自定义 UI；
> (2) 引入 react-router v7（library mode）让浏览器 URL 与导航状态联动，并
> 顺势把 336 行的 shell.tsx 按 route 拆成多个 page 组件
> **前置**：plan `2026-05-18-002` 已交付（ObjectClientRenderer 在独立预览页可用）
> **决策变更**：v1 选择手卷路由 + 不引依赖；v2 改用 react-router v7。
> 理由：扩展（ooc:// 接入、嵌套布局、未保存改动拦截、Cmd+Click 等浏览器细节）
> 远比"少 20kb 依赖"重要；shell.tsx 顺势拆小后比手卷 150 行薄壳更易维护。

---

## 1. 目标

把 client 元编程闭环接入到日常使用路径：

- **能力 1：FileTree 联动**
  - 点击 `stones/{id}/client/index.tsx` → 主区域渲染 stone client（默认）
  - 点击 `flows/{sid}/objects/{oid}/client/pages/{page}.tsx` → 主区域渲染 flow page
  - 同一节点上可切 tab 看源码，方便排查 Object 写错时
  - 其它 .tsx / .ts / .md 等仍走现有 FileViewer，不动

- **能力 2：react-router v7 接入 + URL ↔ state 联动**
  - URL 反映当前导航位置（scope / 选中文件 / session+thread）
  - 浏览器前进 / 后退 / 直接粘贴 URL 都到位
  - 嵌套 `<Outlet />` 实现 Sidebar/Main/Right 三栏布局复用
  - 用 loader 把现有 `useEffect([route])` 取数据的逻辑收敛
  - 顺势把 shell.tsx 按 route 拆成 4-5 个 page 组件
  - 为 `ooc://client/...` 与 `[navigate]` 链接（下一轮接）留好可达目标

**不**做的事：

- 不引 react-router 的 "framework mode"（Remix 风格 file-based routing） ——
  与现有 Vite 配置冲突；library mode + `createBrowserRouter` 即可
- 不接 `ooc://` 链接协议解析（doc todo 第 1 项；本轮只把 URL 形态定下来）
- 不重构 shell.tsx 的 transient 状态（loading / error / fileDirty / 弹窗 draft
  仍 useState；只把"导航维度"挪到 URL）
- 不做 sandbox 隔离（与现有 ObjectClientRenderer 同档，in-process）
- 不做生产 build（依赖 Vite dev `/@fs/`；与 plan-002 同档）

---

## 2. 既有约束（不能破坏）

1. **`shell.tsx` 当前 useState 导航维度**：`scope` / `activePath` / `activeFile` /
   `activeSessionId` / `activeObjectId` / `activeThreadId` / `sessionThreads`
   —— 本轮 URL 成为导航源；state 退化为缓存
2. **FileTree 的 `selectedPath` prop**：是 "world 根下的相对路径"，URL 沿用同一
   字符串协议，避免双套
3. **scope 与 activePath 现状**：scope 控制左侧树 root（`flows` / `stones` /
   `world`）；activePath 与 scope 不强绑定。新 URL 设计让 scope 由路径前缀派生
4. **ObjectClientRenderer 已有 props**：`{ scope, objectId, sessionId?, page? }`
   —— FileTree / 路由解析时按规则解出四元组
5. **`web/object-client.html`** 独立预览页保留 —— Playwright 测试入口 +
   minimal 重现路径
6. **`concept-links.test.ts`**：本轮不动 meta/doc 的 sources 锚点
7. **现有 5 个 Playwright e2e (FC1-FC5)** 必须继续通过 —— ObjectClientRenderer
   行为不变

---

## 3. 设计选择

### 3.1 触发"渲染 client UI"的路径匹配

| 路径模式 | 派生 target |
|---|---|
| `^stones/([^/]+)/client/index\.tsx$` | `{ scope: "stone", objectId: $1 }` |
| `^flows/([^/]+)/objects/([^/]+)/client/pages/([A-Za-z0-9_-]+)\.tsx$` | `{ scope: "flow", sessionId, objectId, page }` |

严格匹配，不接 `client/components/*.tsx` 等子目录。不匹配 → 走 FileViewer
显示源码（保现状）。

### 3.2 渲染 / 源码切 tab

MainPanel 头部条件渲染微 tab 条 `[ 已渲染 | 源码 ]`：

- 仅命中 §3.1 时出现
- 默认 "已渲染"，切 "源码" 走 FileViewer
- **切换用 CSS `display:none`，不卸载** —— 保住 React 内部 state（按钮 click
  计数器不归零；调试 friendly）
- tab 选择**不入 URL**（D1）—— 纯 transient

### 3.3 URL scheme

path-based 路由，与 ooc:// 协议对齐。

```
/                                                      Welcome
/welcome                                               Welcome（显式形态）

/files/<world-relative-path>                           通用文件视图
                                                         匹配 §3.1 时默认"已渲染"
/stones                                                stones scope 根（树视图）
/stones/<objectId>                                     shortcut →
                                                         /files/stones/<id>/client/index.tsx
/flows                                                 flows scope 根（session list）
/flows/<sid>                                           进 session（默认 user.root）
/flows/<sid>/threads/<oid>/<tid>                       特定 thread chat
/flows/<sid>/objects/<oid>/pages/<page>                shortcut →
                                                         /files/flows/<sid>/objects/<oid>/client/pages/<page>.tsx
```

shortcut 路由作为"规范化输出"：navigate 时优先输出短形态；FileTree click 产生
长形态 URL 后 redirect 到短形态。

### 3.4 react-router v7 引入方式

**库形态**（不是 framework mode）。安装：

```bash
bun add react-router
```

**注意 v7 包名变化**：v6 的 `react-router-dom` 在 v7 合并到 `react-router`，
单包就够。Vite + 现有 React 19 完全兼容。

**路由树结构**：

```tsx
// web/src/app/routes.tsx
import { createBrowserRouter } from "react-router";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,           // 三栏壳 + <Outlet />
    errorElement: <RouteErrorBox />,
    children: [
      { index: true, element: <WelcomePage /> },
      { path: "welcome", element: <WelcomePage /> },

      // 通用文件视图（FileTree click 落点）
      {
        path: "files/*",
        element: <FilePage />,
        loader: filePageLoader,         // 异步 fetch file 内容
      },

      // stones
      {
        path: "stones",
        element: <ScopePage scope="stones" />,
      },
      {
        path: "stones/:objectId",
        element: <StoneClientPage />,   // 默认 ObjectClientRenderer
      },

      // flows
      {
        path: "flows",
        element: <ScopePage scope="flows" />,
      },
      {
        path: "flows/:sessionId",
        element: <SessionPage />,
        loader: sessionLoader,
      },
      {
        path: "flows/:sessionId/threads/:objectId/:threadId",
        element: <ThreadPage />,
        loader: threadLoader,
      },
      {
        path: "flows/:sessionId/objects/:objectId/pages/:page",
        element: <FlowPagePage />,      // 默认 ObjectClientRenderer
      },
    ],
  },
]);
```

`main.tsx` 用 `RouterProvider`：

```tsx
import { RouterProvider } from "react-router";
import { router } from "./app/routes";

createRoot(...).render(<RouterProvider router={router} />);
```

### 3.5 数据加载用 loader（替代部分 useEffect）

react-router v7 的 loader 是"路由匹配后、组件渲染前并行调用"。把现有
`useEffect([route])` 中的取数据逻辑迁过来：

| 现 useEffect 逻辑 | 迁到哪 |
|---|---|
| `fetchFile(path)` | `filePageLoader({ params })` |
| `fetchThread(sid, oid, tid)` + `fetchSessionThreads(sid)` | `threadLoader` |
| `fetchFlows()` + `fetchStones()` + `fetchTree(scope)` | `rootLoader`（AppLayout 上）+ revalidate 时机控制 |

组件用 `useLoaderData<typeof loader>()` 拿数据，不再 setState。loading 状态由
react-router 的 `useNavigation()` 给出。

**Transient state 仍 useState**：fileDirty / 弹窗 draft / pauseBusy / showSessions
/ mode tab —— 这些与 URL 无关。

### 3.6 共享布局（关键收益）

AppLayout 作为父路由，提供：

```tsx
function AppLayout() {
  const { stones, flows, tree, scope } = useLoaderData<typeof rootLoader>();
  return (
    <div className="app">
      <Sidebar scope={scope} flows={flows} tree={tree} ... />
      <Outlet />                       {/* 子路由插入位 */}
      <RightPanel ... />               {/* 条件渲染：thread 路由时才显示 */}
    </div>
  );
}
```

子页面（WelcomePage / FilePage / StoneClientPage / SessionPage / ThreadPage /
FlowPagePage）只关心 main 区域内容。

### 3.7 Link 替代 onClick

FileTree / SessionList / ThreadHeader 等组件原来 `onClick={() => navigate(...)}`：

- 改成 `<Link to={...}>` 包按钮 / 行
- Cmd+Click 自动在新 tab 打开，鼠标中键同理 —— 不用手写
- onSelect 回调形态保留作 fallback（FileTree 可两支并存，渐进迁移）

### 3.8 为 ooc:// 链接预留

下一轮接 ooc:// 时，写个 `<OocLink>` 包 `<Link>`：

```tsx
function OocLink({ href, children }) {
  const path = parseOocHref(href);  // ooc://client/stones/foo/ → /stones/foo
  return path ? <Link to={path}>{children}</Link> : <span>{children}</span>;
}
```

本轮路由表已经把 `/stones/:id` 与 `/flows/:sid/objects/:oid/pages/:page` 设好，
ooc:// 解析就是 1:1 字符串映射，无需改路由。

---

## 4. 实施分层

### 层 1 — 安装依赖 + 最小 router 接入

- `cd web && bun add react-router`（注意 v7 单包，不要装 `react-router-dom`）
- 新增 `web/src/app/routes.tsx`：只配一个 `/` → 现有 `<AppShell />`（包一层
  RouterProvider，行为不变）
- `main.tsx` 换成 `RouterProvider`

**判据**：浏览器打开正常，与改造前视觉无差异；shell.tsx 仍 useState 主导
（router 这一层先存在）

### 层 2 — ClientWithSourceToggle + MainPanel 改造（独立于 router）

- 新建 `web/src/domains/clients/ClientWithSourceToggle.tsx`：
  - props: `{ target: ClientTarget; sourcePath: string }`
  - 内部 useState `mode`，CSS 切换两个子视图（不卸载）
- MainPanel 加 prop `clientTarget?: ClientTarget`：命中时渲染
  ClientWithSourceToggle，否则原 FileViewer
- shell.tsx 内 `handleNode` 判 path 是否命中 §3.1，命中则 setState 出 clientTarget

**判据**：
- 这一步**完全不依赖 router**，独立可验证
- 点 `stones/<id>/client/index.tsx` 主区域出现渲染 + tab
- 切 source 看到源码 + 再切回保留组件 state

### 层 3 — 拆 AppShell → AppLayout + per-route Page 组件

最有结构性的改动。按 §3.4 路由表新建文件：

```
web/src/app/
├── routes.tsx                  路由表
├── layouts/
│   └── AppLayout.tsx           三栏壳 + <Outlet />；调 rootLoader
├── pages/
│   ├── WelcomePage.tsx
│   ├── FilePage.tsx            走 filePageLoader；命中 §3.1 时挂 ClientWithSourceToggle
│   ├── StoneClientPage.tsx     shortcut；直接 ObjectClientRenderer
│   ├── FlowPagePage.tsx        shortcut；直接 ObjectClientRenderer
│   ├── ScopePage.tsx           scope=stones | flows | world 时只显示树
│   ├── SessionPage.tsx         走 sessionLoader
│   └── ThreadPage.tsx          走 threadLoader
└── loaders/
    ├── root-loader.ts          fetchFlows + fetchStones + fetchTree
    ├── file-loader.ts          fetchFile(path)
    ├── session-loader.ts       fetch flows + 默认 user.root thread
    └── thread-loader.ts        fetchThread + fetchSessionThreads
```

迁移策略（缓解 §8 风险 A）：
- shell.tsx 暂时保留作为 "legacy fallback"，新 Page 组件先接管 / 路由
- 一个 page 一个 page 迁；每迁一个跑一次 e2e
- 全部迁完后删除 shell.tsx

**判据**：
- 每个 Page 组件 < 80 行（vs 336 行单体 shell.tsx）
- Sidebar / RightPanel 不再传 N 个 prop —— 走 useLoaderData + useParams
- 浏览器前进 / 后退、刷新都到位

### 层 4 — Link 化 + shortcut 规范化

- FileTree onSelect 保留 + 新增 `to` prop 让外层包 `<Link>`
- SessionList 行变 `<Link to={`/flows/${sid}`}>`
- ThreadHeader switcher 同理
- `parseRoute` 思路体现在两个地方：
  - 路由表自己负责"长 URL → page 组件"
  - 一个小工具 `canonicalize(path)`：FileTree 点击产生 `/files/stones/<id>/client/index.tsx`
    时 navigate 前转成 `/stones/<id>`
  - 用 `<Navigate to=... replace />` 在 `files/*` page 内做服务端式 redirect 也行；
    两种思路任选

**判据**：
- Cmd+Click stones tree 项 → 新 tab 开 stone 渲染页
- 长 URL `/files/stones/alan/client/index.tsx` 在地址栏自动收敛为 `/stones/alan`
- `routeMatch + path` round-trip 单测覆盖（不必用 react-router 内部 API，黑盒
  `navigate(input)` → `location.pathname` 断言即可）

### 层 5 — Playwright e2e 新增

`tests/e2e/frontend/frontend-routing-and-client-tree.pw.ts`：

- FR1: 起 stack → 直接打 `/stones/<id>` → 看到 ObjectClientRenderer 渲染
- FR2: `/` 起 → 在 stones tree 点 `client/index.tsx` → URL 变 `/stones/<id>`
- FR3: 命中页 tab 切 "源码" → CodeMirror 展示 tsx；切回 "已渲染" 保留 button
  click 计数（验 §3.2 不卸载）
- FR4: 浏览器后退键 → URL + UI 同步回到上一个状态
- FR5: 错 URL `/stones/does-not-exist` → 红色错误块（404 fallback "信息待产出..."
  或 errorElement，取看实现）

**判据**：FC1-FC5（plan-002）+ FR1-FR5（本轮）全绿。

### 层 6 — doc 同步

更新 `meta/object/executable/client/index.doc.ts` 的 `implementationStatus`：
- delivered 段加：routing layer (react-router v7) + FileTree 集成
- todo 段：删原 1（oocLinks 路由对齐已完成）+ 删 2（主 app 接入已完成）；
  保留 3-5
- oocLinks 段：备注"URL 结构已实现并对齐；仅缺 ooc:// → /stones/... 解析"

---

## 5. 执行顺序

| 步骤 | 模块 | 大小 | 依赖 |
|---|---|---|---|
| 1 | 装 react-router + 最小 RouterProvider 包壳 | 极小 | 无 |
| 2 | ClientWithSourceToggle + MainPanel 接 prop | 小 | 无 |
| 3 | AppLayout + 第一个 page（WelcomePage） + rootLoader | 小 | 1 |
| 4 | FilePage + ScopePage（覆盖 80% FileTree 点击场景） | 中 | 3 |
| 5 | StoneClientPage + FlowPagePage（shortcut 路由） | 小 | 4 |
| 6 | SessionPage + ThreadPage（chat 场景） | 中 | 3 |
| 7 | Link 化 + 长→短 URL 规范化 | 小 | 5, 6 |
| 8 | 删除 shell.tsx（确认所有路径已被 page 覆盖） | 极小 | 7 |
| 9 | Playwright FR1-FR5 e2e | 小 | 2-7 |
| 10 | doc 同步 | 极小 | 9 |

每步可独立 commit；step 8 是"清旧"，前面每步加新（route 已并存）。

---

## 6. 已敲定的设计选择

| # | 问题 | 决策 |
|---|---|---|
| D1 | tab 选择是否入 URL | 否；纯 transient（§3.2） |
| D2 | 点目录节点是否 navigate | 否；只展开（保现状） |
| D3 | 单测策略 | router 行为靠 e2e；page 组件用 vitest/bun:test 单独 unit |
| D4 | 切 source tab 是否重新 fetch | 首次 fetch；后续 useState 缓存；URL 变即缓存失效 |
| D5 | 切回 render tab 是否保留组件 state | 是（CSS display:none，不 unmount） |
| D6 | Welcome 路径 | `/` 与 `/welcome` 都接受；navigate 输出 `/` |
| D7 | 未知 URL | react-router `errorElement` 渲红块 + "回首页"链接 |
| D8 | sid / objectId 不存在 | 不在 URL 层校验；loader 抛 → errorElement 显示 |
| D9 | `/object-client.html` 是否保留 | 保留（Playwright + minimal 重现） |
| D10 | react-router 版本 | v7（单包 `react-router`，不装 `react-router-dom`） |
| D11 | framework mode vs library mode | library；createBrowserRouter + RouterProvider |
| D12 | loader 错误处理 | 抛 → 同 errorElement 路径（与 D7 共用） |
| D13 | shell.tsx 是否保留 | 全部迁完即删（step 8） |

---

## 7. 完成判据

1. `bun add react-router` 完成；`web` 启动正常
2. 全套 plan-002 e2e（FC1-FC5）继续通过
3. 新 e2e FR1-FR5 全过
4. `bun test` 全套通过；web `bun run build` 类型通过
5. 浏览器手测：
   - 主页 `/` 看 Welcome
   - 点 stones tree → 渲染 client；URL 变 `/stones/<id>`
   - 切 source tab → 看源码；切回 render → 组件状态保留
   - Cmd+Click stones 树项 → 新 tab 打开渲染页
   - 后退键 → URL + UI 同步
   - 错 URL → errorElement 红块
   - 老链接 `/files/stones/<id>/client/index.tsx` 自动收敛为 `/stones/<id>`
6. shell.tsx 已删除（或仅余兼容性 re-export）
7. `meta/object/executable/client/index.doc.ts` `implementationStatus` 已同步

---

## 8. 风险与回滚

- **风险 A：shell.tsx 拆分牵涉广**
  - 旧 shell.tsx 内函数（handleNode / handleSession / handleSend / 弹窗
    handlers）散落在各 page；漏迁会导致功能丢失
  - 缓解：分页迁移期间 shell.tsx 不删，作为 `/legacy` fallback；e2e 全绿后
    一次性删
  - 回滚：每步独立 commit，单步 revert 即可

- **风险 B：loader 与现有 polling useEffect 冲突**
  - 现有 thread polling（4s 一次 fetchThread）在 shell.tsx 内；迁到 ThreadPage
    时要保持
  - 缓解：ThreadPage 内 useEffect 沿用，仅把"首次取数据"迁到 loader

- **风险 C：react-router v7 API 与示例不匹配（v7 较新）**
  - 缓解：库形态 API 与 v6.4+ 基本一致；坚持 library mode 不碰 framework mode
    部分，资料覆盖充足

- **风险 D：v7 包名搞错**
  - v7 单包 `react-router`；装错成 `react-router-dom` 会找不到 `RouterProvider`
  - 缓解：plan §4 层 1 明确写命令；step 1 commit 时核对 package.json

---

## 9. 相对 v1 plan 的变更

| 维度 | v1（手卷） | v2（react-router v7） | 原因 |
|---|---|---|---|
| 路由解析 | 自写 parseRoute + routeToPath + useUrl | createBrowserRouter + route table | 避免重复造 popstate / Cmd+Click / 滚动恢复 |
| 数据加载 | useEffect 监 route 变化 | loader 函数 | 框架并行调，少 race |
| 布局复用 | AppShell 手 render | `<Outlet />` 嵌套 | 声明式 + 父子路由 |
| shell.tsx | 改 navigate 化但保留单体 | 按 route 拆 4-5 个 page | 单文件 336 行 → 平均 ~80 行 / page |
| 单测 | parseRoute 双向 round-trip | 路由行为靠 e2e；page 组件单独 unit | router 内部不必复测 |
| 依赖 | 0 新依赖 | +react-router (~20kb gzip) | 内部 dev 工具不在意；扩展收益大 |
| ooc:// 接入（下轮） | 自己 navigate | `<OocLink>` 包 `<Link>` 3 行 | 路由表已对齐 |

---

## 10. 相对 plan-002 的取舍说明

| 维度 | plan-002 | 本 plan | 原因 |
|---|---|---|---|
| client UI 入口 | 独立预览页 `/object-client.html` | 主 app FileTree + URL 直达 | 002 故意最小入侵；本轮补齐日常路径 |
| URL 表达 | 无 | path-based + react-router v7 | 与 ooc:// 对齐；可分享、可粘贴 |
| 状态源 | 全 useState | URL 是导航源（loader 拉数据）；useState 仅 transient | 防"双重真相"漂移；对齐 meta/app/web 设计原则 §4 |
| ooc:// 协议 | todo | 仍 todo；URL + Link 形态对齐 | 下轮 1:1 字符串映射 + `<OocLink>` |
| shell.tsx | 单体 336 行 | 拆 4-5 个 page，每个 < 80 行 | 单元更小、责任更清晰 |

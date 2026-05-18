import type { Concept, DocNode, ExampleNode } from "@meta/doc-types";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
// client 的真实实现分两端：
//   - 持久化（"client 文件长在哪、怎么读写"）→ src/persistable/stone-client
//   - 前端渲染（"如何把 tsx 拉起来挂上 callMethod"）→ web/src/domains/clients
// 后者在 web/ 子项目，不在本 tsconfig include；前者是 backend 模块，是 client
// 概念在 backend 一侧最稳定的锚点：删/改 stone-client 直接破坏 client 持久化契约。
import * as clientPersistable from "@src/persistable/stone-client";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Client 概念骨架
 * ──────────────────────────────────────────────────────────────── */

export type ClientConcept = Concept & {
  sources: { clientPersistable: typeof clientPersistable };

  /** Stone 与 Flow 的 client 目录组织差异 */
  physicalLayout: {
    title: string;
    summary?: string;
    /** Stone：单页 + 自由内部结构 */
    stoneSinglePage: ExampleNode;
    /** Flow：多页 pages 目录 */
    flowMultiPages: ExampleNode;
    /** 为什么 Stone 用单页、Flow 用多页 */
    layoutRationale: DocNode;
  };

  /** 默认 export 的 React 组件契约 */
  componentContract: ExampleNode;

  /** callMethod 调用走 HTTP /call_method 端点 */
  callMethod: DocNode;

  /** client ↔ server 的协作示意 */
  serverCollab: ExampleNode;

  /** 加载失败的兜底策略 */
  failureFallback: DocNode;

  /** ooc:// 链接协议 */
  oocLinks: ExampleNode;

  /**
   * 当前实现状态 + 与文档差异 + 待办问题。
   *
   * 这一段不是"理想契约"，是"现在跑的是什么 / 哪些字面承诺还没兑现"——读完
   * 这个对象就知道 README 哪里能信、哪里不能信。
   */
  implementationStatus: {
    title: string;
    summary?: string;
    delivered: DocNode;
    deviations: DocNode;
    todo: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const client_v20260506_1: ClientConcept = {
  name: "Client",
  get parent() {
    return executable_v20260504_1;
  },
  sources: { clientPersistable },
  description: `
Client 描述 Object 如何为自己编写前端 React UI 组件。Object 的 client 通过 HTTP
\`/call_method\` 端点调用自己 server 模块导出的 \`ui_methods\`；前端动态加载失败时由
ErrorBoundary 兜底。
`.trim(),

  physicalLayout: {
    title: "物理结构",
    summary: "Stone 与 Flow 的 client 目录组织不同",

    stoneSinglePage: {
      kind: "example",
      title: "Stone：单页 + 自由内部结构",
      summary: "stones/{name}/client/index.tsx 是唯一入口",
      content: `
\`\`\`
stones/{name}/client/
├── index.tsx                  主页（必备，默认 export React 组件）
├── components/                （任意子目录，由 index.tsx 自行引用）
├── lib/
└── ...
\`\`\`

- index.tsx 是唯一入口，必须存在
- 入口下任意子目录 / 文件由 index.tsx 自行 import 与组合，**不强制目录结构**
- 系统只关心 index.tsx——内部如何拆组件、放在哪个目录，是 Object 自己的事
      `.trim(),
    },

    flowMultiPages: {
      kind: "example",
      title: "Flow：多页 pages 目录",
      summary: "flows/{sid}/objects/{id}/client/pages/{name}.tsx 一文件一页",
      content: `
\`\`\`
flows/{sessionId}/objects/{objectId}/client/
└── pages/
    ├── {pageName}.tsx         一个 tsx = 一个页面
    ├── {anotherPage}.tsx
    └── ...
\`\`\`

每个 \`pages/{pageName}.tsx\` 对应一个独立的页面：用户可通过 ooc:// 链接直达单个页面，
不同 pages 之间相互独立，没有强制布局容器。适合"任务报告 / 反馈表单 / 实验结果展示"等
session 内的临时产出。
      `.trim(),
    },

    layoutRationale: {
      title: "为什么 Stone 单页、Flow 多页",
      content: `
Flow 的产出通常是"针对当前任务的若干视图"，每个视图自成一篇报告 / 表单，没必要塞进同一
个 SPA 入口。Stone 是 Object 的长期门面，更适合统一入口下自由组合。
      `.trim(),
    },
  },

  componentContract: {
    kind: "example",
    title: "React 组件契约",
    summary: "默认 export 一个 React 组件，props 至少含 sessionId/objectName/callMethod",
    content: `
\`\`\`tsx
import { useState } from "react";

interface ClientProps {
  sessionId?: string;       // stone 时为 undefined；flow 时为 sessionId
  objectName?: string;      // 对象自身的 objectId
  callMethod?: (method: string, args?: object) => Promise<unknown>;
}

export default function MyView({ sessionId, objectName, callMethod }: ClientProps) {
  const [done, setDone] = useState(false);
  const submit = async () => {
    if (!callMethod) return;
    await callMethod("submitForm", { value: 42 });
    setDone(true);
  };
  return <button onClick={submit}>{done ? "已提交" : "提交"}</button>;
}
\`\`\`

约束：
- 默认 export 一个 React 组件
- props 至少接受 \`{ sessionId?, objectName?, callMethod? }\`
- \`callMethod\` 签名是 \`(method, args) => Promise<unknown>\`——只有 2 个参数；
  当前系统无 trait 维度，不要写成 \`(traitId, method, args)\`
- 渲染失败由前端 ErrorBoundary 兜底，不会让整个页面白屏
    `.trim(),
  },

  callMethod: {
    title: "callMethod",
    summary: "前端调用走 HTTP POST /api/flows/:sid/objects/:name/call_method",
    content: `
调用走 HTTP \`POST /api/flows/:sid/objects/:name/call_method\` 端点，命中本对象 server
模块导出的 \`ui_methods\` 函数索引中的函数。
    `.trim(),
  },

  serverCollab: {
    kind: "example",
    title: "与 server 的协作",
    summary: "client 通过 callMethod 调本对象自己的 server 方法",
    content: `
\`\`\`
stones/alan/
├── client/index.tsx          callMethod("mthAbc", ...)
├── server/index.ts           export const ui_methods = { submit: {...} }
└── knowledge/                描述这些模块的设计意图，给 LLM 看
\`\`\`

详见 executable/server。
    `.trim(),
  },

  failureFallback: {
    title: "失败降级",
    summary: "显式失败：404 → 信息待产出；其它错 → 红色错误块；ErrorBoundary 兜底",
    content: `
前端动态加载 client 组件时若失败：

- 文件不存在（404）→ "信息待产出..."
- 加载 / 渲染错误 → 红色错误块带堆栈与文件绝对路径，便于人工排查
- ErrorBoundary 兜底防止整个页面白屏

**渲染层不耦合 transport**：失败时不会自动 talk 通知 Object。用户看到错误后
自行决定是否把堆栈转发给 Object，避免噪声放大与"stone 无 session 无线程接收"
歧义场景。
    `.trim(),
  },

  oocLinks: {
    kind: "example",
    title: "ooc:// 链接协议",
    summary: "client 可被 ooc:// 链接引用以做单页跳转；URL 形态已就绪，缺解析",
    content: `
\`\`\`
ooc://client/stones/{name}/                                  Stone 主页（client/index.tsx）
ooc://client/flows/{sid}/objects/{name}/pages/{pageName}     Flow 某个页面
\`\`\`

在对话或 talk 消息中，对象可以输出导航链接让用户跳转到具体页面：

\`\`\`
[navigate title="任务报告" description="本次任务的产出"]
ooc://client/flows/s_xyz/objects/alan/pages/report-2026
[/navigate]
\`\`\`

**状态**：本地 URL 形态已实现并对齐（plan-003 §3.3）：

\`\`\`
ooc://client/stones/{name}/                            ↔  /stones/{name}
ooc://client/flows/{sid}/objects/{name}/pages/{page}   ↔  /flows/{sid}/objects/{name}/pages/{page}
\`\`\`

缺的只是把 \`ooc://...\` 字符串解析为本地 URL 并接入 \`<Link>\`；下一轮新增
一个 \`<OocLink>\` 组件即可（见 \`implementationStatus.todo\`）。
    `.trim(),
  },

  implementationStatus: {
    title: "当前实现状态（2026-05-18）",
    summary: "已实现 / 与文档差异 / 待办；读完这段就知道哪里能信、哪里不能信",

    delivered: {
      title: "已交付",
      content: `
对应 plan：
- \`docs/plans/2026-05-18-002-feat-object-client-metaprogramming-plan.md\`（核心元编程）
- \`docs/plans/2026-05-18-003-feat-web-routing-and-client-tree-integration-plan.md\`（路由 + FileTree）

**plan-002 交付**：

- **持久化**（\`src/persistable/stone-client.ts\`）
  - \`clientIndexFile(stoneRef)\` / \`flowClientPageFile(flowRef, page)\`
  - \`readStoneClientSource\` / \`writeStoneClientSource\`（mkdir 兜底）
  - \`readFlowClientPage\` / \`writeFlowClientPage\`（page 名校验 \`/^[A-Za-z0-9_-]+$/\`，
    拒 \`../\`、空白、扩展名等危险输入）
- **动态加载**（\`web/src/domains/clients/ObjectClientRenderer.tsx\`）
  - 结构化 target：\`{ scope: "stone" | "flow", objectId, sessionId?, page? }\`
  - Vite \`/@fs/\` + \`React.lazy\` 动态 import；React 与主 app 共享同一份
  - HEAD 探 content-type 区分"文件不存在"vs"语法/转译错"（前者 \`text/html\`
    SPA fallback，后者 \`text/javascript\`）
  - 自动合成 \`callMethod\`：scope=stone → \`POST /api/stones/:id/call_method\`；
    scope=flow → \`POST /api/flows/:sid/objects/:id/call_method\`
- **失败显式**
  - 404 → "信息待产出..."
  - 加载/转译错 → 红色块带堆栈与文件绝对路径
  - 渲染时 throw → \`ErrorBoundary\` 同款红块；仅 \`console.error\`，**不发任何 HTTP 请求**
- **预览入口**（独立页保留作 Playwright + minimal 重现）
  - \`/object-client.html?scope=stone&objectId=<id>\`
  - \`/object-client.html?scope=flow&sessionId=<sid>&objectId=<oid>&page=<name>\`
- **配置**：\`web/vite.config.ts\` 读 \`OOC_WORLD_DIR\` env → 注入 \`__OOC_WORLD_ROOT__\`
  define + \`server.fs.allow\`；缺 env 时 fail-loud，避免静默指错目录

**plan-003 交付**（react-router v7 接入 + FileTree 联动）：

- **react-router v7（library mode）** 接管主 app 路由
  - \`web/src/app/routes.tsx\` 配 \`createBrowserRouter\`；\`main.tsx\` 用
    \`RouterProvider\`
  - 路由表：\`/\` / \`/welcome\` / \`/files/*\` / \`/stones[/:id]\` / \`/flows[/:sid[/...]]\`
    / \`/flows/.../objects/.../pages/:page\`
  - \`web/src/app/route-error.tsx\` 未知 URL / loader 错统一兜底
- **URL ↔ state 单向源**（\`web/src/app/routing.ts\`）
  - \`RouteState\` discriminated union + \`parsePathname\` 纯函数
  - \`useRouteState()\` hook：读 \`useLocation\` + \`useParams\` → \`RouteState\`
    （用 \`useMemo\` 防止 effect 死循环）
  - \`toPath(RouteState)\` 反向构造 URL；shortcut 优先（plan-003 §3.3）
- **AppShell 改造**：导航维度从 useState 拿出，全部派生自 URL；
  handler 调 \`navigate(toPath(...))\` 替代 \`setState\`
- **\`ClientWithSourceToggle\`**（\`web/src/domains/clients/ClientWithSourceToggle.tsx\`）
  - \`[ 已渲染 | 源码 ]\` tab；CSS \`display:none\` 切换不卸载（保住 React state）
  - 源码用 \`fetchFile\` 拉，首次切到 source 才取；后续 cache
- **MainPanel 联动**：\`matchClientTarget(path)\` 识别 client 入口路径，自动
  挂 \`ClientWithSourceToggle\`；不命中走原 \`FileViewer\`
- **测试**：5 个 Playwright e2e（FR1–FR5）+ FC1-FC5 不退化；backend 单测全绿

**总体路由能力**：直接打 \`/stones/<id>\`、FileTree 点击、浏览器前进/后退、未知 URL
errorElement 兜底、长 URL 自动收敛为 shortcut —— 全部 e2e 通过。
      `.trim(),
    },

    deviations: {
      title: "与本文档字面承诺的差异",
      content: `
- **\`failureFallback\` 删除了"自动通知对象"承诺**：旧版写"加载/渲染错误 → 红色提示
  + 自动通知对象（通过 talk）请求修复"。新版不做。理由：渲染层不耦合 transport，
  避免噪声放大、stone 无 session 接收等歧义；详见
  \`docs/plans/2026-05-18-002-feat-object-client-metaprogramming-plan.md § 3 末尾\`。
- **\`componentContract\` 修正 callMethod 签名**：旧版示例写 3 参
  \`(traitId, method, args)\`。新版 2 参 \`(method, args)\`——新系统无 trait 概念。
- **\`oocLinks\` 解析未接**：本地 URL 形态已实现（\`/stones/{id}\` 等），但
  \`ooc://...\` 字符串到本地 URL 的解析与 \`<OocLink>\` 包装尚未写（见
  \`implementationStatus.todo\`）。
- **路由形态**：plan-003 选择"shell.tsx 派生 RouteState"而非"按 route 拆 Page
  组件"——少改动；shell.tsx 仍是单组件。这与 plan-003 §4 step 3 的"拆 Page"
  描述有差异（用 §4 末尾的实施变体落地）。
      `.trim(),
    },

    todo: {
      title: "已知待办",
      content: `
按收益 / 复杂度排序（plan-003 完成后剩余）：

1. **接入 \`ooc://client/...\` 链接协议解析**
   - 现状：本地 URL 形态已实现（\`oocLinks\` 段已说明映射关系）
   - 缺：一个 \`parseOocHref(str): string | undefined\` 工具 + \`<OocLink>\` 包
     \`<Link>\`；让 chat 消息里的 \`[navigate]\` 标签可点直达
   - 工作量：小（3-5 行代码 + 一个组件 + 一个 e2e）

2. **多文件 / 子目录 import**
   - 现状：单文件 + \`react\` import 验证通过；相对 import 理论上 Vite 能解析
     但未测过
   - 缺：写带 \`./components/Foo\` import 的 client，加 e2e 验证；必要时调
     \`/@fs/\` allow 配置
   - 工作量：小（一两个 e2e + 配置）

3. **prod build 形态**
   - 现状：完全依赖 Vite dev \`/@fs/\`；\`vite build\` 不会处理 world 目录下的 tsx
   - 缺：要么 prod 部署一个轻量转译端点（backend 出 ESM JS），要么明确"OOC 不
     做 prod 部署，只 dev 形态运行"
   - 工作量：中（需要决策 + 选型）

4. **失败 fallback 给"通知 Object"按钮**
   - 现状：红块只显示堆栈，用户要手工复制错误转发
   - 缺：按钮一键调 talk 端点把堆栈投到 Object root.talk_window
   - 工作量：小；但要先决策 stone（无 session）时投递目标

5. **shell.tsx 按 route 拆 Page 组件**
   - 现状：shell.tsx 仍是单文件 ~280 行，通过 \`useRouteState()\` 派生 RouteState
   - 缺：按 plan-003 §4 step 3 拆 \`WelcomePage / FilePage / StoneClientPage /
     FlowPagePage / SessionPage / ThreadPage\`，配 loader / errorElement
   - 工作量：中-大；当前形态已工作，**不紧迫**；待 shell.tsx 继续膨胀到 500+
     行时再考虑
      `.trim(),
    },
  },
};

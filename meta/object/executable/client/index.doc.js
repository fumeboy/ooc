import { executable_v20260504_1 } from "@meta/object/executable/index.doc";

export const client_v20260506_1 = {
    parent: executable_v20260504_1,
    index: `
Client 描述 Object 如何为自己编写前端 React UI 组件。

Object 不是"被外部 UI 设计的"，它**自己画自己**——
对象的视觉呈现直接由对象自身的代码生成，不依赖系统级的 UI 模板。

注：本文档只讲 Object 自定义 UI 组件这一部分。

## 物理结构

Stone 与 Flow 的 client 组织方式不同。

### Stone 级：单页 + 自由内部结构

\`\`\`
stones/{name}/client/
├── index.tsx                  主页（必备，默认 export React 组件）
├── components/                （任意子目录，由 index.tsx 自行引用）
│   └── ...
├── lib/
│   └── ...
└── ...
\`\`\`

**Stone client 是一个完整的 React 应用入口**：
- \`index.tsx\` 是唯一的入口，必须存在
- 入口下任意子目录 / 子文件由 \`index.tsx\` 自行 import 与组合，**不强制目录结构**
- 系统只关心 \`index.tsx\`——内部如何拆组件、放在哪个目录，是 Object 自己的事

### Flow 级：多页 pages 目录

\`\`\`
flows/{sessionId}/objects/{objectId}/client/
└── pages/
    ├── {pageName}.tsx         一个 tsx = 一个页面
    ├── {anotherPage}.tsx
    └── ...
\`\`\`

每个 \`pages/{pageName}.tsx\` 文件对应**一个独立的页面**：
- 用户可通过 ooc:// 链接直达单个页面
- 不同 pages 之间相互独立，没有强制布局容器
- 适合"任务报告 / 反馈表单 / 实验结果展示"等 session 内的临时产出

为什么 Flow 用多页：Flow 的产出通常是"针对当前任务的若干视图"，
每个视图自成一篇报告 / 表单，没必要塞进同一个 SPA 入口。
而 Stone 是 Object 的长期门面，更适合统一入口下自由组合。

## React 组件契约

无论 Stone 的 \`index.tsx\` 还是 Flow 的某个 \`pages/{name}.tsx\`，都遵循同一个契约：

\`\`\`tsx
import React, { useState } from "react";

interface ClientProps {
  sessionId?: string;
  objectName?: string;
  callMethod?: (id: string, method: string, args: object) => Promise<unknown>;
}

export default function MyView({ sessionId, objectName, callMethod }: ClientProps) {
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!callMethod) return;
    await callMethod("self:dashboard", "submit", { value: 42 });
    setDone(true);
  };

  return <button onClick={submit}>{done ? "已提交" : "提交"}</button>;
}
\`\`\`

约束：
- **默认 export** 一个 React 组件
- 组件 props 至少接受 \`{ sessionId?, objectName?, callMethod? }\`
- 渲染失败由前端 ErrorBoundary 兜底，不会让整个页面白屏

## callMethod 自动注入

前端动态加载 client 组件时，若 props 已含 \`sessionId + objectName\` 但未显式传 \`callMethod\`，
会自动注入一个绑定到该 Object 的 callMethod 闭包：

\`\`\`tsx
callMethod = (id, method, args) =>
  fetch(\`/api/flows/\${sessionId}/objects/\${objectName}/call_method\`, {
    method: "POST",
    body: JSON.stringify({ id, method, args }),
  }).then(...)
\`\`\`

调用走 HTTP \`POST /api/flows/:sid/objects/:name/call_method\` 端点，命中本对象 server 模块的 \`ui_methods\`。

## 与 server 的协作

client 通过 \`callMethod(id, method, args)\` 调用 Object 自己的 server 方法（必须命中 \`ui_methods\` 通道）。
client 与 server 不强制按 id 一一配对——一个 client 入口可以调用任意 server 模块的方法。

\`\`\`
stones/alan/
├── client/index.tsx                 callMethod("self:dashboard", "submit", ...)
│                                    callMethod("self:reporter", "loadReport", ...)
├── server/dashboard/index.ts        export const ui_methods = { submit: {...} }
├── server/reporter/index.ts         export const ui_methods = { loadReport: {...} }
└── knowledge/                       描述这些模块的设计意图，给 LLM 看
\`\`\`

详见 executable/server。

## ui_methods 的 notifyThread

UI 方法可以通过 \`ctx.notifyThread(msg)\` 把一条消息写入 Object 的根线程 inbox：

\`\`\`typescript
ui_methods: {
  submit: {
    fn: async (ctx, { value }) => {
      ctx.setData("submitted", value);
      ctx.notifyThread?.(\`[UI] 用户提交 value=\${value}\`);
      return { ok: true };
    },
  },
}
\`\`\`

写入后若根线程 done，自动翻回 running——这是"用户操作 UI → Object 被唤醒继续思考"的闭环。

## 不进入 LLM Context

client 是**给人看的**，不进入 LLM 的 Context。

LLM 想知道某个 client 长什么样、是干什么的，应读对应的 knowledge 文档
而不是去解读 React 代码。这强制了"代码与意图分离"——knowledge 描述意图，client 实现表象。

## 失败降级

前端动态加载 client 组件时若失败：
- 文件不存在（404）→ "信息待产出..."
- 文件加载 / 渲染错误 → 红色错误提示 + 自动通知对象（通过 talk）请求修复
- ErrorBoundary 兜底防止整个页面白屏

## 安全性

client 代码运行在前端主 JS 上下文中（无 iframe 沙箱）。
默认假设"对象的 client 代码可信"——来自 Session / 知情用户 / 对象自身创作。

如果对象由不受信用户上传，应在更外层做 review 或选择性禁用 client 加载。

## 与 ooc:// 协议

client 可被 ooc:// 链接引用：

\`\`\`
ooc://client/stones/{name}/                          Stone 主页（client/index.tsx）
ooc://client/flows/{sid}/objects/{name}/pages/{pageName}    Flow 某个页面
\`\`\`

在对话或 talk 消息中，对象可以输出导航卡片让用户跳转到具体页面：

\`\`\`
[navigate title="任务报告" description="本次任务的产出"]
ooc://client/flows/s_xyz/objects/alan/pages/report-2026
[/navigate]
\`\`\`

ooc:// 协议的完整说明属于 OOC 整体网站设计的一部分，不在本文范围。
`,
};

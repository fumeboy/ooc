import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
// client 文档主要描述前端 React app（在 web/，不在本 tsconfig include 范围）；
// 但 client 通过后端 ui_methods 调入，sources 指向后端的 ui module 是最稳定的锚点：
// 该 module 删除 / 改名时，client 的入口契约也就变了。
import * as serverUi from "@src/app/server/modules/ui/service";

// parent 改为 getter 以打破 executable/index ↔ client/index 的循环初始化死锁。
export const client_v20260506_1 = {
  get parent() { return executable_v20260504_1; },
  name: "Client",
  index: `
Client 描述 Object 如何为自己编写前端 React UI 组件。

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
    await callMethod("mthAbc", { value: 42 });
    setDone(true);
  };

  return <button onClick={submit}>{done ? "已提交" : "提交"}</button>;
}
\`\`\`

约束：
- **默认 export** 一个 React 组件
- 组件 props 至少接受 \`{ sessionId?, objectName?, callMethod? }\`
- 渲染失败由前端 ErrorBoundary 兜底，不会让整个页面白屏

## callMethod

调用走 HTTP \`POST /api/flows/:sid/objects/:name/call_method\` 端点，命中本对象 server 模块导出的 \`ui_methods\` 函数索引中的函数。

## 与 server 的协作

client 通过 \`callMethod(method, args)\` 调用 Object 自己的 server 方法。

\`\`\`
stones/alan/
├── client/index.tsx                 callMethod("mthAbc", ...)
├── server/index.ts        export const ui_methods = { submit: {...} }
└── knowledge/                       描述这些模块的设计意图，给 LLM 看
\`\`\`

详见 executable/server。

## 失败降级

前端动态加载 client 组件时若失败：
- 文件不存在（404）→ "信息待产出..."
- 文件加载 / 渲染错误 → 红色错误提示 + 自动通知对象（通过 talk）请求修复
- ErrorBoundary 兜底防止整个页面白屏

## ooc:// 链接协议

client 可被 ooc:// 链接引用：

\`\`\`
ooc://client/stones/{name}/                          Stone 主页（client/index.tsx）
ooc://client/flows/{sid}/objects/{name}/pages/{pageName}    Flow 某个页面
\`\`\`

在对话或 talk 消息中，对象可以输出导航链接让用户跳转到具体页面：

\`\`\`
[navigate title="任务报告" description="本次任务的产出"]
ooc://client/flows/s_xyz/objects/alan/pages/report-2026
[/navigate]
\`\`\`
`,
  /** description 与 index 同字符串，给 walkConcepts schema 校验用；下次清理把 index 删掉。 */
  get description() { return this.index; },
  sources: { serverUi },
};

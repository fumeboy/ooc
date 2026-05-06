import { executable_v20260504_1 } from "@meta/object/executable/index.doc";

export const server_v20260506_1 = {
    parent: executable_v20260504_1,
    index: `
Server 是 Object 自己拥有的后端方法集合。
LLM 通过 sandbox 中的 \`callMethod(id, name, args)\` 调用；前端通过 HTTP \`call_method\` 端点调用。

## 物理结构

\`\`\`
{kernel | stones/{name}}/server/
├── {moduleName}/
│   └── index.ts               export const llm_methods / ui_methods
├── {anotherModule}/
│   └── index.ts
└── ...
\`\`\`

每个一级子目录是一个 server 模块，对应一个 namespace:moduleName 的 id。
例：\`stones/alan/server/reporter/index.ts\` 对应 id = \`self:reporter\`。

library 命名空间是打包模式（\`library/{extensionName}/index.ts\` 同时承载 server）：
详见 extendable。

## index.ts 的导出契约

\`\`\`typescript
import type { TraitMethod } from "kernel/types";

// LLM 通道：sandbox callMethod 可调
export const llm_methods: Record<string, TraitMethod> = {
  readFile: {
    description: "读取文件内容",
    params: [
      { name: "path", type: "string", description: "文件路径", required: true },
    ],
    fn: async (ctx, { path }) => {
      return /* ... */;
    },
  },
};

// UI 通道：HTTP call_method 可调
export const ui_methods: Record<string, TraitMethod> = {
  submit: {
    description: "用户提交表单",
    params: [{ name: "value", type: "number", description: "", required: true }],
    fn: async (ctx, { value }) => {
      ctx.setData("submitted", value);
      ctx.notifyThread?.(\`[UI] 用户提交 value=\${value}\`);
      return { ok: true };
    },
  },
};
\`\`\`

约束：所有方法的第二个参数都是**对象**（\`fn(ctx, argsObj)\`），禁止位置参数。

## 双通道严格隔离

| 通道 | 注册来源 | 可调用入口 | 不可调用 |
|---|---|---|---|
| llm | \`llm_methods\` | sandbox \`callMethod(id, method, args)\` | \`ui_methods\`、其他对象的方法 |
| ui  | \`ui_methods\`  | HTTP \`POST /api/flows/:sid/objects/:name/call_method\` | \`llm_methods\`、kernel/library 命名空间、其他对象的方法 |

HTTP UI 通道额外白名单：
- id 必须 \`self:\` 命名空间（kernel / library 不可被前端调用）
- 发起调用的 client 必须属于本 Object（URL 上的 \`/objects/:name/\` 与 client 所属对象一致）

意义：LLM 端和 UI 端能力严格分离，前端不能任意调用后端方法、LLM 不能触碰只暴露给 UI 的方法。

## 注册时机：始终全部注册

Object 加载时，所有 server 模块的 llm_methods / ui_methods 被一次性扫描注册到 MethodRegistry。
**注册不参与激活管理**——server 方法**始终可调**。

但 LLM **不知道**有哪些方法可用——除非对应的 knowledge 文档（同 namespace:moduleName 或父级）
描述了这些方法并被激活。

\`\`\`
stones/alan/knowledge/reporter.md     描述 reporter 的方法
stones/alan/server/reporter/index.ts  实际方法实现 (llm_methods + ui_methods)
\`\`\`

knowledge 与 server 通过共享 \`self:reporter\` 这个 id 自然配对。

## MethodContext（注入到 fn 的第一个参数）

\`\`\`typescript
interface MethodContext {
  readonly data: Record<string, unknown>;        // stone 数据快照
  getData(key: string): unknown;
  setData(key: string, value: unknown): void;    // 写入 stone.data（HTTP 通道会持久化）
  print(...args: unknown[]): void;
  readonly sessionId: string;
  readonly filesDir: string;                     // flows/{sid}/objects/{name}/files/
  readonly rootDir: string;                      // user repo 根
  readonly selfDir: string;                      // stones/{name}/
  readonly stoneName: string;
  readonly threadId?: string;                    // engine 透传，仅在 LLM 通道下存在

  notifyThread?(content: string, opts?: { from?: string }): void;  // 仅 UI 通道
}
\`\`\`

### notifyThread 语义（仅 UI 通道）

UI 方法通过 \`ctx.notifyThread(msg)\` 向 Object 的根线程 inbox 写一条 system 消息：

- 写入后若根线程 done，自动翻回 running
- 是否调用 notifyThread 完全由方法内部决定（UI 改 data 可以不通知，也可以通知）

这是"用户改 UI → Object 被唤醒继续思考"的完整回路。

## 与 program command 的关系

LLM 调用 server 方法有两种形态：

### 形态 A：通过 program 的 trait/method 表单

\`open(command=program) → refine({ trait: "kernel:computable", method: "readFile", args: {...} }) → submit\`

适合"想清楚要调哪个方法"的场景，参数结构化。

### 形态 B：在 sandbox 代码里 callMethod

\`open(command=program) → refine({ code: "const x = await callMethod('kernel:computable', 'readFile', { path }); print(x);" }) → submit\`

适合需要把方法调用嵌入更复杂的代码逻辑（循环、分支、组合等）。

两种形态都最终走 MethodRegistry。

## 跨对象方法调用

不直接通过 callMethod——sandbox 的 callMethod 只能命中本对象的注册。
跨对象方法调用通过 \`talk\` 实现：

\`\`\`
talk(target=B, msg={ method: "someMethod", args: {...} }, wait=true)
\`\`\`

对方 B 在自己的 ThinkLoop 里解析消息，调本地 callMethod 执行，把结果 talk 回来。

详见 collaborable/talk。
`,
};

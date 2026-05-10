import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import * as serverLoader from "@src/executable/server/loader";
import * as serverSelf from "@src/executable/server/self";
import * as serverTypes from "@src/executable/server/types";

export const server_v20260506_1 = {
  parent: executable_v20260504_1,
  sources: {
    loader: serverLoader,
    self: serverSelf,
    types: serverTypes,
  },
  index: `
Server 是 Object 自己拥有的后端方法集合。
LLM 通过 sandbox 中的 \`callMethod(name, args)\` 调用；前端通过 HTTP \`call_method\` 端点调用。

## 物理结构

\`\`\`
stones/{name}/server/          (session 下也有对应的目录 flows/{sessionId}/objects/{objectId}/server)
└── index.ts     export const llm_methods / ui_methods
\`\`\`

## index.ts 的导出契约

\`\`\`typescript
import type { ObjectExportMethod } from "kernel/types";

// LLM 通道：执行 command \`program\` 时通过 callMethod 工具函数可调
export const llm_methods: Record<string, ObjectExportMethod> = {
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
export const ui_methods: Record<string, ObjectExportMethod> = {
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

## 当前实现阶段

OOC 系统在 \`program\` command 内部按需 \`import("\${stoneDir}/server/index.ts?t=\${mtime}")\` 加载 \`llm_methods\`，按文件 mtime 缓存。

Agent 通过 \`program.shell\` 编辑此文件后，下一次 \`program.function\` 或 \`program.ts\` 中的 \`self.callMethod\` 会自动重新加载。

当前实现：
- 仅加载 \`export const llm_methods\`，\`ui_methods\` 暂未接 HTTP
- 方法签名：\`(ctx, args) => unknown | Promise<unknown>\`
- ctx 字段：\`ctx.self\`（dir / callMethod / getData / setData）/ \`ctx.thread\`（id / inject）

当前不实现：
- ui_methods 的 HTTP 端点暴露
- 跨 object 的 callMethod
- 方法权限控制
`,
};

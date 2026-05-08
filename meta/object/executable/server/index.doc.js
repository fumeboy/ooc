import { executable_v20260504_1 } from "@meta/object/executable/index.doc";

export const server_v20260506_1 = {
  parent: executable_v20260504_1,
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
`,
};

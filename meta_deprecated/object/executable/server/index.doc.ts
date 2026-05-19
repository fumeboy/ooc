import type { Concept, DocNode, ExampleNode, InvariantNode } from "@meta/doc-types";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import * as serverLoader from "@src/executable/server/loader";
import * as serverSelf from "@src/executable/server/self";
import * as serverTypes from "@src/executable/server/types";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Server 概念骨架
 * ──────────────────────────────────────────────────────────────── */

export type ServerConcept = Concept & {
  sources: {
    loader: typeof serverLoader;
    self: typeof serverSelf;
    types: typeof serverTypes;
  };

  /** Stone / Flow 下 server 目录的物理结构 */
  physicalLayout: ExampleNode;

  /** index.ts 的 llm_methods / ui_methods 导出契约 */
  exportContract: ExampleNode;

  /** server method 与 command match 的语义同构 */
  commandMatchIsomorphism: ExampleNode;

  /** 当前实现的覆盖范围 */
  currentImplementation: DocNode;

  /** 不变量：缓存按 mtime；shell 编辑后自动 reload */
  mtimeReload: InvariantNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const server_v20260506_1: ServerConcept = {
  name: "Server",
  get parent() {
    return executable_v20260504_1;
  },
  sources: {
    loader: serverLoader,
    self: serverSelf,
    types: serverTypes,
  },
  description: `
Server 是 Object 自己拥有的后端方法集合。LLM 通过 sandbox 中的 \`callMethod(name, args)\`
调用；前端通过 HTTP \`call_method\` 端点调用。
`.trim(),

  physicalLayout: {
    kind: "example",
    title: "物理结构",
    summary: "stones/{name}/server/index.ts 导出 llm_methods / ui_methods",
    content: `
\`\`\`
stones/{name}/server/
└── index.ts     export const llm_methods / ui_methods
\`\`\`

session 下对应：\`flows/{sessionId}/objects/{objectId}/server/index.ts\`。
    `.trim(),
  },

  exportContract: {
    kind: "example",
    title: "index.ts 导出契约",
    summary: "llm_methods（LLM 通道） + ui_methods（前端通道）",
    content: `
\`\`\`ts
import type { ObjectExportMethod } from "kernel/types";

// LLM 通道：执行 command program 时通过 callMethod 工具函数可调
export const llm_methods: Record<string, ObjectExportMethod> = {
  readFile: {
    description: "读取文件内容",
    params: [
      { name: "path", type: "string", description: "文件路径", required: true },
    ],
    fn: async (ctx, { path }) => { /* ... */ },
  },

  deploy: {
    description: "部署服务",
    params: [
      { name: "service", type: "string", required: true },
      { name: "mode", type: "string", description: "dev | prod" },
    ],
    // 动态 knowledge：与 command.match(args) → paths 同构。
    knowledge: (args) => {
      if (args.mode === "prod") return "生产部署：必须先经过 review，且需要 release_notes 字段。";
      return "开发部署：直接传 service 即可。";
    },
    fn: async (ctx, args) => { /* ... */ },
  },
};

// UI 通道：HTTP call_method 可调（暂未接 HTTP）
export const ui_methods: Record<string, ObjectExportMethod> = {
  submit: {
    description: "用户提交表单",
    params: [{ name: "value", type: "number", required: true }],
    fn: async (ctx, { value }) => {
      ctx.setData("submitted", value);
      ctx.notifyThread?.("[UI] 用户提交 value=" + value);
      return { ok: true };
    },
  },
};
\`\`\`
    `.trim(),
  },

  commandMatchIsomorphism: {
    kind: "example",
    title: "knowledge 与 command.match 的同构",
    summary: "method 的 description/params/knowledge 与 command 的 paths/match 是同一套设计",
    content: `
| 概念 | command | server method |
|---|---|---|
| 静态元数据 | paths | description / params |
| 动态派生 | match(args) → string[] | knowledge(args) → string |
| 渲染位置 | \`<command_paths>\` | \`<method_knowledge>\` |

method 不写 \`knowledge\` fn 时，系统按 description + params 自动生成基线文本，保证 LLM
至少有静态提示。显式写 \`knowledge\` fn 时可根据 args 动态返回不同文本——例如 mode=prod
强调"必须 review"，mode=dev 省略警告。
    `.trim(),
  },

  currentImplementation: {
    title: "当前实现阶段",
    summary: "已落地：llm_methods 自动加载 + 缓存；未落地：ui_methods HTTP / 跨对象 callMethod / 权限",
    content: `
**当前实现**：
- 仅加载 \`llm_methods\`，\`ui_methods\` 暂未接 HTTP
- 方法签名：\`fn: (ctx, args) => unknown | Promise<unknown>\`
- 方法可选 \`knowledge: (args) => string\`（同 command.match 设计）；缺省时由系统按
  description+params 自动生成
- ctx 字段：\`ctx.self\`（dir / callMethod / getData / setData）、\`ctx.thread\`
  （id / inject）

**当前不实现**：
- \`ui_methods\` 的 HTTP 端点暴露
- 跨 object 的 callMethod
- 方法权限控制
    `.trim(),
  },

  mtimeReload: {
    kind: "invariant",
    title: "mtime 缓存 + shell 编辑自动 reload",
    summary: "program 内 import(\"<stoneDir>/server/index.ts?t=<mtime>\") 走 mtime 缓存",
    content: `
program command 内部按需 \`import("<stoneDir>/server/index.ts?t=<mtime>")\` 加载
\`llm_methods\`，按文件 mtime 缓存。Agent 通过 \`program.shell\` 编辑此文件后，下一次
\`program.function\` 或 \`program.ts\` 中的 \`self.callMethod\` 会自动重新加载。
    `.trim(),
    rationale: `
mtime 签名 = 既享受缓存命中的低延迟（同 method 在多轮调用里不重复 parse），又能让 Agent
通过 program.shell 编辑 server/index.ts 之后无感生效——不需要显式 reload。
    `.trim(),
  },
};

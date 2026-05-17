import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import * as serverLoader from "@src/executable/server/loader";
import * as serverSelf from "@src/executable/server/self";
import * as serverTypes from "@src/executable/server/types";

// parent 改为 getter 以打破 executable/index ↔ server/index 的循环初始化死锁。
export const server_v20260506_1 = {
  get parent() { return executable_v20260504_1; },
  name: "Server",
  get description() { return this.index; },
  sources: {
    loader: serverLoader,
    self: serverSelf,
    types: serverTypes,
  },
  index: `
Server 是 Object 自己拥有的后端方法集合。
LLM 通过 sandbox 中的 callMethod(name, args) 调用；前端通过 HTTP call_method 端点调用。

## 物理结构


stones/{name}/server/          (session 下也有对应的目录 flows/{sessionId}/objects/{objectId}/server)
└── index.ts     export const llm_methods / ui_methods


## index.ts 的导出契约

typescript
import type { ObjectExportMethod } from "kernel/types";

// LLM 通道：执行 command program 时通过 callMethod 工具函数可调
export const llm_methods: Record<string, ObjectExportMethod> = {
  readFile: {
    // 静态元数据：用于默认 knowledge 生成（method 没自带 knowledge fn 时回退）
    description: "读取文件内容",
    params: [
      { name: "path", type: "string", description: "文件路径", required: true },
    ],
    // 真实执行函数
    fn: async (ctx, { path }) => {
      return /* ... */;
    },
  },

  deploy: {
    description: "部署服务",
    params: [
      { name: "service", type: "string", required: true },
      { name: "mode", type: "string", description: "dev | prod" },
    ],
    /**
     * 动态 knowledge：与 command.match(args) → paths 同构。
     * 接收当前 form.accumulatedArgs.args，返回该方法当下推荐的知识文本。
     * 系统会把它写到 form.methodKnowledge，渲染到下一轮 active_forms 的 <method_knowledge> 段。
     */
    knowledge: (args) => {
      if (args.mode === "prod") {
        return "生产部署：必须先经过 review，且需要 release_notes 字段。";
      }
      return "开发部署：直接传 service 即可。";
    },
    fn: async (ctx, args) => {
      // ...
    },
  },
};

// UI 通道：HTTP call_method 可调（暂未接 HTTP）
export const ui_methods: Record<string, ObjectExportMethod> = {
  submit: {
    description: "用户提交表单",
    params: [{ name: "value", type: "number", description: "", required: true }],
    fn: async (ctx, { value }) => {
      ctx.setData("submitted", value);
      ctx.notifyThread?.("[UI] 用户提交 value=" + value);
      return { ok: true };
    },
  },
};


## knowledge 与 command match 的同构

| 概念 | command | server method |
|---|---|---|
| 静态元数据 | paths | description / params |
| 动态派生 | match(args) → string[]（path 列表） | knowledge(args) → string（知识文本） |
| 渲染位置 | <command_paths> | <method_knowledge> |

method 不写 knowledge fn 时，系统按 description + params 自动生成基线文本，保证 LLM 至少有静态提示。
显式写 knowledge fn 时，可以根据 args 不同动态返回不同知识——例如 mode=prod 时强调"必须 review"，mode=dev 时省略警告。

## 当前实现阶段

OOC 系统在 program command 内部按需 import("<stoneDir>/server/index.ts?t=<mtime>") 加载 llm_methods，按文件 mtime 缓存。

Agent 通过 program.shell 编辑此文件后，下一次 program.function 或 program.ts 中的 self.callMethod 会自动重新加载。

当前实现：
- 仅加载 export const llm_methods，ui_methods 暂未接 HTTP
- 方法签名：fn: (ctx, args) => unknown | Promise<unknown>
- 方法可选 knowledge: (args) => string（同 command.match 设计）；缺省时由系统按 description+params 自动生成
- ctx 字段：ctx.self（dir / callMethod / getData / setData）/ ctx.thread（id / inject）

当前不实现：
- ui_methods 的 HTTP 端点暴露
- 跨 object 的 callMethod
- 方法权限控制
`,
};

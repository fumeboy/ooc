import { object_v20260504_1 } from "@meta/object/index.doc";
import * as serverLoader from "@src/executable/server/loader";
import * as serverTypes from "@src/executable/server/types";
import * as serverSelf from "@src/executable/server/self";
import * as serverEnrich from "@src/executable/server/enrich";

/**
 * KernelExtensions 概念：所有 Object 共享的内置能力（kernel 目录），定义"作为 OOC 对象意味着什么"。
 *
 * sources:
 *  - serverLoader — kernel/能力层动态加载（按 mtime 缓存的 server module loader）
 *  - serverTypes  — ProgramSelf / ServerMethod / LlmMethods / UiMethods schema
 *  - serverSelf   — program 模式注入的 self 对象（callMethod / getData / setData）
 *  - serverEnrich — command_exec form 的 command knowledge 列表 enrich 入口
 */
export const kernel_extensions_v20260506_1 = {
  name: "KernelExtensions",
  get parent() { return extendable_v20260504_1; },
  sources: {
    loader: serverLoader,
    types: serverTypes,
    self: serverSelf,
    enrich: serverEnrich,
  },
  description: `
KernelExtensions 是所有 Object 共享的内置能力（位于 \`kernel\` 目录），分基座层与能力层。

按子字段展开：

- baseLayer — kernel:base 常驻知识（5 + 1 tool 用法、mark 机制、form 生命周期）
- capabilityLayer — 按需激活的能力包（executable / collaborable / reflectable /
  plannable / compress）
- activationModel — 能力层如何通过 command 路径被激活进入 Context
`.trim(),

  baseLayer_v20260517_1: {
    index: `
## 基座层

\`kernel:base\` 作为常驻 knowledge 出现在 Context，承载三个子说明。详见子节点。
`.trim(),

    toolUsage_v20260517_1: {
      index: `
### tool 用法

tool \`open / refine / submit / close / wait / compress\` 的标准签名与典型用法。
`.trim(),
    },

    markMechanism_v20260517_1: {
      index: `
### mark 机制

context 内信息的标记 / 引用 / 锚定基础语法，被其它 knowledge 与 form 复用。
`.trim(),
    },

    formLifecycle_v20260517_1: {
      index: `
### form 生命周期约束

open → refine? → submit / close 的基本顺序与不可越级跳变约束。
`.trim(),
    },
  },

  capabilityLayer_v20260517_1: {
    index: `
## 能力层

和普通 knowledge 一样按需激活，由 command 路径触发。每个能力一个独立子节点。
`.trim(),

    executable_v20260517_1: {
      index: `
### kernel:executable

代码执行能力。触发：\`open(type=command, command=program, ...)\`。
`.trim(),
    },

    collaborable_v20260517_1: {
      index: `
### kernel:collaborable

对象间通信能力。触发 command：\`talk\`。
`.trim(),
    },

    reflectable_v20260517_1: {
      index: `
### kernel:reflectable

反思与沉淀。描述如何把经历沉淀为长期 knowledge / 元编程。
`.trim(),
    },

    plannable_v20260517_1: {
      index: `
### kernel:plannable

任务规划。触发 command：\`do\` / \`plan\`。
`.trim(),
    },

    compress_v20260517_1: {
      index: `
### kernel:compress

上下文压缩。描述如何审视 process events，标记冗余区段。
`.trim(),
    },
  },

  activationModel_v20260517_1: {
    index: `
## 激活模型

能力层 knowledge 与普通 knowledge 共用 \`activates_on\` 机制（详见 thinkable/knowledge）：
当 LLM 通过 \`open(type=command, command=X)\` 打开一个 form 时，匹配到 X 路径的
kernel 能力知识自动激活进入 Context。

submit / close 关闭 form 后，本次激活的能力知识自动卸载。
`.trim(),
  },
};

/**
 * Extendable 概念：Object 如何通过 knowledge / server / client 三类内容扩展自己的认知与能力。
 *
 * sources:
 *  - serverLoader — server/index.ts 动态加载（llm_methods / ui_methods）
 *  - serverTypes  — server method 注册时的 schema
 */
export const extendable_v20260504_1 = {
  name: "Extendable",
  get parent() { return object_v20260504_1; },
  sources: {
    loader: serverLoader,
    types: serverTypes,
  },
  description: `
Extendable 是 Object 扩展自己认知与能力的三层模型：内容类型 × 来源层级。

按子字段展开：

- contentTypes — knowledge / server / client 三类扩展内容
- sourceLayers — kernel / library / stones+flows 三个来源层级
`.trim(),

  contentTypes_v20260517_1: {
    index: `
## 内容类型

Object 的能力来自三种内容：

- **knowledge** — 知识文档（markdown + frontmatter，通过 \`activates_on\` 渐进式激活）
- **server** — 后端方法（TypeScript 函数，分 \`llm_methods\` / \`ui_methods\` 两个索引）
- **client** — 前端 React UI 组件
`.trim(),
  },

  sourceLayers_v20260517_1: {
    index: `
## 来源层级

这三类内容可以来自三个层级：

\`\`\`
kernel/                                                   系统内置
   ↓
library/                                                  公共资源库（待实现扩展机制）
   ↓
stones/{name}/  或  flows/{sessionId}/objects/{name}/     Object 自己的
\`\`\`
`.trim(),
  },

  kernel_extensions: kernel_extensions_v20260506_1,
};

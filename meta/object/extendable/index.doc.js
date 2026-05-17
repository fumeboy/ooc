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
KernelExtensions 是所有 Object 共享的内置能力（位于 kernel 目录），分基座层与能力层。

按子字段展开：

- baseLayer — kernel:base 常驻知识（5 + 1 tool 用法、mark 机制、form 生命周期）
- capabilityLayer — 按需激活的能力包（executable / collaborable / reflectable /
  plannable / compress）
- activationModel — 能力层如何通过 command 路径被激活进入 Context
`,

  baseLayer_v20260517_1: {
    index: `
## 基座层

kernel:base 作为常驻 knowledge 出现在 Context，承载三个子说明。详见子节点。
`,

    toolUsage_v20260517_1: {
      index: `
### tool 用法

tool open / refine / submit / close / wait / compress 的标准签名与典型用法。
`,
    },

    markMechanism_v20260517_1: {
      index: `
### mark 机制

context 内信息的标记 / 引用 / 锚定基础语法，被其它 knowledge 与 form 复用。
`,
    },

    formLifecycle_v20260517_1: {
      index: `
### form 生命周期约束

open → refine? → submit / close 的基本顺序与不可越级跳变约束。
`,
    },
  },

  capabilityLayer_v20260517_1: {
    index: `
## 能力层

和普通 knowledge 一样按需激活，由 command 路径触发。每个能力一个独立子节点。
`,

    executable_v20260517_1: {
      index: `
### kernel:executable

代码执行能力。触发：open(type=command, command=program, ...)。
`,
    },

    collaborable_v20260517_1: {
      index: `
### kernel:collaborable

对象间通信能力。触发 command：talk。
`,
    },

    reflectable_v20260517_1: {
      index: `
### kernel:reflectable

反思与沉淀。描述如何把经历沉淀为长期 knowledge / 元编程。
`,
    },

    plannable_v20260517_1: {
      index: `
### kernel:plannable

任务规划。触发 command：do / plan。
`,
    },

    compress_v20260517_1: {
      index: `
### kernel:compress

上下文压缩。描述如何审视 process events，标记冗余区段。
`,
    },
  },

  activationModel_v20260517_1: {
    index: `
## 激活模型

能力层 knowledge 与普通 knowledge 共用 activates_on 机制（详见
thinkable.knowledge）。详见三个子节点：触发、卸载、与基座层的差异。
`,

    triggerByOpenCommand_v20260517_1: {
      index: `
### 触发：open(type=command, command=X)

当 LLM 通过 open(type=command, command=X) 打开一个 form 时，匹配到 X 路径的
kernel 能力知识自动激活进入 Context。匹配按 knowledge frontmatter 的
activates_on 字段执行。
`,
    },

    unloadOnFormClose_v20260517_1: {
      index: `
### 卸载：form 关闭即卸载

submit / close 关闭 form 后，本次激活的能力知识自动卸载——避免长跑 thread
不断累积已用完的 knowledge 撑大 Context。
`,
    },

    vsBaseLayer_v20260517_1: {
      index: `
### 与基座层的差异

基座层（kernel:base）常驻 Context，不受 activates_on 限制；
能力层按需激活，受 form 生命周期约束。两者通过同一份 knowledge frontmatter
区分（base 类无 activates_on，能力类有）。
`,
    },
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
`,

  contentTypes_v20260517_1: {
    index: `
## 内容类型

Object 的能力来自三种内容：knowledge / server / client。每种独立子节点。
`,

    knowledge_v20260517_1: {
      index: `
### knowledge

知识文档（markdown + frontmatter）。通过 activates_on 渐进式激活——只在
匹配的 command / form 出现时进入 Context，避免一次塞入全部知识。
`,
    },

    server_v20260517_1: {
      index: `
### server

后端方法（TypeScript 函数），分两个独立索引：

- llm_methods — LLM 可调用的方法（暴露成 command）
- ui_methods — 前端 client 可调用的方法（暴露成 HTTP）

两索引互不重叠：一个方法要么 LLM 可见，要么 UI 可见，不能两边都注册。
`,
    },

    client_v20260517_1: {
      index: `
### client

前端 React UI 组件。落盘在 stones/{name}/client/ 或 flows/{sid}/objects/{name}/client/。
通过动态 import 在 web 端按 path 加载。
`,
    },
  },

  sourceLayers_v20260517_1: {
    index: `
## 来源层级

这三类内容可以来自三个层级，按"越靠近 Object 越优先"排序：


kernel/                                                   系统内置
   ↓
library/                                                  公共资源库（待实现扩展机制）
   ↓
stones/{name}/  或  flows/{sessionId}/objects/{name}/     Object 自己的


每层独立子节点。
`,

    kernelLayer_v20260517_1: {
      index: `
### kernel/ — 系统内置

所有 Object 共享的内置能力。详见 kernel_extensions 子概念。
`,
    },

    libraryLayer_v20260517_1: {
      index: `
### library/ — 公共资源库

待实现的扩展机制；目标是社区共享的 knowledge / server / client 包。
当前阶段为占位。
`,
    },

    objectOwnLayer_v20260517_1: {
      index: `
### stones/{name}/ 或 flows/{sid}/objects/{name}/ — Object 自己的

Object 私有的扩展。Stone 层为长期能力，Flow 层为 session 内动态能力。
Object 通过 reflectable 通道修改的目标也落在这一层。
`,
    },

    overrideOrder_v20260517_1: {
      index: `
### 覆盖顺序

加载冲突时近者优先：Object own > library > kernel。Object 可以"覆盖"
kernel 的某条同名能力（如 server method），但通常不建议这么做。
`,
    },
  },

  kernel_extensions: kernel_extensions_v20260506_1,
};

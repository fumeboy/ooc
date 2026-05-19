import type { Concept, DocNode } from "@meta/doc-types";
import { object_v20260504_1 } from "@meta/object/index.doc";
import * as serverLoader from "@src/executable/server/loader";
import * as serverTypes from "@src/executable/server/types";
import * as serverSelf from "@src/executable/server/self";
import * as serverEnrich from "@src/executable/server/enrich";

/* ────────────────────────────────────────────────────────────────
 *  目录页：KernelExtensions（base + capability + activation）
 * ──────────────────────────────────────────────────────────────── */

/**
 * KernelExtensions 概念：所有 Object 共享的内置能力（kernel 目录），定义
 * "作为 OOC 对象意味着什么"。
 *
 * sources:
 *  - loader — kernel/能力层动态加载（按 mtime 缓存的 server module loader）
 *  - types  — ProgramSelf / ServerMethod / LlmMethods / UiMethods schema
 *  - self   — program 模式注入的 self 对象（callMethod / getData / setData）
 *  - enrich — command_exec form 的 command knowledge 列表 enrich 入口
 */
export type KernelExtensionsConcept = Concept & {
  sources: {
    loader: typeof serverLoader;
    types: typeof serverTypes;
    self: typeof serverSelf;
    enrich: typeof serverEnrich;
  };

  /** kernel:base 常驻知识：tool 用法、mark 机制、form 生命周期 */
  baseLayer: {
    title: string;
    summary?: string;
    toolUsage: DocNode;
    markMechanism: DocNode;
    formLifecycle: DocNode;
  };

  /** 按需激活的能力包 */
  capabilityLayer: {
    title: string;
    summary?: string;
    executable: DocNode;
    collaborable: DocNode;
    reflectable: DocNode;
    plannable: DocNode;
    compress: DocNode;
  };

  /** 能力层如何通过 command 路径被激活进入 Context */
  activationModel: {
    title: string;
    summary?: string;
    triggerByOpenCommand: DocNode;
    unloadOnFormClose: DocNode;
    vsBaseLayer: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  目录页：Extendable（contentTypes + sourceLayers + kernel_extensions）
 * ──────────────────────────────────────────────────────────────── */

/**
 * Extendable 概念：Object 如何通过 knowledge / server / client 三类内容扩展
 * 自己的认知与能力。
 *
 * sources:
 *  - loader — server/index.ts 动态加载（llm_methods / ui_methods）
 *  - types  — server method 注册时的 schema
 */
export type ExtendableConcept = Concept & {
  sources: {
    loader: typeof serverLoader;
    types: typeof serverTypes;
  };

  /** knowledge / server / client 三类扩展内容 */
  contentTypes: {
    title: string;
    summary?: string;
    knowledge: DocNode;
    server: DocNode;
    client: DocNode;
  };

  /** kernel / library / stones+flows 三个来源层级 + 覆盖顺序 */
  sourceLayers: {
    title: string;
    summary?: string;
    kernelLayer: DocNode;
    libraryLayer: DocNode;
    objectOwnLayer: DocNode;
    overrideOrder: DocNode;
  };

  /** kernel_extensions 子概念（自身就是一个 Concept） */
  kernel_extensions: KernelExtensionsConcept;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const kernel_extensions_v20260506_1: KernelExtensionsConcept = {
  name: "KernelExtensions",
  get parent() {
    return extendable_v20260504_1;
  },
  sources: {
    loader: serverLoader,
    types: serverTypes,
    self: serverSelf,
    enrich: serverEnrich,
  },
  description: `
KernelExtensions 是所有 Object 共享的内置能力（位于 kernel 目录），分基座层与
能力层。
  `.trim(),

  baseLayer: {
    title: "基座层",
    summary: "kernel:base 常驻知识：tool 用法 / mark 机制 / form 生命周期",

    toolUsage: {
      title: "tool 用法",
      content: `
tool \`open\` / \`refine\` / \`submit\` / \`close\` / \`wait\` / \`compress\` 的标准
签名与典型用法。
      `.trim(),
    },

    markMechanism: {
      title: "mark 机制",
      content: `
context 内信息的标记 / 引用 / 锚定基础语法，被其它 knowledge 与 form 复用。
      `.trim(),
    },

    formLifecycle: {
      title: "form 生命周期约束",
      content: `
\`open → refine? → submit / close\` 的基本顺序与不可越级跳变约束。
      `.trim(),
    },
  },

  capabilityLayer: {
    title: "能力层",
    summary: "按需激活的能力包，由 command 路径触发",

    executable: {
      title: "kernel:executable",
      content: `
代码执行能力。触发：\`open(type=command, command=program, ...)\`。
      `.trim(),
    },

    collaborable: {
      title: "kernel:collaborable",
      content: `
对象间通信能力。触发 command：\`talk\`。
      `.trim(),
    },

    reflectable: {
      title: "kernel:reflectable",
      content: `
反思与沉淀。描述如何把经历沉淀为长期 knowledge / 元编程。
      `.trim(),
    },

    plannable: {
      title: "kernel:plannable",
      content: `
任务规划。触发 command：\`do\` / \`plan\`。
      `.trim(),
    },

    compress: {
      title: "kernel:compress",
      content: `
上下文压缩。描述如何审视 process events，标记冗余区段。
      `.trim(),
    },
  },

  activationModel: {
    title: "激活模型",
    summary: "能力层 knowledge 与普通 knowledge 共用 activates_on 机制",

    triggerByOpenCommand: {
      title: "触发：open(type=command, command=X)",
      content: `
当 LLM 通过 \`open(type=command, command=X)\` 打开一个 form 时，匹配到 X 路径的
kernel 能力知识自动激活进入 Context。匹配按 knowledge frontmatter 的
\`activates_on\` 字段执行。
      `.trim(),
    },

    unloadOnFormClose: {
      title: "卸载：form 关闭即卸载",
      content: `
\`submit\` / \`close\` 关闭 form 后，本次激活的能力知识自动卸载——避免长跑 thread
不断累积已用完的 knowledge 撑大 Context。
      `.trim(),
    },

    vsBaseLayer: {
      title: "与基座层的差异",
      content: `
基座层（\`kernel:base\`）常驻 Context，不受 \`activates_on\` 限制；能力层按需
激活，受 form 生命周期约束。两者通过同一份 knowledge frontmatter 区分
（base 类无 \`activates_on\`，能力类有）。
      `.trim(),
    },
  },
};

export const extendable_v20260504_1: ExtendableConcept = {
  name: "Extendable",
  get parent() {
    return object_v20260504_1;
  },
  sources: {
    loader: serverLoader,
    types: serverTypes,
  },
  description: `
Extendable 是 Object 扩展自己认知与能力的三层模型：内容类型 × 来源层级。
  `.trim(),

  contentTypes: {
    title: "内容类型",
    summary: "knowledge / server / client 三类扩展内容",

    knowledge: {
      title: "knowledge",
      content: `
知识文档（markdown + frontmatter）。通过 \`activates_on\` 渐进式激活——只在
匹配的 command / form 出现时进入 Context，避免一次塞入全部知识。
      `.trim(),
    },

    server: {
      title: "server",
      content: `
后端方法（TypeScript 函数），分两个独立索引：

- \`llm_methods\` — LLM 可调用的方法（暴露成 command）
- \`ui_methods\` — 前端 client 可调用的方法（暴露成 HTTP）

两索引互不重叠：一个方法要么 LLM 可见，要么 UI 可见，不能两边都注册。
      `.trim(),
    },

    client: {
      title: "client",
      content: `
前端 React UI 组件。落盘在 \`stones/{name}/client/\` 或
\`flows/{sid}/objects/{name}/client/\`。通过动态 import 在 web 端按 path 加载。
      `.trim(),
    },
  },

  sourceLayers: {
    title: "来源层级",
    summary: "kernel / library / Object own 三层，由近及远",

    kernelLayer: {
      title: "kernel/",
      content: `
所有 Object 共享的内置能力。详见 \`kernel_extensions\` 子概念。
      `.trim(),
    },

    libraryLayer: {
      title: "library/",
      content: `
待实现的扩展机制；目标是社区共享的 knowledge / server / client 包。
当前阶段为占位。
      `.trim(),
    },

    objectOwnLayer: {
      title: "stones/{name}/ 或 flows/{sid}/objects/{name}/",
      content: `
Object 私有的扩展。Stone 层为长期能力，Flow 层为 session 内动态能力。
Object 通过 reflectable 通道修改的目标也落在这一层。
      `.trim(),
    },

    overrideOrder: {
      title: "覆盖顺序",
      content: `
加载冲突时近者优先：**Object own > library > kernel**。Object 可以"覆盖"
kernel 的某条同名能力（如 server method），但通常不建议这么做。
      `.trim(),
    },
  },

  kernel_extensions: kernel_extensions_v20260506_1,
};

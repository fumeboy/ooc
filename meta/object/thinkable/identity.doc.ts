import type { Concept, DocNode, ExampleNode, InvariantNode } from "@meta/doc-types";
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { reflectable_v20260504_1 } from "@meta/object/reflectable/index.doc";
import { persistable_v20260504_1 } from "@meta/object/persistable/index.doc";
import * as stoneSelf from "@src/persistable/stone-self";
import * as stoneReadme from "@src/persistable/stone-readme";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Identity 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * Identity 概念：Object 对自己的双面认知（内在 self.md + 对外 readme.md）。
 *
 * sources:
 *  - stoneSelf   — stones/{id}/self.md 读写（内在自我）
 *  - stoneReadme — stones/{id}/readme.md 读写（对外名片）
 */
export type IdentityConcept = Concept & {
  sources: {
    stoneSelf: typeof stoneSelf;
    stoneReadme: typeof stoneReadme;
  };

  /** 内在 self.md：仅自己可见的自我说明 */
  innerSelf: {
    title: string;
    summary?: string;
    payload: DocNode;
    payloadScale: DocNode;
    injection: DocNode;
    /** self 注入无条件 */
    injectionUnconditional: InvariantNode;
    /** frontmatter + 正文示例 */
    example: ExampleNode;
    frontmatterFields: DocNode;
  };

  /** 外在 readme.md：对外名片 */
  outerReadme: {
    title: string;
    summary?: string;
    positioning: DocNode;
    contactSurface: DocNode;
    privacyBoundary: DocNode;
  };

  /** 不对称信息披露 */
  asymmetry: {
    title: string;
    summary?: string;
    innerChannel: DocNode;
    outerChannel: DocNode;
    independentEvolution: DocNode;
    /** 为什么必须不对称 */
    rationale: DocNode;
  };

  /** 身份的演化路径 */
  evolution: {
    title: string;
    summary?: string;
    writeTargets: DocNode;
    channelConstraint: DocNode;
    /** Flow 内不可直写 Stone 身份 */
    flowWriteForbidden: InvariantNode;
  };

  /** 关联子概念：身份的持久化与反思演化 */
  persistable: Concept;
  reflectable: Concept;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const identity_v20260505_1: IdentityConcept = {
  name: "Identity",
  get parent() {
    return thinkable_v20260504_1;
  },
  sources: {
    stoneSelf,
    stoneReadme,
  },
  description: `
Identity 是 Object 对自己的双面认知：内在 self（仅自己可见）与外在 readme（他者可见）。

双面分离是数据模型层的硬性区分——保护隐私、减少协作过载、让内心演化不被对外形象锁死。
身份的改写不能在普通 Flow 中发生；只能走 reflectable 的 super 通道。
`.trim(),

  innerSelf: {
    title: "内在自我 (self.md)",
    summary: "stones/{name}/self.md 正文——Object 思考时的身份起点",

    payload: {
      title: "承载内容",
      content:
        "承载 Object 的完整自我说明：角色、目标、风格、约束、价值观。是 Object 思考时的起点。",
    },

    payloadScale: {
      title: "规模约束",
      content: `
self 正文可以很长（几千字），不做硬上限；与 knowledge 的 8KB / file 的 32KB 截断不同，
self 文本被视为"必读身份"，每轮整篇注入 Context（不截断）。

设计原因：身份是 Object 的恒定基底，截断会破坏自我一致性。如需控制体积，由 Object
自己通过 reflectable 通道精简 self.md。
      `.trim(),
    },

    injection: {
      title: "Context 注入",
      content: `
每一轮 ThinkLoop 时，self.md 正文会被注入 Context 的 self 字段，作为系统提示的一部分。
注入是无条件的（与 knowledge 的渐进式激活不同）。
      `.trim(),
    },

    injectionUnconditional: {
      kind: "invariant",
      title: "self 注入无条件",
      summary: "不存在「this round 不注入 self」的开关",
      content:
        "不存在「this round 不注入 self」的开关。即使 self 内容跨轮未变，每轮仍重新拼接进入 system prompt。",
      rationale:
        "简化 context-builder 的状态机；并避免 Object 在某一轮「不知道自己是谁」的退化场景。",
    },

    example: {
      kind: "example",
      title: "frontmatter + 正文示例",
      content: `
\`\`\`yaml
---
id: "alan-kay"
desc: "Alan Kay，OOC 项目 Supervisor，负责任务拆分与部门调度。"
---

# 关于我自己
我是 Alan Kay ...

# 我的终极目标
...
\`\`\`
      `.trim(),
    },

    frontmatterFields: {
      title: "frontmatter 字段语义",
      content: `
- id — Object 的稳定标识符，与 stones/{id}/ 目录名一致；改动等于换身份，不允许在
  Flow 运行中被改写
- desc — 一句话自我描述；供 outerReadme 与 contact 通讯录场景复用
      `.trim(),
    },
  },

  outerReadme: {
    title: "外在自我 (readme.md)",
    summary: "stones/{name}/readme.md——对外名片，决定哪些信息暴露给协作方",

    positioning: {
      title: "定位：对外名片",
      content: `
readme 是 Object 的"对外名片"，让其他 Object 能快速判断"这是什么样的对象"。
**不**暴露内在思考与风格偏好。
      `.trim(),
    },

    contactSurface: {
      title: "作为对外协作接口",
      content: `
当另一个对象与本对象交互时，对方 Context 的 knowledge / relation 信息窗口中
会出现本对象的 readme（详见 contact 字段绑定）。

这是身份的"外缘"——只有写进 readme 的内容才会被外部感知。
      `.trim(),
    },

    privacyBoundary: {
      title: "隐私边界",
      content: `
self 内容**不**会自动泄漏到 readme。Object 必须显式编辑 readme 决定对外暴露什么。
两者不同步：改 self 不会触发 readme 重写。
      `.trim(),
    },
  },

  asymmetry: {
    title: "不对称信息披露",
    summary: "self 与 readme 的双面结构带来隐私与协作分层",

    innerChannel: {
      title: "内在通道",
      content: "内在 self → 仅自己读，保护隐私与思考细节。",
    },

    outerChannel: {
      title: "外在通道",
      content: "外在 readme → 协作时对方看到的接口，不要求对方理解全部内心。",
    },

    independentEvolution: {
      title: "独立演化",
      content:
        "两者独立更新：改 self 影响自己的思考方式；改 readme 影响对外形象。改一侧不强制对侧同步。",
    },

    rationale: {
      title: "为什么必须不对称",
      content: `
人 / 协作体的真实情况就是不对称——你不会把所有内心独白印在名片上。
强制对称（self == readme）会导致：

1. 隐私无处安放：所有思考路径都对外可见
2. 协作过载：对方拿到的"名片"几千字，无法快速决策能否合作
3. 演化被锁死：内心想转向时被迫先改名片，反过来限制思考自由

因此 OOC 在数据模型层硬性区分两份文档。
      `.trim(),
    },
  },

  evolution: {
    title: "身份的演化路径",
    summary: "改写只能走 reflectable 的 super 镜像通道，Flow 内禁止直写",

    writeTargets: {
      title: "super 通道可写的目标",
      content: `
- 改写 self.md → 重新定义自己是谁
- 调整 readme.md → 更新对外名片
- 注册新的 server 方法 → 开放新接口
      `.trim(),
    },

    channelConstraint: {
      title: "通道约束",
      content: `
Flow（运行态）必须通过 super 镜像分身的 SuperFlow 通道改写 Stone（静态态）身份。
详见 reflectable 文档（refs.reflectable）。
      `.trim(),
    },

    flowWriteForbidden: {
      kind: "invariant",
      title: "Flow 内不可直写 Stone 身份",
      summary: "普通 Flow 通过 program/talk/do 改 stones/{id}/self.md 会被 persistable 层 reject",
      content: `
普通 Flow 线程通过 program / talk / do 等命令直接写 stones/{id}/self.md 或
readme.md 会被 persistable 层 reject。
      `.trim(),
      rationale: `
- Flow 是临时运行态，crash / 回滚后不应留下身份突变
- 反思属于元层动作，需独立审计通道（即 super 分身的 SuperFlow events）
- 防止 LLM 在普通任务中误改自己的根定义
      `.trim(),
    },
  },

  persistable: persistable_v20260504_1,
  reflectable: reflectable_v20260504_1,

  refs: {
    /** 身份的持久化基底（self.md / readme.md 的读写） */
    persistable: persistable_v20260504_1,
    /** 身份演化的元通道（super 镜像分身） */
    reflectable: reflectable_v20260504_1,
  },
};

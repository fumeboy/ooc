import type { Concept, DocNode } from "@meta/doc-types";
import { object_v20260504_1 } from "@meta/object/index.doc";
import * as stoneObject from "@src/persistable/stone-object";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Reflectable 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * Reflectable 概念：Object 的自我迭代与元编程能力，通过 super 镜像分身
 * （SuperFlow）通道实现。
 *
 * sources（forward-looking 概念，尚无独立源码实现，绑到关系最近的 stone 目录骨架）:
 *  - stoneObject — stones/{id}/ 目录骨架；super 分身落盘在 stones/{id}/super/，
 *    memory/index.md 长期记忆也落在 stones/{id}/knowledge/memory/ 之下
 */
export type ReflectableConcept = Concept & {
  sources: {
    stoneObject: typeof stoneObject;
  };

  /** super 分身通道的角色与与普通 flow 的边界 */
  channel: {
    title: string;
    summary?: string;
    placement: DocNode;
    accessControl: DocNode;
    separation: DocNode;
  };

  /** SuperScheduler 的扫描节奏与触发条件 */
  runtime: {
    title: string;
    summary?: string;
    talkEntry: DocNode;
    superScheduler: DocNode;
    knowledgeActivation: DocNode;
  };

  /** super 线程可写的目标（self / readme / memory / server method） */
  mutations: {
    title: string;
    summary?: string;
    selfMd: DocNode;
    readmeMd: DocNode;
    memoryIndex: DocNode;
    serverMethods: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const reflectable_v20260504_1: ReflectableConcept = {
  name: "Reflectable",
  get parent() {
    return object_v20260504_1;
  },
  sources: {
    stoneObject,
  },
  description: `
Reflectable 是 Object 的自我迭代与元编程能力，通过 super 镜像分身（SuperFlow）
通道实现。
  `.trim(),

  channel: {
    title: "自我修改通道",
    summary: "super 分身的落盘位置、Stone 修改强制路径、修改/执行权分离",

    placement: {
      title: "super 分身落盘位置",
      content: `
每个对象 X 都有一个名为 \`super\` 的 flow，落盘在 \`stones/{name}/super/\`。

**特殊位置约定**：super 是唯一一个落在 Stone 目录下的 Flow——其它 Flow 落在
\`flows/{sid}/objects/{name}/\` 之下。这条例外服务于"super 需要直接写 Stone"的能力。
      `.trim(),
    },

    accessControl: {
      title: "Stone 级修改的强制路径",
      content: `
普通 flow（运行态）不能直接改 Stone（静态态）的身份；任何 Stone 级别的修改
都必须经过 super 分身。
      `.trim(),
    },

    separation: {
      title: "修改权 / 执行权分离",
      content: `
修改权与执行权解耦：执行权属于普通 flow，修改权专属于 super flow。
      `.trim(),
    },
  },

  runtime: {
    title: "运行时",
    summary: "talk 入口 → SuperScheduler 周期扫描 → 能力激活",

    talkEntry: {
      title: "talk 入口",
      content: `
\`talk(target="super", message)\` 会把消息写入 super 的 inbox——与普通 talk 同
通道，差别只在 callee 是自己的 super 分身。
      `.trim(),
    },

    superScheduler: {
      title: "SuperScheduler 扫描",
      content: `
SuperScheduler 负责周期性扫描 super inbox，并触发 super 线程跑 ThinkLoop。
独立调度器：与普通 ThreadScheduler 解耦，避免 super 线程与普通线程争资源。
      `.trim(),
    },

    knowledgeActivation: {
      title: "能力激活",
      content: `
super 线程显式激活 reflectable 知识，进行经验沉淀 / 长期记忆更新 / 自我优化。
激活路径与普通 knowledge 一致（见 \`extendable.kernel_extensions.activationModel\`），
但匹配的 command 仅 super 线程可触发。
      `.trim(),
    },
  },

  mutations: {
    title: "super 可写的目标",
    summary: "self.md / readme.md / memory/index.md / server llm_methods 四类持久层",

    selfMd: {
      title: "self.md",
      content: `
重新定义自己是谁。详见 \`identity.innerSelf\`。
      `.trim(),
    },

    readmeMd: {
      title: "readme.md",
      content: `
更新对外名片。详见 \`identity.outerReadme\`。
      `.trim(),
    },

    memoryIndex: {
      title: "knowledge/memory/index.md",
      content: `
长期记忆索引。详见 \`thinkable.knowledge.specialKinds\`。
      `.trim(),
    },

    serverMethods: {
      title: "server/index.ts 的 llm_methods 注册",
      content: `
开放新接口。详见 \`extendable.contentTypes\`。
      `.trim(),
    },
  },
};

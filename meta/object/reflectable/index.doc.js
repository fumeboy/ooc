import { object_v20260504_1 } from "@meta/object/index.doc";
import * as stoneObject from "@src/persistable/stone-object";

/**
 * Reflectable 概念：Object 的自我迭代与元编程能力，通过 super 镜像分身（SuperFlow）通道实现。
 *
 * sources（forward-looking 概念，尚无独立源码实现，绑到关系最近的 stone 目录骨架）:
 *  - stoneObject — stones/{id}/ 目录骨架；super 分身落盘在 stones/{id}/super/，
 *    memory/index.md 长期记忆也落在 stones/{id}/knowledge/memory/ 之下
 */
export const reflectable_v20260504_1 = {
  name: "Reflectable",
  get parent() { return object_v20260504_1; },
  sources: {
    stoneObject,
  },
  description: `
Reflectable 是 Object 的自我迭代与元编程能力，通过 super 镜像分身（SuperFlow）通道实现。

按子字段展开：

- channel — super 分身通道的角色与与普通 flow 的边界
- runtime — SuperScheduler 的扫描节奏与触发条件
- mutations — super 线程可写的目标（self / readme / memory / server method）
`,

  channel: {
    title: "自我修改通道",
    content: `
OOC 中，Object 的"自我修改"不是直接改写正在执行的 flow，而是通过特殊通道：
**super 镜像分身（SuperFlow）**。详见三个子节点。
    `,

    placement: {
      title: "super 分身落盘位置",
      content: `
每个对象 X 都有一个名为 super 的 flow，落盘在 stones/{name}/super/。
**特殊位置约定**：super 是唯一一个落在 Stone 目录下的 Flow——其它 Flow 落在
flows/{sid}/objects/{name}/ 之下。这条例外服务于"super 需要直接写 Stone"的能力。
      `,
    },

    accessControl: {
      title: "Stone 级修改的强制路径",
      content: `
普通 flow（运行态）不能直接改 Stone（静态态）的身份；任何 Stone 级别的
修改都必须经过 super 分身。
      `,
    },

    separation: {
      title: "修改权 / 执行权分离",
      content: `
修改权与执行权解耦：执行权属于普通 flow，修改权专属于 super flow。
      `,
    },
  },

  runtime: {
    title: "运行时",
    content: `
由三步组成：消息入口、调度器扫描、能力激活。详见子节点。
    `,

    talkEntry: {
      title: "talk 入口",
      content: `
talk(target="super", message) 会把消息写入 super 的 inbox——与普通 talk 同
通道，差别只在 callee 是自己的 super 分身。
      `,
    },

    superScheduler: {
      title: "SuperScheduler 扫描",
      content: `
SuperScheduler 负责周期性扫描 super inbox，并触发 super 线程跑 ThinkLoop。
独立调度器：与普通 ThreadScheduler 解耦，避免 super 线程与普通线程争资源。
      `,
    },

    knowledgeActivation: {
      title: "能力激活",
      content: `
super 线程显式激活 reflectable 知识，进行经验沉淀 / 长期记忆更新 / 自我优化。
激活路径与普通 knowledge 一致（见 extendable.kernel_extensions.activationModel），
但匹配的 command 仅 super 线程可触发。
      `,
    },
  },

  mutations: {
    title: "super 可写的目标",
    content: `
super 线程通过 reflectable 通道可写以下持久层。每个目标一个独立子节点。
    `,

    selfMd: {
      title: "self.md",
      content: `
重新定义自己是谁。详见 identity.innerSelf。
      `,
    },

    readmeMd: {
      title: "readme.md",
      content: `
更新对外名片。详见 identity.outerReadme。
      `,
    },

    memoryIndex: {
      title: "knowledge/memory/index.md",
      content: `
长期记忆索引。详见 thinkable/knowledge.specialKinds。
      `,
    },

    serverMethods: {
      title: "server/index.ts 的 llm_methods 注册",
      content: `
开放新接口。详见 extendable.contentTypes。
      `,
    },
  },
};

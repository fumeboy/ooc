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
`.trim(),

  channel_v20260517_1: {
    index: `
## 自我修改通道

OOC 中，Object 的"自我修改"不是直接改写正在执行的 flow，而是通过特殊通道：
**super 镜像分身（SuperFlow）**。

核心事实：

- 每个对象 X 都有一个名为 \`super\` 的 flow，落盘在 \`stones/{name}/super/\`
- 普通 flow（运行态）不能直接改 Stone（静态态）的身份；任何 Stone 级别的修改都必须
  经过 super 分身
- 修改权与执行权解耦：执行权属于普通 flow，修改权专属于 super flow
`.trim(),
  },

  runtime_v20260517_1: {
    index: `
## 运行时

- \`talk(target="super", message)\` 会把消息写入 super 的 inbox
- SuperScheduler 负责周期性扫描 super inbox，并触发 super 线程跑 ThinkLoop
- super 线程显式激活 reflectable 知识，进行经验沉淀 / 长期记忆更新 / 自我优化
`.trim(),
  },

  mutations_v20260517_1: {
    index: `
## super 可写的目标

super 线程通过 reflectable 通道可写以下持久层：

- \`self.md\` — 重新定义自己是谁（详见 identity.innerSelf）
- \`readme.md\` — 更新对外名片（详见 identity.outerReadme）
- \`knowledge/memory/index.md\` — 长期记忆索引（详见 thinkable/knowledge.specialKinds）
- \`server/index.ts\` 中 \`llm_methods\` 注册 — 开放新接口（详见 extendable.contentTypes）
`.trim(),
  },
};

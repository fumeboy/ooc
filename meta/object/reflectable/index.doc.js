import { object_v20260504_1 } from "@meta/object/index.doc";

export const reflectable_v20260504_1 = {
  get parent() { return object_v20260504_1; },
  index: `
Reflectable 描述 Object 的自我迭代、元编程能力。

在 OOC 中，Object 的“自我修改”不是直接改写正在执行的 flow，
而是通过一个特殊通道：**super 镜像分身（SuperFlow）**。

核心事实：

- 每个对象 X 都有一个名为 \`super\` 的 flow，落盘在 \`stones/{name}/super/\`
- \`talk(target="super", message)\` 会把消息写入 super 的 inbox
- SuperScheduler 负责周期性扫描 super inbox，并触发 super 线程跑 ThinkLoop
- super 线程显式激活 reflectable 知识，并进行经验沉淀 / 长期记忆更新 / 自我优化

`,
};

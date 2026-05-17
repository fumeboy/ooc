import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { reflectable_v20260504_1 } from "@meta/object/reflectable/index.doc";
import { persistable_v20260504_1 } from "@meta/object/persistable/index.doc";
import * as stoneSelf from "@src/persistable/stone-self";
import * as stoneReadme from "@src/persistable/stone-readme";

/**
 * Identity 概念：Object 对自己的双面认知（内在 self.md + 对外 readme.md）。
 *
 * sources:
 *  - stoneSelf   — stones/{id}/self.md 读写（内在自我）
 *  - stoneReadme — stones/{id}/readme.md 读写（对外名片）
 */
export const identity_v20260505_1 = {
  name: "Identity",
  get parent() { return thinkable_v20260504_1; },
  sources: {
    stoneSelf,
    stoneReadme,
  },
  description: `
Identity 是 Object 对自己的双面认知：内在 self（仅自己可见）与外在 readme（他者可见）。

按子字段展开：

- innerSelf — self.md 的语义与用途
- outerReadme — readme.md 的语义与对外接口
- asymmetry — 双面分离带来的隐私与协作分层
- evolution — 通过反思通道改写身份的路径
`.trim(),

  innerSelf_v20260517_1: {
    index: `
## 内在自我 (self.md)

物理位置：\`stones/{name}/self.md\`

承载 Object 的完整自我说明：角色、目标、风格、约束、价值观。可以很长（几千字），
是 Object 思考时的起点。每一轮 ThinkLoop 时，self 文本会被注入 Context 的 self 字段，
作为系统提示的一部分。

frontmatter + 正文示例：

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

  outerReadme_v20260517_1: {
    index: `
## 外在自我 (readme.md)

物理位置：\`stones/{name}/readme.md\`

是 Object 的"对外名片"，让其他 Object 能快速判断"这是什么样的对象"。不暴露内在思考与
风格偏好。当另一个对象与本对象交互时，对方 Context 的 knowledge / relation 信息窗口
中会出现本对象的 readme。
`.trim(),
  },

  asymmetry_v20260517_1: {
    index: `
## 不对称信息披露

self 与 readme 的双面结构对应两条不同的信息流：

- 内在 self → 仅自己读，保护隐私与思考细节
- 外在 readme → 协作时对方看到的接口，不要求对方理解全部内心
- 两者独立更新：改 self 影响自己的思考方式；改 readme 影响对外形象
`.trim(),
  },

  evolution_v20260517_1: {
    index: `
## 身份的演化路径

身份不能在普通 flow 中直接被改写。修改通道由 reflectable 的 super 分身负责：

- 改写 \`self.md\` → 重新定义自己是谁
- 调整 \`readme.md\` → 更新对外名片
- 注册新的 server 方法 → 开放新接口

Flow（运行态）必须通过 super 镜像分身的 SuperFlow 通道改写 Stone（静态态）身份。
详见 reflectable 文档。
`.trim(),
  },

  persistable: persistable_v20260504_1,
  reflectable: reflectable_v20260504_1,
};

import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";

export const identity_v20260505_1 = {
    parent: thinkable_v20260504_1,
    index: `
Identity 描述 Object 对自己的双面认知。

身份分内外两面，如同一个人的"内心独白"与"名片"：

- 内在自我 (thinkable.whoAmI) — 仅自己可见
    - 完整的自我说明：角色、目标、风格、约束、价值观
    - 可以很长（几千字），是 Object 思考时的起点
    - 物理位置：stones/{name}/readme.md 正文（frontmatter 之外）
    - 每一轮 ThinkLoop 注入 Context 的 whoAmI 字段

- 外在自我 (talkable.whoAmI) — 他者可见
    - 极简的对外名片，一两句话介绍
    - 物理位置：stones/{name}/readme.md 的 frontmatter
    - 让其他 Object 能快速判断"这是什么样的对象"
    - 不暴露内在思考、风格偏好

readme.md 的 frontmatter 结构（扁平 schema）:

\`\`\`yaml
---
whoAmI: "Alan Kay，OOC 项目 Supervisor，负责任务拆分与部门调度。"
---

# 关于我自己
我是 Alan Kay ...

# 我的终极目标
...
\`\`\`

注：Object 对外暴露的可调用方法不在 readme.md frontmatter 中，
而是由 server/index.ts 通过 export llm_methods / ui_methods 注册（详见 executable/server）。

为什么"双面"重要：

1. 不对称的信息披露
    - 内在思考保护隐私，不外泄
    - 外在接口减轻他者负担，无须理解全部内心
    - 协作基于公开接口，不依赖内部实现

2. 自我更新路径独立
    - 改写 thinkable.whoAmI → 影响自己的思考方式
    - 改写 talkable.whoAmI → 影响其他对象如何看待自己
    - 两者通常独立演化

身份的演化：

通过反思机制（详见 reflectable），Object 可以：
- 改写 thinkable.whoAmI（重新定义自己是谁）
- 调整 talkable.whoAmI（更新对外名片）
- 注册新的 server 方法（开放新接口）

但 Flow（运行态）不能直接改 Stone（静态态）的身份——
必须通过 super 分身的 SuperFlow 通道（详见 reflectable/super-flow）。
`,
};

import { object_v20260504_1 } from "@meta/object/index.doc";

// 注意：先声明 kernel_extensions（被 extendable 引用），再声明 extendable，
// 否则 extendable 顶层对象字面量初始化时会触发 TDZ 错误。
export const kernel_extensions_v20260506_1 = {
  get parent() { return extendable_v20260504_1; },
  index: `
Kernel Extensions 是所有 Object 共享的内置能力，位于 \`kernel\` 目录下，
  它们定义了"作为 OOC 对象意味着什么"。

## 两层结构

\`\`\`
基座层（默认注入）
  └── kernel:base

能力层（按需激活）
  ├── kernel:executable               代码执行
  ├── kernel:collaborable                 对象间通信
  ├── kernel:reflectable               反思与沉淀
  ├── kernel:plannable                任务规划
  └── kernel:compress                 上下文压缩
\`\`\`

## 基座层

### kernel:base

作为常驻的 knowledge 出现在 context
说明 tool \`open / refine / submit / close / wait / compress\` 的用法、mark 机制、
基本的 form 生命周期约束。

## 能力层

和普通的 knowledge 一样，按需激活。

### kernel:executable

介绍代码执行能力。

\`open(type=command, command=program, ...)\` 会激活本知识。

### kernel:collaborable

触发 command：\`talk\`

对象间通信能力

### kernel:reflectable

反思与沉淀能力。描述如何把经历沉淀为长期 knowledge / 元编程。

### kernel:plannable

触发 command：\`do\` / \`plan\`

任务规划能力。描述如何拆解任务、何时开子线程、plan 文本怎么写。

### kernel:compress

上下文压缩能力。描述如何审视 process events，标记冗余区段，
\`\`\`
`,
};

export const extendable_v20260504_1 = {
  get parent() { return object_v20260504_1; },
  index: `
Extendable 描述 Object 如何扩展自己的认知与能力。

Object 的能力来自三种内容：
- **knowledge**  ── 知识文档（markdown + frontmatter，通过 activates_on 渐进式激活）
- **server**     ── 后端方法（TypeScript 函数，分 llm_methods / ui_methods 两个索引）
- **client**     ── 前端 React UI 组件

这三类内容可以来自三个来源：

\`\`\`
kernel/        系统内置
   ↓
library/       公共资源库 (待实现扩展机制)
   ↓
stones/{name}/ 或者 flows/{sessionId}/objects/{name}   Object 自己的
\`\`\`
`,
  kernel_extensions: kernel_extensions_v20260506_1,
};

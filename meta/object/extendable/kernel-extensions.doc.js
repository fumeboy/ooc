import { extendable_v20260504_1 } from "@meta/object/extendable/index.doc";

export const kernel_extensions_v20260506_1 = {
    parent: extendable_v20260504_1,
    index: `
Kernel Extensions 是所有 Object 共享的内置能力，位于 \`kernel/{knowledge,server,client}/\` 下，
namespace=kernel。它们定义了"作为 OOC 对象意味着什么"。

## 两层结构

\`\`\`
基座层（默认注入）
  └── kernel:base                     指令系统基座（open/refine/submit/close/wait 五原语）

能力层（按需激活）
  ├── kernel:computable               代码执行
  ├── kernel:talkable                 对象间通信
  ├── kernel:reflective               反思与沉淀
  ├── kernel:plannable                任务规划
  └── kernel:compress                 上下文压缩
\`\`\`

## 基座层

### kernel:base

协议基座。每个 Object 的每一轮 ThinkLoop 都自动注入。
定义五原语 \`open / refine / submit / close / wait\` 的用法、mark 机制、
基本的 form 生命周期约束。

不依赖 activates_on——它就是 OOC 协议本身的一部分。

## 能力层

按需激活，完成后自动卸载（pinned 除外）。

### kernel:computable

触发 command：\`program\`

代码执行能力。activates_on.show_content_when 含 \`program\`——
任何 \`open(type=command, command=program, ...)\` 都会激活本知识。

子 knowledge（默认以 description 形式可见）：
- \`kernel:computable/program_api\`    完整 API 参考
- \`kernel:computable/file_ops\`       文件读写
- \`kernel:computable/file_search\`    glob / grep
- \`kernel:computable/shell_exec\`     shell 命令执行
- \`kernel:computable/web_search\`     互联网搜索
- \`kernel:computable/code_index\`     代码索引 / 符号查询

server methods（始终注册）：readFile / writeFile / glob / grep / exec 等。

没有它，Object 无法行动。

### kernel:talkable

触发 command：\`talk\`

对象间通信能力。describes talk 的语义、cross-object 协议、关系网更新。

子 knowledge：
- \`kernel:talkable/cross_object\`     跨对象函数调用协议
- \`kernel:talkable/ooc_links\`        ooc:// 链接与导航卡片
- \`kernel:talkable/relation_update\`  关系网更新协议
- \`kernel:talkable/issue_discussion\` Issue 讨论与评论

没有它，Object 是孤岛。

### kernel:reflective

触发 command：（无显式触发，由 super 分身在反思线程上手动激活）

反思与沉淀能力。描述如何把经历沉淀为长期 knowledge / 修改 self.md。

server methods：persist_to_memory / create_knowledge 等
（仅 super 分身的反思线程使用——其他线程没有写 stones/{name}/knowledge 的权限）。

没有它，Object 不会成长。详见 reflectable/super-flow。

### kernel:plannable

触发 command：\`do\` / \`plan\`

任务规划能力。描述如何拆解任务、何时开子线程、plan 文本怎么写。

### kernel:compress

触发 command：\`compress\`

上下文压缩能力。描述如何审视 process events，标记冗余区段，
通过 compress marks 生成摘要并截断。

## 组合效应

这些能力单独看只是工具，组合起来定义了"合格的 OOC 对象"：

\`\`\`
computable × talkable    = 能协作执行的智能体
computable × reflective  = 能从错误中学习的智能体
plannable  × computable  = 会拆任务且会执行的智能体
完整组合                  = 最小可行的、能自我进化的 OOC 对象
\`\`\`

## 激活策略

- **基座层**：\`kernel:base\` 由系统默认注入，所有线程的所有轮都可见
- **能力层**：默认不加载，靠 \`activates_on.show_content_when\` 命中或 \`open(type=knowledge, name=...)\` 显式激活
- **描述层**：父 knowledge 激活时，其子 knowledge 默认以一行 description 出现在 Context 里
  （不需要在子 knowledge 上单独声明 show_description_when）

## 与 server 的关系

每个 kernel knowledge 通常对应一个 \`kernel/server/{name}/index.ts\` 模块，
里面 export llm_methods / ui_methods。

server 方法**始终注册**到 MethodRegistry——但 LLM 只在对应 knowledge 进入 Context 时
才"知道"可以调用这些方法。

例：\`kernel:computable\` 未激活时，sandbox 里 \`await callMethod("kernel:computable", "readFile", ...)\`
**仍然能跑**（注册一直在），但 LLM 没看到 computable.md 描述，正常情况下不会主动这样调。
\`\`\`
`,
};

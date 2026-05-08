import { executable_v20260504_1 } from "@meta/object/executable/index.doc";

export const commands_v20260506_1 = {
  parent: executable_v20260504_1,
  index: `
Commands 是 LLM 通过 \`open(type=command, command=X)\` 调用的"具体行动单元"。

LLM 基本行动只依赖这些 tool（open / refine / submit / close / wait），
而实际行为由 open 时指定的 command 决定。

## 内置 command 清单

| command | 作用 |
|---|---|
| program  | 执行一段沙箱代码 / 调用 server 方法 |
| talk     | 向另一个 Object 的某个线程发送消息 |
| do       | 派生子线程 / 向已有子线程追加消息 |
| plan     | 设置或更新当前线程的计划文本 |
| defer    | 注册 command hook（详见 actions/tools/defer） |
| end      | 主动标记本线程完成 |

## Command Path 机制

每个 command 可以注册若干 command path（点分字符串），用作 knowledge 激活的匹配键。

例：talk command 注册的 paths：

\`\`\`
talk
talk.fork // 新开线程
talk.continue // 继续已有线程
talk.wait // talk 并等待回复
talk.thread_creator // talk to thread creator
talk.relation_update // 要求 talk 对方主动更新和自己的 relation
talk.question_form // 发起一个结构化问题，引导回答，一般用于向 user 提问
\`\`\`

当 LLM \`open(type=command, command=talk, ...)\` 后逐步 refine 参数时，根据当前 args 决定**激活哪些 path**：

\`\`\`
open(command=talk)                              → 路径=[talk]
refine({ context: "continue" })                 → 路径=[talk, talk.continue]
refine({ type: "relation_update" })             → 路径=[talk, talk.continue,
                                                       talk.relation_update]
\`\`\`

每个 knowledge 在 frontmatter 里通过 \`activates_on.show_content_when\` 或者 \`activates_on.show_description_when\` 声明
**自己关心哪些 path**（一个或多个）；任意一条命中即激活该 knowledge：

这种"command 列举所有可能 path → knowledge 选择关心的 path"模型让能力按需挂入：
LLM 还没决定要做"带关系更新的 talk"时，relation_update 的完整说明不会污染 Context。

## form 与 commands 的关系

每次 \`open(type=command, command=X)\` 都会创建一个 form：

- form 持有当前 command + args + 已加载的 knowledge id 列表
- refine 累积参数 → 重新计算 paths → 增量激活 knowledge
- submit form 后， command 才真正执行
- close form 放弃执行

## 各 command 详解

- [program](./program.doc.js) — 沙箱代码执行 / server 方法调用
- [talk](./talk.doc.js) — 跨对象 / 跨线程消息
- [do](./do.doc.js) — 子线程派生 / 续写
- [plan](./plan.doc.js) — 线程计划文本
- [end](./end.doc.js) — 标记线程任务结束
- [defer](./defer.doc.js) — 注册 command hook
`,
};

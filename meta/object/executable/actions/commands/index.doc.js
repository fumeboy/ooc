import { executable_v20260504_1 } from "@meta/object/executable/index.doc";

export const commands_v20260506_1 = {
    parent: executable_v20260504_1,
    index: `
Commands 是 LLM 通过 \`open(type=command, command=X)\` 调用的"具体行动单元"。

LLM 永远只面向 5 个 tool（open / refine / submit / close / wait），
但 submit 触发的实际行为由 command 决定。

## 内置 command 清单

| command | 作用 |
|---|---|
| program  | 执行一段沙箱代码 / 调用 server 方法 |
| talk     | 向另一个 Object 的某个线程发送消息 |
| do       | 派生子线程 / 向已有子线程追加消息 |
| plan     | 设置或更新当前线程的计划文本 |
| compress | 压缩本线程的 process events |
| defer    | 注册 command hook（详见 actions/tools/defer） |
| end      | 主动标记本线程已无剩余任务 |

## Command 的注册模型

每个 command 在 \`kernel/src/executable/commands/{name}.ts\` 注册一个 \`CommandTableEntry\`：

\`\`\`typescript
interface CommandTableEntry {
  paths: string[];                                       // 该 command 可能产出的所有路径
  match: (args: Record<string, unknown>) => string[];    // 给定 args 计算激活路径子集
  openable?: boolean;                                    // 是否可被 open(type=command) 选中
  exec?: (ctx: CommandExecutionContext) => Promise<void>;// 真正执行的回调
}
\`\`\`

## Command Path 机制

每个 command 可以注册若干 path（点分字符串），用作 knowledge 激活的匹配键。

例：talk command 注册的 paths：

\`\`\`
talk
talk.fork
talk.continue
talk.new
talk.wait
talk.relation_update
talk.question_form
talk.continue.relation_update
talk.continue.question_form
\`\`\`

当 LLM \`open(type=command, command=talk, ...)\` 后逐步 refine 参数时，
\`talk.match(accumulatedArgs)\` 根据当前 args 决定**激活哪些 path**：

\`\`\`
open(command=talk)                              → 路径=[talk]
refine({ context: "continue" })                 → 路径=[talk, talk.continue]
refine({ type: "relation_update" })             → 路径=[talk, talk.continue,
                                                       talk.relation_update,
                                                       talk.continue.relation_update]
\`\`\`

每个 knowledge 在 frontmatter 里通过 \`activates_on.show_content_when\` 声明
**自己关心哪些 path**（一个或多个）；任意一条命中即激活该 knowledge：

\`\`\`yaml
# kernel/knowledge/talkable/relation_update.md
---
activates_on:
  show_content_when: [talk.relation_update]
---
\`\`\`

这种"command 列举所有可能 path → knowledge 选择关心的 path"模型让能力按需挂入：
LLM 还没决定要做"带关系更新的 talk"时，relation_update 的完整说明不会污染 Context。

## form 与 commands 的关系

每次 \`open(type=command, command=X)\` 都会创建一个 form：

- form 持有当前 command + accumulatedArgs + 已加载的 knowledge id 列表
- refine 累积参数 → 重新计算 paths → 增量激活 knowledge
- submit 调 \`COMMAND_TABLE[command].exec(ctx)\` 真正执行
- close 放弃执行

详见 actions/tools/index 的 "form 是行动的暂存格" 段落。

## 各 command 详解

- [program](./program.doc.js) — 沙箱代码执行 / server 方法调用
- [talk](./talk.doc.js) — 跨对象 / 跨线程消息
- [do](./do.doc.js) — 子线程派生 / 续写
- [plan](./plan.doc.js) — 线程计划文本
- [compress](./compress.doc.js) — 上下文压缩
- [end](./end.doc.js) — 标记线程任务结束

defer command 因其"系统级"性质归在 [actions/tools/defer](../tools/defer.doc.js)。
`,
};

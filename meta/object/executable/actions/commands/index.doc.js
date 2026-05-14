import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import * as commandsSource from "@src/executable/commands/index";

// parent 改为 getter 以打破 executable/index ↔ commands/index 的循环初始化死锁。
export const commands_v20260506_1 = {
  get parent() { return executable_v20260504_1; },
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
| todo     | 登记一个可见待办，可选在命中特定 command/path 时提醒 |
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

## form 与 commands 的关系（Step 1 重构 — spec 2026-05-14）

每次 \`open(parent_window_id?, command=X, ...)\` 都会创建一个 **command_exec window** 作为 sub-window：

- 它就是旧 form 概念的新身份；行为字段（accumulatedArgs / commandPaths / loadedKnowledgePaths / status / result）一一对应
- refine 累积参数 → 重新计算 paths → 增量激活 knowledge
- submit 后 command 真正执行；**成功时该 form 自动从 contextWindows 移除**，无需 close
- 失败时保留 executed + result 字段，需要 LLM 显式 close
- C 规则：open 时给齐 args + 不引入新 knowledge → 跳过 refine/submit，自动一次到位

某些 command 的 submit 还会副作用产出**新 window**：
- root.do  → do_window  （挂在父 thread 下）
- root.todo → todo_window（C 规则常命中，open 即建）
- root.program / root.talk → 待 Step 2 改造为 program_window / talk_window

## 各 command 详解

- [program](./program.doc.js) — 沙箱代码执行 / server 方法调用
- [talk](./talk.doc.js) — 跨对象 / 跨线程消息
- [do](./do.doc.js) — 子线程派生 / 续写
- [plan](./plan.doc.js) — 线程计划文本
- [todo](./todo.doc.js) — 可见待办与条件提醒
- [end](./end.doc.js) — 标记线程任务结束
`,
  sources: {
    commands: commandsSource,
  },
};

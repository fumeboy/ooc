import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import * as commandsSource from "@src/executable/windows/root/index";

// parent 改为 getter 以打破 executable/index ↔ commands/index 的循环初始化死锁。
export const commands_v20260506_1 = {
  get parent() { return executable_v20260504_1; },
  name: "Commands",
  get description() { return this.index; },
  index: `
Commands 是 LLM 通过 \`open(type=command, command=X)\` 调用的"具体行动单元"。

LLM 基本行动只依赖这些 tool（open / refine / submit / close / wait），
而实际行为由 open 时指定的 command 决定。

## 内置 command 清单

| command         | 作用 | 副作用 |
|---|---|---|
| program         | 执行代码 / 调用 server 方法 | 创建 program_window，首次 exec 立即跑完，后续可在窗口内反复 exec |
| talk            | 与 user 持续会话（当前 target 仅 user） | 创建 talk_window；发消息走 talk_window.say |
| do              | 派生子线程 | 创建 child thread + do_window；continue/wait/close 是 do_window 的命令 |
| plan            | 写 thread.plan | 仅副作用，不产生 window |
| todo            | 登记可见待办 | 创建 todo_window（args 给齐时 open 立即提交 form） |
| end             | 标记线程完成 | 仅副作用 |
| open_file       | 把文件引入 context | 创建 file_window；set_range/reload/edit/close |
| open_knowledge  | 显式打开 knowledge doc | 创建 knowledge_window；activator 视为 force-full |
| write_file      | 创建或覆盖一个文件 | 写盘 + 自动 spawn file_window；后续走 file_window.edit |
| glob            | 按文件名通配符查找 | 创建 search_window kind=glob；后续可 open_match(index) |
| grep            | 按正则在文件内容里搜索 | 创建 search_window kind=grep（含 line+snippet）；后续可 open_match(index) |

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
- 有时当 args 完整时，open 会立刻提交 form 而无需再额外 submit，这由各个具体 command 的实现自行控制——给齐 args 就能跳过 refine/submit 一步到位

某些 command 的 submit 还会副作用产出**新 window**：
- root.do  → do_window  （挂在父 thread 下）
- root.todo → todo_window（args 给齐时 open 立即提交 form，一步直建）
- root.program → program_window
- root.talk → talk_window

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

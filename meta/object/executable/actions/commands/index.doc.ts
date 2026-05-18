import type { Concept, DocNode, ExampleNode } from "@meta/doc-types";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import { do_v20260514_1 } from "@meta/object/executable/actions/commands/do.doc";
import { end_v20260506_1 } from "@meta/object/executable/actions/commands/end.doc";
import { glob_v20260516_1 } from "@meta/object/executable/actions/commands/glob.doc";
import { grep_v20260516_1 } from "@meta/object/executable/actions/commands/grep.doc";
import { open_file_v20260514_1 } from "@meta/object/executable/actions/commands/open-file.doc";
import { open_knowledge_v20260514_1 } from "@meta/object/executable/actions/commands/open-knowledge.doc";
import { plan_v20260506_1 } from "@meta/object/executable/actions/commands/plan.doc";
import { program_v20260514_1 } from "@meta/object/executable/actions/commands/program.doc";
import { talk_v20260514_1 } from "@meta/object/executable/actions/commands/talk.doc";
import { todo_v20260514_1 } from "@meta/object/executable/actions/commands/todo.doc";
import { write_file_v20260516_1 } from "@meta/object/executable/actions/commands/write-file.doc";
import * as commandsSource from "@src/executable/windows/root/index";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Commands 聚合层全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Commands 概念：LLM 通过 open(type=command, command=X) 调用的"具体行动单元"。
 *
 * 11 个内置 command 各自有独立 .doc.ts 文件，本概念是聚合层：
 *  - 总览每个 command 的作用与副作用
 *  - 描述 command path / knowledge 协作机制
 *  - 描述 command_exec form 的生命周期
 *
 * sources:
 *  - commands — root command 集合的注册入口
 */
export type CommandsConcept = Concept & {
  sources: { commands: typeof commandsSource };

  /** 11 个内置 command 一览表 + 每个 command 引向独立子概念 */
  builtInCommands: {
    title: string;
    summary?: string;
    content?: string;
    program: Concept;
    talk: Concept;
    do: Concept;
    plan: Concept;
    todo: Concept;
    end: Concept;
    openFile: Concept;
    openKnowledge: Concept;
    writeFile: Concept;
    glob: Concept;
    grep: Concept;
  };

  /** Command Path 机制：command 列举所有可能 path、knowledge 选择关心的 path */
  commandPathMechanism: {
    title: string;
    summary?: string;
    pathRegistration: ExampleNode;
    pathActivation: ExampleNode;
    knowledgeMatching: DocNode;
  };

  /** command_exec form（即"form"）的生命周期与窗口产物 */
  formLifecycle: {
    title: string;
    summary?: string;
    formAsCommandExecWindow: DocNode;
    refineLoop: DocNode;
    submitSuccessRemoval: DocNode;
    submitFailureRetention: DocNode;
    oneShotSubmit: DocNode;
    spawnedWindows: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

// parent 用 getter 打破 executable/index ↔ commands/index 的循环初始化死锁。
export const commands_v20260506_1: CommandsConcept = {
  name: "Commands",
  get parent() {
    return executable_v20260504_1;
  },
  sources: { commands: commandsSource },
  description: `
Commands 是 LLM 通过 open(type=command, command=X) 调用的"具体行动单元"。
LLM 基本行动只依赖 5 个 tool（open / refine / submit / close / wait），
而实际行为由 open 时指定的 command 决定。
`.trim(),

  builtInCommands: {
    title: "内置 command 一览",
    summary: "11 个 command；详情见各子概念",
    content: `
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
    `.trim(),

    program: program_v20260514_1,
    talk: talk_v20260514_1,
    do: do_v20260514_1,
    plan: plan_v20260506_1,
    todo: todo_v20260514_1,
    end: end_v20260506_1,
    openFile: open_file_v20260514_1,
    openKnowledge: open_knowledge_v20260514_1,
    writeFile: write_file_v20260516_1,
    glob: glob_v20260516_1,
    grep: grep_v20260516_1,
  },

  commandPathMechanism: {
    title: "Command Path 机制",
    summary: "command 列举所有 path、knowledge 选择关心的 path",

    pathRegistration: {
      kind: "example",
      title: "path 注册",
      summary: "talk 注册的 6 条 path 示例",
      content: `
例：talk command 注册的 paths：

\`\`\`
talk
talk.fork                // 新开线程
talk.continue            // 继续已有线程
talk.wait                // talk 并等待回复
talk.thread_creator      // talk to thread creator
talk.relation_update     // 要求 talk 对方主动更新和自己的 relation
talk.question_form       // 发起一个结构化问题，引导回答，一般用于向 user 提问
\`\`\`
      `.trim(),
    },

    pathActivation: {
      kind: "example",
      title: "path 激活",
      summary: "args 增量 refine 时累积激活路径",
      content: `
LLM open(type=command, command=talk, ...) 后逐步 refine 参数时，根据当前 args
决定激活哪些 path：

\`\`\`
open(command=talk)                              → 路径=[talk]
refine({ context: "continue" })                 → 路径=[talk, talk.continue]
refine({ type: "relation_update" })             → 路径=[talk, talk.continue,
                                                       talk.relation_update]
\`\`\`
      `.trim(),
    },

    knowledgeMatching: {
      title: "knowledge 匹配 path",
      summary: "knowledge frontmatter 声明 activates_on，命中任意一条即激活",
      content: `
每个 knowledge 在 frontmatter 通过 activates_on.show_content_when 或
activates_on.show_description_when 声明自己关心哪些 path（一个或多个）；
任意一条命中即激活该 knowledge。

这种"command 列举所有可能 path → knowledge 选择关心的 path"模型让能力按需挂入：
LLM 还没决定要做"带关系更新的 talk"时，relation_update 的完整说明不会污染 Context。
      `.trim(),
    },
  },

  formLifecycle: {
    title: "form 生命周期",
    summary: "每次 open 创建 command_exec sub-window 承载该 command 执行流程",

    formAsCommandExecWindow: {
      title: "form == command_exec window",
      summary: "form 即 command_exec window，5 个行为字段",
      content: `
行为字段：
- accumulatedArgs — refine 累积的业务参数
- commandPaths — 当前激活的 command path 集合
- loadedKnowledgePaths — 当前激活的 knowledge 路径
- status — open / executing / executed
- result — submit 后写入的执行结果
      `.trim(),
    },

    refineLoop: {
      title: "refine 阶段",
      content: "refine 累积参数 → 重新计算 paths → 增量激活 knowledge。",
    },

    submitSuccessRemoval: {
      title: "submit 成功 → 自动移除",
      content: "submit 后 command 真正执行；成功时该 form 自动从 contextWindows 移除，无需 close。",
    },

    submitFailureRetention: {
      title: "submit 失败 → 保留 result + 等 close",
      content: "失败时保留 status=executed + result 字段，需要 LLM 显式 close。",
    },

    oneShotSubmit: {
      title: "args 完整时一步直建",
      content: `
有时 args 给齐时 open 会立刻提交 form 而无需再额外 submit，
由各个具体 command 的实现自行控制——给齐 args 就能跳过 refine/submit 一步到位。
      `.trim(),
    },

    spawnedWindows: {
      title: "submit 副作用产出的新 window",
      summary: "do / todo / program / talk 的 submit 产出对应 window",
      content: `
某些 command 的 submit 会副作用产出新 window：

- root.do  → do_window  （挂在父 thread 下）
- root.todo → todo_window（args 给齐时 open 立即提交 form，一步直建）
- root.program → program_window
- root.talk → talk_window
      `.trim(),
    },
  },

  refs: {
    /** 11 个子 command 概念，便于跨概念引用 */
    program: program_v20260514_1,
    talk: talk_v20260514_1,
    do: do_v20260514_1,
    plan: plan_v20260506_1,
    todo: todo_v20260514_1,
    end: end_v20260506_1,
    openFile: open_file_v20260514_1,
    openKnowledge: open_knowledge_v20260514_1,
    writeFile: write_file_v20260516_1,
    glob: glob_v20260516_1,
    grep: grep_v20260516_1,
  },
};

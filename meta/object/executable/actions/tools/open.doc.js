import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as openSource from "@src/executable/tools/open";

export const open_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  name: "Open",
  sources: { open: openSource },
  description: `
open 是 LLM "开始一次行动 / 加载一个资源到 Context" 的统一入口。

按 type 参数分支处理三种形态，并通过 parent_window_id 支持挂载到已有 window
下作为 sub-window。

按子字段展开：

- typeBranches — type=command / knowledge / file 三种调用分支
- todoEntry — todo 不走独立 type，统一走 type=command 的入口形态
- universalParams — 任意 open 调用都可携带的附加参数（mark / deps / title 等）
- returnValue — 不同 type 的返回值差异
`,

  typeBranches: {
    title: "type Branches",
    content: `
type 决定 open 的语义：command 创建可执行 form；knowledge / file 只是把资源
挂入 Context。详见各子字段。
    `,

    typeCommand: {
      title: "type=command",
      content: `

open(
  type="command",
  command="program",        // 必填，目标 command 名（详见 actions/commands）
  title="...",              // 为本次行动提供一个标题
  description="…",          // 简短说明本次行动的意图
  args?: {...}              // 可选；等价于 open + refine(args)
)


行为：
1. 创建 command_exec window（即 form），分配 form_id
2. 根据 command 与当前 args 解析激活的 command path 集合
3. 激活路径对应的 knowledge（activates_on.show_content_when /
   activates_on.show_description_when 命中）进入 Context
4. 返回 { form_id } 供后续 refine / submit / close 引用

协议约束：
- open(type="command") 的职责是"创建 form"
- 已知业务参数可直接放到 args；缺参后续用 refine(form_id, form_args={...}) 补齐
- 不要把 language / code / function 等业务参数写进 description

特例：open(type=command, command=program, args={ function, args }) 命中已注册
server method 时，open 阶段就先按当前参数加载方法知识，把相关 path 写到 form 的
commandKnowledgePaths——program.function 的帮助信息在 open/refine 阶段就影响
下一轮 context。

部分 command（todo / open_file / open_knowledge / talk / write_file / glob /
grep）在 args 给齐时 open 立即提交 form，无需再 refine/submit。
      `,
    },

    typeKnowledge: {
      title: "type=knowledge",
      content: `

open(
  type="knowledge",
  description="想看 file_ops 的完整 API",
  args?: {
      path:    "path/computable/file_ops",  // 必填，knowledge filepath
      lines?:  [0, 200],                    // 可选，行号窗口，默认 200 行，[0, -1] 表示全文
      columns?:[0, 200]                     // 可选，每行最多展示多少字符，默认 200 字符，[0, -1] 表示全行
  }
)


行为：在 thread.contextWindows 下挂一个 type=knowledge 的 window，作为渐进披露
之外的"显式 pin"路径。adaptor 视为 force-full（详见 open_knowledge command）。

适用场景：临时想查阅某篇 knowledge 全文，与当前 form 的 command 无关。
      `,
    },

    typeFile: {
      title: "type=file",
      content: `

open(
  type="file",
  description="…",
  args?: {
      path:    "path/computable/file_ops",  // 必填，filepath
      lines?:  [0, 200],                    // 可选，行号窗口，默认 200 行，[0, -1] 表示全文
      columns?:[0, 200]                     // 可选，每行最多展示多少字符，默认 200 字符，[0, -1] 表示全行
  }
)


行为：
- open 只记录窗口元信息（path / lines / columns / description）
- 渲染时按 path 读取文件正文并塞进 <content>
- lines / columns 作为元数据保留；当前渲染层尚未按窗口裁剪
      `,
    },
  },

  todoEntry: {
    title: "todo Entry",
    content: `
todo 不走独立 type=todo 分支，而是统一走 command 入口：


open(
  type="command",
  command="todo",
  description="登记一个待办",
  args: {
    content: "补充 program 的真实链路测试",
    on_command_path: ["program.function"]
  }
)


args 给齐时 open 立即提交 form，产出独立的 todo_window。
后续完成 / 撤销通过 close(window_id="<todo_window_id>")。
    `,
  },

  universalParams: {
    title: "universal Params",
    content: `
任意 open 调用都可携带以下顶层参数，与 type / command 正交。
    `,

    titleParam: {
      title: "title",
      content: `
为本次行动提供人类可读标签，用于多窗口区分（如同 target 多开 talk 时区分会话主题）。
      `,
    },

    parentWindowIdParam: {
      title: "parent_window_id",
      content: `
把新创建的 window 挂为已有 window 的 sub-window。
典型用法：open(parent_window_id="<talk_window_id>", command="say", ...) 在
talk_window 上调用其注册的 say command。
      `,
    },

    markParam: {
      title: "mark",
      content: `
标记 inbox 消息（详见 actions/tools/mark）。任意 tool 调用都可携带。
      `,
    },

    depsParam: {
      title: "deps",
      content: `
声明本次 tool 调用基于哪些信息作出决策，用于事后归因 / 时间线展示。
任意 tool 调用都可携带。
      `,
    },
  },

  returnValue: {
    title: "return Value",
    content: `
- open(type=command) 返回 { form_id: string }；后续 refine / submit / close
  都需引用这个 form_id。
- open(type=knowledge|file) 不产生 form，只把资源挂入 Context；返回 window id
  供后续 close 使用。
    `,
  },
};

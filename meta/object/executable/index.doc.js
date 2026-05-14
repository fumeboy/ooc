import { object_v20260504_1 } from "@meta/object/index.doc";
import { reflectable_v20260504_1 } from "@meta/object/reflectable/index.doc";
import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import { server_v20260506_1 } from "@meta/object/executable/server/index.doc";
import { client_v20260506_1 } from "@meta/object/executable/client/index.doc";

// 引用源代码模块
import * as executable_tools from "@src/executable/tools/index";
import * as executable_commands from "@src/executable/windows/root/index";
import * as executable_windows from "@src/executable/windows/index";

export const executable_v20260504_1 = {
  get parent() { return object_v20260504_1; },
  index: `
Executable 描述 Object 的行动 / 编程能力。

## ContextWindow（Step 1 — spec 2026-05-14）

整套行动协议围绕 **ContextWindow** 抽象统一：每个 thread 持有一组 context window
（root / command_exec / do / todo / 后续 talk / program / file / knowledge），
LLM 通过 5 原语 \`open / refine / submit / close / wait\` 与 window 交互。

- root window 注册 do/talk/program/plan/end/todo 等顶层 command
- command_exec window 是调用某 command 时产生的 sub-window（旧 form 概念新身份）
- do_window / todo_window 是 submit 副作用产出的持久 window
- 详细设计见 docs/superpowers/specs/2026-05-14-context-window-unification-design.md

三部分：

1. **如何进行行动**（actions）
    - tools：LLM 直接调用的原语（open / refine / submit / close / wait / compress）
    - commands：root window 上注册的具体行动（program / talk / do / plan / todo / end）
    - 通过 command_exec 把"参数填写"和"执行"分开，让复杂行动可分步思考

2. **如何编写后端方法**（server）
    - 每个 server 模块 export llm_methods / ui_methods 两个函数索引
    - 执行 command \`program\` 来执行 ts/js 脚本时，可以在脚本里调用 server export 的函数；
    - 前端通过 HTTP call_method 调用 ui_methods

3. **如何编写前端界面**（client）
    - React 组件，给人看不给 LLM 看
    - server 的 ui_methods 是 client 唯一可调入口

Executable 还负责维护默认注入的协议知识（用于告诉 LLM 如何与系统进行交互）：

- 每轮都会把基础 executable 协议知识整理进 context
- command 级知识由 \`command.match(args) -> paths\` 与 \`command.knowledge(...)\` 动态派生
- 对于 object 自定义的 server method 的知识也会在 执行 command program 时动态计算

## 渐进式披露

整个行动机制围绕**渐进式披露**设计：

\`\`\`
LLM 想做某件事
   ↓
open(parent_window_id?, command=X) 表达意图，分配 form_id
（如 args 已给齐 → C 规则触发自动 submit）
   ↓
对应 knowledge 进入 Context（LLM 看到完整 API、注意事项、示例）
   ↓
LLM 在已知信息基础上 refine 参数（可多次累积）
   ↓
refine 触发新的 command path → 增量激活更多 knowledge
   ↓
LLM 想清楚后 submit 执行
   ↓
form 切到 executing 状态
   ↓
command 完成且成功 → form 自动从 contextWindows 移除；
                    若产出新 window（do_window 等），新 window 挂在 root 下
失败 → form 保留 executed + result，等 LLM 显式 close
\`\`\`

意义：Context 每一刻只装载"当前必需"的知识，而不是预先塞满所有可能用到的能力描述。

## 子领域

- [actions/tools](./actions/tools/index.doc.js) — 5 原语 + mark
- [actions/commands](./actions/commands/index.doc.js) — submit 触发的具体行动
- [server](./server/index.doc.js) — 后端方法注册与调用
- [client](./client/index.doc.js) — 前端 React 组件

## 对应源代码

src/executable/
- tools/    — 5 原语实现
- commands/ — root window 注册的命令实现
- windows/  — ContextWindow 抽象、registry、WindowManager、各 type 实现
- server/   — server method 装载、enrich
`,
  tools: tools_v20260506_1,
  commands: commands_v20260506_1,
  server: server_v20260506_1,
  client: client_v20260506_1,
  reflectable: reflectable_v20260504_1,
  sources: {
    tools: executable_tools,
    commands: executable_commands,
    windows: executable_windows,
  }
};

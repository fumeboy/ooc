import { object_v20260504_1 } from "@meta/object/index.doc";
import { reflectable_v20260504_1 } from "@meta/object/reflectable/index.doc";
import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import { server_v20260506_1 } from "@meta/object/executable/server/index.doc";
import { client_v20260506_1 } from "@meta/object/executable/client/index.doc";

// 顶层概念：每个文件 = 一个具名概念对象 + sources 锁定 src module。
// 见 docs/solutions/conventions/meta-concept-graph-2026-05-15.md
import { context_window_v20260515_1 } from "@meta/object/executable/concepts/context-window.doc";
import { window_registry_v20260515_1 } from "@meta/object/executable/concepts/window-registry.doc";
import { window_manager_v20260515_1 } from "@meta/object/executable/concepts/window-manager.doc";
import { progressive_disclosure_v20260515_1 } from "@meta/object/executable/concepts/progressive-disclosure.doc";
import { creator_window_v20260515_1 } from "@meta/object/executable/concepts/creator-window.doc";
import { command_exec_lifecycle_v20260515_1 } from "@meta/object/executable/concepts/command-exec-lifecycle.doc";
import { knowledge_activation_v20260515_1 } from "@meta/object/executable/concepts/knowledge-activation.doc";

// 按 window type 拆出的概念：每种 type 上的命令面 + 副作用
import { talk_window_v20260515_1 } from "@meta/object/executable/windows/talk-window.doc";
import { do_window_v20260515_1 } from "@meta/object/executable/windows/do-window.doc";
import { todo_window_v20260515_1 } from "@meta/object/executable/windows/todo-window.doc";
import { program_window_v20260515_1 } from "@meta/object/executable/windows/program-window.doc";
import { file_window_v20260515_1 } from "@meta/object/executable/windows/file-window.doc";
import { knowledge_window_v20260515_1 } from "@meta/object/executable/windows/knowledge-window.doc";

// 引用源代码模块
import * as executable_tools from "@src/executable/tools/index";
import * as executable_commands from "@src/executable/windows/root/index";
import * as executable_windows from "@src/executable/windows/index";

export const executable_v20260504_1 = {
  get parent() { return object_v20260504_1; },
  description: `
Executable 描述 Object 的行动 / 编程能力。

- root window 注册顶层 command（do/talk/program/plan/end/todo/open_file/open_knowledge）
- LLM 通过 5 原语 \`open / refine / submit / close / wait\` 与 contextWindows 交互
- 知识协议（KNOWLEDGE / ROOT_KNOWLEDGE / 各 command knowledge / 各 window basicKnowledge）
  每轮自动合成进 context，由 collectExecutableKnowledgeEntries 派生

具体设计点见 \`concepts.*\` 各条；子领域见 tools / commands / server / client。
`.trim(),
  /**
   * 概念集合：每条都是具名 JS 对象，可作为 LLM context 拉取的最小单元单独引用，
   * 例如 executable_v20260504_1.concepts.contextWindow。
   *
   * 新增概念：在 ./concepts/ 下加文件 + 在此 import + 在该 record 加一个 key 即可。
   * meta/__tests__/concept-links.test.ts 会自动覆盖到新概念。
   */
  concepts: {
    contextWindow: context_window_v20260515_1,
    windowRegistry: window_registry_v20260515_1,
    windowManager: window_manager_v20260515_1,
    progressiveDisclosure: progressive_disclosure_v20260515_1,
    creatorWindow: creator_window_v20260515_1,
    commandExecLifecycle: command_exec_lifecycle_v20260515_1,
    knowledgeActivation: knowledge_activation_v20260515_1,
    /**
     * 按 window type 拆出的概念组：每个 window type 一个独立概念，
     * sources 指向 src/executable/windows/<type>.ts 等。
     */
    windows: {
      talkWindow: talk_window_v20260515_1,
      doWindow: do_window_v20260515_1,
      todoWindow: todo_window_v20260515_1,
      programWindow: program_window_v20260515_1,
      fileWindow: file_window_v20260515_1,
      knowledgeWindow: knowledge_window_v20260515_1,
    },
  },
  /**
   * legacyIndex —— 旧的 .index 大块 markdown 在 2026-05-15 重构里被拆到 .concepts 各条。
   * 字段保留只为不破坏下游 import；下个 plan 删除。
   * 同时保留 .index 字段名以做 alias，防止外部代码访问 .index 直接报 undefined。
   */
  legacyIndex: `（已被拆到 .concepts，本字段仅为兼容下游 import；新代码请走 .concepts.*）`,
  index: `（已被拆到 .concepts，本字段仅为兼容下游 import；新代码请走 .concepts.*）`,
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

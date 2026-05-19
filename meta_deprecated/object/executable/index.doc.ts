import type { Concept } from "@meta/doc-types";
import { object_v20260504_1 } from "@meta/object/index.doc";
import { reflectable_v20260504_1 } from "@meta/object/reflectable/index.doc";
import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import { server_v20260506_1 } from "@meta/object/executable/server/index.doc";
import { client_v20260506_1 } from "@meta/object/executable/client/index.doc";

// 顶层概念：每个文件 = 一个具名概念对象 + sources 锁定 src module
import { context_window_v20260515_1 } from "@meta/object/executable/concepts/context-window.doc";
import { window_registry_v20260515_1 } from "@meta/object/executable/concepts/window-registry.doc";
import { window_manager_v20260515_1 } from "@meta/object/executable/concepts/window-manager.doc";
import { progressive_disclosure_v20260515_1 } from "@meta/object/executable/concepts/progressive-disclosure.doc";
import { creator_window_v20260515_1 } from "@meta/object/executable/concepts/creator-window.doc";
import { command_exec_lifecycle_v20260515_1 } from "@meta/object/executable/concepts/command-exec-lifecycle.doc";
import { knowledge_activation_v20260515_1 } from "@meta/object/executable/concepts/knowledge-activation.doc";

// 按 window type 拆出的概念
import { talk_window_v20260515_1 } from "@meta/object/executable/windows/talk-window.doc";
import { do_window_v20260515_1 } from "@meta/object/executable/windows/do-window.doc";
import { todo_window_v20260515_1 } from "@meta/object/executable/windows/todo-window.doc";
import { program_window_v20260515_1 } from "@meta/object/executable/windows/program-window.doc";
import { file_window_v20260515_1 } from "@meta/object/executable/windows/file-window.doc";
import { knowledge_window_v20260515_1 } from "@meta/object/executable/windows/knowledge-window.doc";
import { search_window_v20260516_1 } from "@meta/object/executable/windows/search-window.doc";

import * as executable_tools from "@src/executable/tools/index";
import * as executable_commands from "@src/executable/windows/root/index";
import * as executable_windows from "@src/executable/windows/index";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Executable 概念聚合骨架
 *  这是 aggregator——不是合规 Concept；不持有 name，但持有 sources/children
 *  让 walker 能识别 7 个 concepts.* 与 7 个 concepts.windows.* 子概念。
 * ──────────────────────────────────────────────────────────────── */

export type ExecutableConcepts = {
  /** 跨切面概念（7 个） */
  contextWindow: typeof context_window_v20260515_1;
  windowRegistry: typeof window_registry_v20260515_1;
  windowManager: typeof window_manager_v20260515_1;
  progressiveDisclosure: typeof progressive_disclosure_v20260515_1;
  creatorWindow: typeof creator_window_v20260515_1;
  commandExecLifecycle: typeof command_exec_lifecycle_v20260515_1;
  knowledgeActivation: typeof knowledge_activation_v20260515_1;
  /** 按 window type 拆出的 7 个概念 */
  windows: {
    talkWindow: typeof talk_window_v20260515_1;
    doWindow: typeof do_window_v20260515_1;
    todoWindow: typeof todo_window_v20260515_1;
    programWindow: typeof program_window_v20260515_1;
    fileWindow: typeof file_window_v20260515_1;
    knowledgeWindow: typeof knowledge_window_v20260515_1;
    searchWindow: typeof search_window_v20260516_1;
  };
};

export type ExecutableAggregator = {
  readonly parent: unknown;
  description: string;
  sources: {
    tools: typeof executable_tools;
    commands: typeof executable_commands;
    windows: typeof executable_windows;
  };
  concepts: ExecutableConcepts;
  tools: typeof tools_v20260506_1;
  commands: typeof commands_v20260506_1;
  server: typeof server_v20260506_1;
  client: typeof client_v20260506_1;
  reflectable: Concept;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const executable_v20260504_1: ExecutableAggregator = {
  get parent() {
    return object_v20260504_1;
  },
  description: `
Executable 描述 Object 的行动 / 编程能力。

- root window 注册顶层 command（do / talk / program / plan / end / todo /
  open_file / open_knowledge）
- LLM 通过 5 原语 \`open / refine / submit / close / wait\` 与 contextWindows 交互
- 知识协议（KNOWLEDGE / ROOT_KNOWLEDGE / 各 command knowledge / 各 window
  basicKnowledge）每轮自动合成进 context，由 \`collectExecutableKnowledgeEntries\` 派生
`.trim(),
  sources: {
    tools: executable_tools,
    commands: executable_commands,
    windows: executable_windows,
  },
  concepts: {
    contextWindow: context_window_v20260515_1,
    windowRegistry: window_registry_v20260515_1,
    windowManager: window_manager_v20260515_1,
    progressiveDisclosure: progressive_disclosure_v20260515_1,
    creatorWindow: creator_window_v20260515_1,
    commandExecLifecycle: command_exec_lifecycle_v20260515_1,
    knowledgeActivation: knowledge_activation_v20260515_1,
    windows: {
      talkWindow: talk_window_v20260515_1,
      doWindow: do_window_v20260515_1,
      todoWindow: todo_window_v20260515_1,
      programWindow: program_window_v20260515_1,
      fileWindow: file_window_v20260515_1,
      knowledgeWindow: knowledge_window_v20260515_1,
      searchWindow: search_window_v20260516_1,
    },
  },
  tools: tools_v20260506_1,
  commands: commands_v20260506_1,
  server: server_v20260506_1,
  client: client_v20260506_1,
  reflectable: reflectable_v20260504_1,
};

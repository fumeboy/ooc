import type { Concept, DocNode } from "@meta/doc-types";
import * as registry from "@src/executable/windows/registry";

/* ────────────────────────────────────────────────────────────────
 *  目录页：每种 window type 的"行为契约"集中注册点
 * ──────────────────────────────────────────────────────────────── */

/**
 * WindowRegistry 概念：每种 ContextWindow 类型的"行为契约"集中注册点。
 *
 * sources:
 *  - registry — registerWindowType / getWindowTypeDefinition + type-level basicKnowledge
 */
export type WindowRegistryConcept = Concept & {
  sources: { registry: typeof registry };

  /** WindowTypeDefinition 的 4 个字段 */
  definitionFields: DocNode & {
    commands: DocNode;
    onClose: DocNode;
    renderXml: DocNode;
    basicKnowledge: DocNode;
  };

  /** 注册流程 */
  registrationMechanics: DocNode & {
    initialRegistry: DocNode;
    registerWindowType: DocNode & {
      commandsShallowMerge: DocNode;
      otherFieldsOverwrite: DocNode;
      unknownTypeThrows: DocNode;
    };
    queryHelpers: DocNode;
  };

  /** registerWindowType 的调用方分布 */
  registrationCallers: DocNode & {
    rootCommands: DocNode;
    typeImpls: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const window_registry_v20260515_1: WindowRegistryConcept = {
  name: "WindowRegistry",
  sources: { registry },
  description: `
每种 ContextWindow type 的契约集中在 WindowRegistry：commands 表、onClose hook、
renderXml、basicKnowledge。
`.trim(),

  definitionFields: {
    title: "WindowTypeDefinition 字段",
    summary: "4 个字段：commands / onClose / renderXml / basicKnowledge",

    commands: {
      title: "commands",
      summary: "Record<string, CommandTableEntry>——该 window 的 command 集合",
      content: `
Record<string, CommandTableEntry>：该 window 注册的、LLM 可通过
open(parent_window_id, command, ...) 调用的 command 集合。

- root：等于 src/executable/windows/root 目录全集（do/talk/program/plan/end/todo/...）
- command_exec：空（form 上不能再嵌套 open command）
- do：{ continue, wait, close }
- talk：{ say, wait, close }
- file：{ set_range, reload, edit, close }
- knowledge：{ reload, close }
- program：{ exec, close }
- search：{ open_match, close }
- todo：空（todo 没有可继续的 command；只能 close）
      `.trim(),
    },

    onClose: {
      title: "onClose",
      summary: "(ctx) => boolean | void，close 触发时的副作用",
      content: `
(ctx: OnCloseContext) => boolean | void，close 触发时的副作用：

- thread 可被直接 mutate（contextWindows 的删除由 WindowManager 统一负责）
- 返回 false 表示拒绝关闭（如 creator do_window / creator talk_window / 合成 knowledge_window）
- 返回 true 或 void 表示允许
      `.trim(),
    },

    renderXml: {
      title: "renderXml",
      summary: "(ctx) => unknown，投影为 system context XML 节点",
      content: `
(ctx: RenderContext) => unknown，把该 window 投影成 system context 的 XML 节点。

- 具体 XmlNode 类型由渲染层定义；此处 unknown 避免 windows 模块反向依赖渲染层
- 渲染层在调用前装配 helpers，并消费返回值
- 缺省时渲染层用通用 fallback
      `.trim(),
    },

    basicKnowledge: {
      title: "basicKnowledge",
      summary: "可选 string；type 至少一个实例在场时合成为 protocol KnowledgeWindow",
      content: `
可选 string；当 thread.contextWindows 中出现该 type 的至少一个实例时，
collectExecutableKnowledgeEntries 自动把这段文本合成为一个 protocol KnowledgeWindow。

- 让 LLM 在没有 open 任何 command_exec 的情况下也知道该类型有哪些 command 可调
- 缺省（undefined）= 不合成；root / command_exec 通常不需要
- 典型用法：talk_window / search_window 都有 basicKnowledge
      `.trim(),
    },
  },

  registrationMechanics: {
    title: "注册流程",
    summary: "initialRegistry 占位 / registerWindowType 合并 / queryHelpers 查询",

    initialRegistry: {
      title: "initialRegistry",
      summary: "模块加载时预先 set 每个 type 空契约占位",
      content: `
模块加载时 REGISTRY 预先 set 每个已知 type 一个空契约占位（root / command_exec /
do / todo / talk / program / file / knowledge / search）。

避免 windows/registry.ts 直接 import 各 type 实现，否则会产生
windows ↔ commands ↔ windows 的循环依赖。
      `.trim(),
    },

    registerWindowType: {
      title: "registerWindowType(type, partial)",
      summary: "合并策略：commands 浅合并 / 其它字段整体覆盖 / unknown type 抛错",

      commandsShallowMerge: {
        title: "commandsShallowMerge",
        summary: "commands 浅合并；key 冲突时新值覆盖",
        content:
          "commands 字段浅合并；key 冲突时新值覆盖。允许 root 在多次注册中累积命令表。",
      },

      otherFieldsOverwrite: {
        title: "otherFieldsOverwrite",
        summary: "onClose / renderXml / basicKnowledge 整体覆盖",
        content:
          "onClose / renderXml / basicKnowledge 直接整体覆盖（缺省时保留原值）。这些是单一契约函数，没有合并语义。",
      },

      unknownTypeThrows: {
        title: "unknownTypeThrows",
        summary: "未知 type 抛错避免 typo 静默失败",
        content: "未知 type 抛错（避免 typo 静默失败导致 hook 永不生效）。",
      },
    },

    queryHelpers: {
      title: "queryHelpers",
      summary: "getWindowTypeDefinition / listRegisteredWindowTypes",
      content: `
- getWindowTypeDefinition(type) — 取契约；未注册抛错
- listRegisteredWindowTypes() — 列出所有已注册 type（按字母序）
      `.trim(),
    },
  },

  registrationCallers: {
    title: "registerWindowType 调用方",
    summary: "每个 type 实现侧在模块加载时注入",

    rootCommands: {
      title: "rootCommands",
      summary: "windows/root/index.ts 注入 root 的 commands 表",
      content:
        "windows/root/index.ts 在初始化时注入 root 的 commands 表（do/talk/program/...）。",
    },

    typeImpls: {
      title: "typeImpls",
      summary: "各 windows/<type>.ts 注入自己的 commands + onClose + basicKnowledge",
      content:
        "windows/do.ts / windows/talk.ts / windows/file.ts / windows/program.ts / windows/knowledge.ts / windows/search.ts / windows/todo.ts 各自在模块加载时注入自己的 commands + onClose + basicKnowledge。",
    },
  },
};

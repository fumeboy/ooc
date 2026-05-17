import * as registry from "@src/executable/windows/registry";

/**
 * WindowRegistry 概念：每种 ContextWindow 类型的"行为契约"集中注册点。
 *
 * sources:
 *  - registry — registerWindowType / getWindowTypeDefinition + type-level basicKnowledge
 */
export const window_registry_v20260515_1 = {
  name: "WindowRegistry",
  description: `每种 ContextWindow type 的契约集中在 WindowRegistry：commands 表、onClose hook、renderXml、basicKnowledge。`,
  sources: { registry },

  definitionFields_v20260517_1: {
    index: `WindowTypeDefinition 4 个字段；详见各子节点。`,

    commands_v20260517_1: {
      index: `
##### commands

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
`,
    },

    onClose_v20260517_1: {
      index: `
##### onClose

(ctx: OnCloseContext) => boolean | void，close 触发时的副作用：

- thread 可被直接 mutate（contextWindows 的删除由 WindowManager 统一负责）
- 返回 false 表示拒绝关闭（如 creator do_window / creator talk_window / 合成 knowledge_window）
- 返回 true 或 void 表示允许
`,
    },

    renderXml_v20260517_1: {
      index: `
##### renderXml

(ctx: RenderContext) => unknown，把该 window 投影成 system context 的 XML 节点。

- 具体 XmlNode 类型由渲染层定义；此处 unknown 避免 windows 模块反向依赖渲染层
- 渲染层在调用前装配 helpers，并消费返回值
- 缺省时渲染层用通用 fallback
`,
    },

    basicKnowledge_v20260517_1: {
      index: `
##### basicKnowledge

可选 string；当 thread.contextWindows 中出现该 type 的至少一个实例时，
collectExecutableKnowledgeEntries 自动把这段文本合成为一个 protocol KnowledgeWindow。

- 让 LLM 在没有 open 任何 command_exec 的情况下也知道该类型有哪些 command 可调
- 缺省（undefined）= 不合成；root / command_exec 通常不需要
- 典型用法：talk_window / search_window 都有 basicKnowledge
`,
    },
  },

  registrationMechanics_v20260517_1: {
    index: `注册流程；3 个子节点描述初始 REGISTRY、registerWindowType 与查询。`,

    initialRegistry_v20260517_1: {
      index: `
##### initialRegistry

模块加载时 REGISTRY 预先 set 每个已知 type 一个空契约占位（root / command_exec /
do / todo / talk / program / file / knowledge / search）。

避免 windows/registry.ts 直接 import 各 type 实现，否则会产生
windows ↔ commands ↔ windows 的循环依赖。
`,
    },

    registerWindowType_v20260517_1: {
      index: `##### registerWindowType(type, partial) — 合并策略详见各子节点。`,

      commandsShallowMerge_v20260517_1: {
        index: `###### commandsShallowMerge — commands 字段浅合并；key 冲突时新值覆盖。允许 root 在多次注册中累积命令表。`,
      },

      otherFieldsOverwrite_v20260517_1: {
        index: `###### otherFieldsOverwrite — onClose / renderXml / basicKnowledge 直接整体覆盖（缺省时保留原值）。这些是单一契约函数，没有合并语义。`,
      },

      unknownTypeThrows_v20260517_1: {
        index: `###### unknownTypeThrows — 未知 type 抛错（避免 typo 静默失败导致 hook 永不生效）。`,
      },
    },

    queryHelpers_v20260517_1: {
      index: `
##### queryHelpers

- getWindowTypeDefinition(type) — 取契约；未注册抛错
- listRegisteredWindowTypes() — 列出所有已注册 type（按字母序）
`,
    },
  },

  registrationCallers_v20260517_1: {
    index: `registerWindowType 的调用方分布——每个 type 实现侧在模块加载时注入。`,

    rootCommands_v20260517_1: {
      index: `##### rootCommands — windows/root/index.ts 在初始化时注入 root 的 commands 表（do/talk/program/...）。`,
    },

    typeImpls_v20260517_1: {
      index: `##### typeImpls — windows/do.ts / windows/talk.ts / windows/file.ts / windows/program.ts / windows/knowledge.ts / windows/search.ts / windows/todo.ts 各自在模块加载时注入自己的 commands + onClose + basicKnowledge。`,
    },
  },
};

import * as manager from "@src/executable/windows/manager";

/**
 * WindowManager 概念：统一 ContextWindow 操作入口。
 *
 * sources:
 *  - manager — WindowManager 类、openCommandExec、refine、submit、close、knowledgeRefs
 */
export const window_manager_v20260515_1 = {
  name: "WindowManager",
  description: `WindowManager 持有 thread.contextWindows，封装所有 window 的增删改查；对外暴露与 LLM 5 原语对齐的方法。`,
  sources: { manager },

  lifecycleMethods: {
    title: "lifecycle Methods",
    content: `与 5 原语一一对应的核心方法；详见各子节点。`,

    openCommandExec: {
      title: "openCommandExec",
      content: `
在 parent window 下创建 command_exec sub-window；4 条子规则详见各子节点。
      `,

      parentDefaultsToRoot: {
        title: "parentDefaultsToRoot",
        content: `
        parent_window_id 缺省时挂到 ROOT_WINDOW_ID（root window 是隐含 virtual view，不需要显式创建）。
        `,
      },

      argsApplyOnCreate: {
        title: "argsApplyOnCreate",
        content: `
        opts.args 非空时立刻 apply 一次累积：accumulatedArgs = { ...args }，commandPaths = entry.match(args)；等价于 open 后立即 refine。
        `,
      },

      autoSubmitShortCircuit: {
        title: "autoSubmitShortCircuit",
        content: `
        满足 commandExecLifecycle.autoSubmitRule 的 3 条件时直接 submit，跳过 LLM 第二轮显式 submit。
        `,
      },

      returnShape: {
        title: "returnShape",
        content: `
        返回 { formId, autoSubmitted: boolean, submitResult? }；autoSubmitted=true 时附带 submitResult，否则只有 formId。
        `,
      },
    },

    insertTypedWindow: {
      title: "insertTypedWindow",
      content: `
创建非 form 的 typed window（do_window / todo_window / file_window / ...）。

- 由各 command.exec 副作用调用：root.do submit → insertTypedWindow("do", ...) 产出 do_window；
  root.todo / root.open_file / root.open_knowledge / root.glob / root.grep 同理
- 也用于 thread init 注入 creator do_window / talk_window
- id 已存在抛错（避免静默覆盖）
- 调用方按需在 init 里追加 type 特有字段
      `,
    },

    refine: {
      title: "refine",
      content: `
累积 command_exec form 的 args 并重算 commandPaths。

- 仅 status==="open" 的 command_exec 可被 refine；其它情况返回 false
- 合并语义：nextArgs = { ...form.accumulatedArgs, ...args }
- 重新调 entry.match(nextArgs) 计算 commandPaths
      `,
    },

    submit: {
      title: "submit",
      content: `
提交 form：跑 entry.exec(ctx) → 写 result。状态过渡 open → executing → executed。

- 成功：自动从 contextWindows 移除
- 失败：保留 executed + result（详见 commandExecLifecycle.transitions.submitFailurePersist）
- ctx 字段：{ thread, form, parentWindow, manager, args }
- 返回 result 字符串（可能 undefined，如 plan/end 等无 result 的 command）
      `,
    },

    close: {
      title: "close",
      content: `
      关闭任意 window；按顺序执行 4 步详见各子节点。
      `,

      lookupStep: {
        title: "Step 1",
        content: `
        lookup window；不存在则直接返回 false（兼容 LLM 复述旧 id 的情况）。
        `,
      },

      onCloseRejectGuard: {
        title: "Step 2",
        content: `
        调用 type.onClose({ thread, window })；返回 false 表示拒绝（如 creator window / 合成 knowledge_window）→ 不删，立即返回。
        `,
      },

      cascadeChildren: {
        title: "Step 3",
        content: `
        递归关闭所有 parentWindowId === window.id 的子 window；先 snapshot 子列表再迭代，避免迭代过程中 mutate 导致漏关。
        `,
      },

      removeAndReleaseRefs: {
        title: "Step 4",
        content: `
        从 windows Map 移除该 window 并调 releaseKnowledgeRefs 释放它持有的 knowledge 引用。
        `,
      },
    },

    markExecuted: {
      title: "markExecuted",
      content: `
仅供 command 实现使用：把 form 的 result 写入并保留 executed 状态。
成功时不调用（submit 会自动移除）；用于 command 内部需要标错时手工触发失败路径。
      `,
    },
  },

  stateLoaders: {
    title: "state Loaders",
    content: `状态装载与导出 helper。`,

    fromThread: {
      title: "fromThread",
      content: `
WindowManager.fromThread(thread) 静态方法：从 thread.contextWindows 装载到内部 Map，
同时为每个 window 调 recordKnowledgeRefs 建引用计数。
      `,
    },

    toData: {
      title: "toData",
      content: `
mgr.toData() 导出为 thread.contextWindows 用的 flat 数组。
调用方负责回写 thread.contextWindows = mgr.toData()；WindowManager 本身不 mutate thread。
      `,
    },

    queries: {
      title: "queries",
      content: `
辅助查询：list() / get(id) / childrenOf(parentId)。所有返回浅拷贝/数组，不暴露内部 Map。
      `,
    },
  },

  knowledgeRefCount: {
    title: "knowledge Ref Count",
    content: `
WindowManager 内部维护 knowledgeRefs: Map<string, Set<string>>（path → 持有它的 window id 集合）。

- 装载 / 创建 window 时 recordKnowledgeRefs 把 window 关联的所有 knowledge path 记入 set
- 移除 window 时 releaseKnowledgeRefs 从对应 set 移除该 windowId；set 空则删 path
- 多 window 共享 path 时不会被任一释放提前丢弃；详见 pathCollection 子节点
    `,

    pathCollection: {
      title: "path Collection",
      content: `collectKnowledgePathsOf 按 window type 选择 path 集合；2 个分支详见子节点。`,

      commandExecAllSources: {
        title: "command_exec 分支",
        content: `
合并 3 个字段（去重）：

- commandKnowledgePaths — entry.knowledge(args, status) 派生的协议 path 集合
- loadedKnowledgePaths — refine 增量激活的 stones knowledge path 集合
- windowKnowledgePaths — 显式挂在 form 上的额外 path（少见）
        `,
      },

      otherTypesWindowOnly: {
        title: "其它 type 分支",
        content: `
非 command_exec window 仅取 windowKnowledgePaths ?? []。
do_window / talk_window / file_window 等通常不持有 knowledge ref，set 为空。
        `,
      },
    },
  },

  notResponsibleFor: {
    title: "not Responsible For",
    content: `WindowManager **不**负责的 3 件事；详见各子节点。`,

    commandExecImpl: {
      title: "commandExecImpl",
      content: `
      各 command 自身的 entry.exec 实现（由各 root/X.ts 与 windows/X.ts 提供）。
      `,
    },

    knowledgeEntries: {
      title: "knowledgeEntries",
      content: `
      knowledge entries 的具体内容（由 collectExecutableKnowledgeEntries 派生）。
      `,
    },

    persistence: {
      title: "persistence",
      content: `
      持久化（由 src/persistable/thread-json.ts 处理）。
      `,
    },
  },

  usagePattern: {
    title: "usage Pattern",
    content: `
ts
const mgr = WindowManager.fromThread(thread);
const { formId } = await mgr.openCommandExec({ ... });
thread.contextWindows = mgr.toData();

    `,
  },
};

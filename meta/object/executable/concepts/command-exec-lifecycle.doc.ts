import type { Concept, DocNode } from "@meta/doc-types";
import * as manager from "@src/executable/windows/manager";

/* ────────────────────────────────────────────────────────────────
 *  目录页：command_exec form 生命周期状态机
 * ──────────────────────────────────────────────────────────────── */

/**
 * CommandExecLifecycle 概念：open → executing → executed → 自动移除 / 保留待 close。
 *
 * sources:
 *  - manager — openCommandExec / refine / submit 实现 form 状态机
 */
export type CommandExecLifecycleConcept = Concept & {
  sources: { manager: typeof manager };

  /** 3 个状态枚举值 */
  states: DocNode & {
    open: DocNode;
    executing: DocNode;
    executed: DocNode;
  };

  /** 4 个关键状态过渡边 */
  transitions: DocNode & {
    openToOpenAutoRefine: DocNode;
    openToExecutedAutoSubmit: DocNode;
    submitSuccessRemoval: DocNode;
    submitFailurePersist: DocNode;
  };

  /** open 时 auto-submit 的 3 条同时满足条件 */
  autoSubmitRule: DocNode & {
    baseline: DocNode;
    nextSet: DocNode;
  };

  /** submit 失败的 3 种判定路径 */
  failureDetection: DocNode & {
    explicitOutcome: DocNode;
    legacyErrorPrefix: DocNode & {
      regexShape: DocNode;
      commandErrorPrefix: DocNode;
      legacyErrorWord: DocNode;
      perCommandPrefix: DocNode;
    };
    thrownException: DocNode;
  };

  /** 多 window 共享 knowledge path 的引用计数规则 */
  knowledgeRefCount: DocNode & {
    multiWindowSharing: DocNode;
    autoRemoveReleasesRefs: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const command_exec_lifecycle_v20260515_1: CommandExecLifecycleConcept = {
  name: "CommandExecLifecycle",
  sources: { manager },
  description: `
command_exec 是 LLM 调用某个 command 时产生的临时 sub-window；其状态机由 WindowManager
在 openCommandExec / refine / submit 三个入口推进。
`.trim(),

  states: {
    title: "状态枚举",
    summary: "3 个状态：open / executing / executed",

    open: {
      title: "open",
      summary: "刚创建的 form，可继续 refine 或 submit",
      content: `
刚创建的 form。可继续 refine 累积 args、或 submit 执行。
refine 仅在此状态下接受；其他状态返回 false。
      `.trim(),
    },

    executing: {
      title: "executing",
      summary: "submit 已切到该状态、正在跑 entry.exec(ctx)",
      content: `
submit 已切到该状态、正在跑 entry.exec(ctx)。
该状态对外是瞬态，调用 try/catch 后立刻进入 executed 或被移除。
      `.trim(),
    },

    executed: {
      title: "executed",
      summary: "exec 已完成；成功→自动移除，失败→保留待 close",
      content: `
exec 已完成。
- 成功 → 自动从 contextWindows 移除（不写回此状态；form 直接消失）
- 失败 → 保留 form + result 字段，等 LLM 显式 close
      `.trim(),
    },
  },

  transitions: {
    title: "状态过渡",
    summary: "4 条关键过渡边",

    openToOpenAutoRefine: {
      title: "open → open（创建时 auto-refine）",
      summary: "openCommandExec 携 args 时立即应用一次累积",
      content: `
openCommandExec(opts) 时若 opts.args 非空，立即应用一次累积：
accumulatedArgs = { ...args } 与 commandPaths = entry.match(args)。
不算独立 refine，但已生效。
      `.trim(),
    },

    openToExecutedAutoSubmit: {
      title: "open → executed（创建时 auto-submit）",
      summary: "满足 autoSubmitRule 时跳过显式 submit",
      content: `
openCommandExec 内部判定（详见 autoSubmitRule）满足时直接调 submit，跳过显式 submit 步骤。
返回 { formId, autoSubmitted: true, submitResult }。
      `.trim(),
    },

    submitSuccessRemoval: {
      title: "submit 成功 → 自动移除",
      summary: "成功时 form 直接消失，不留 executed 痕迹",
      content: `
entry.exec 返回 {ok:true,...} / undefined / 不带错误前缀的 string 时视为成功；
直接 removeWindow(formId)，form 从 contextWindows 消失，不留 executed 痕迹。
      `.trim(),
    },

    submitFailurePersist: {
      title: "submit 失败 → executed + result 保留",
      summary: "保留 form 等 LLM 显式 close",
      content: `
失败判定见 failureDetection。保留为 {...form, status:"executed", result}，
等 LLM 通过 close(formId) 释放。
      `.trim(),
    },
  },

  autoSubmitRule: {
    title: "auto-submit 判定",
    summary: "args 给齐 + 不引入新协议知识 ⇒ 一步执行",
    content: `
openCommandExec 的 auto-submit 判定 3 条同时满足才触发：

- Object.keys(args).length > 0 —— 空 args 等价于 LLM 想观察 form 状态再决定
- setSubset(baselinePaths, nextCommandPaths) —— 新 path 由 LLM 显式给出，不算 surprise
- setSubset(nextKnowledgeKeys, baselineKnowledgeKeys) —— command 自身不引入新 knowledge key

具体 command 通过自身的 match() 与 knowledge() 实现来控制是否走 auto-submit；
如 root.do / root.todo / open_file 通常一步直建。
    `.trim(),

    baseline: {
      title: "baseline 取自空 args",
      summary: "未填任何参数时的 path / knowledge 集合",
      content: `
baselinePaths = entry.match({})；
baselineKnowledgeKeys = Object.keys(entry.knowledge({}, "open"))。
两者代表"未填任何参数时的 path / knowledge 集合"。
      `.trim(),
    },

    nextSet: {
      title: "next set 取自实际 args",
      summary: "仅当 next 是 baseline 的扩展时才安全 auto-submit",
      content: `
nextCommandPaths = entry.match(args)；
nextKnowledgeKeys = Object.keys(entry.knowledge(args, "open"))。
仅当 next 是 baseline 的扩展（不引入新 protocol knowledge）时才安全 auto-submit。
      `.trim(),
    },
  },

  failureDetection: {
    title: "失败判定",
    summary: "submit 内部的 3 种失败判定路径",

    explicitOutcome: {
      title: "explicitOutcome",
      summary: "exec 返回带 ok:boolean 的 CommandExecOutcome",
      content: `
exec 返回对象带 ok: boolean 字段（CommandExecOutcome）时，最权威：
- ok:true → 成功；result = raw.result
- ok:false → 失败；result = raw.error
      `.trim(),
    },

    legacyErrorPrefix: {
      title: "legacyErrorPrefix（isLegacyErrorResult）",
      summary: "返回 string 且匹配 ^\\[[\\w_.-]+\\] 视为失败",
      content: `
返回 string 且 trimStart() 后匹配正则 ^\\[[\\w_.-]+\\] 视为失败。
prefixPatterns 列出当前常见前缀；新代码应改用 CommandExecOutcome，避免依赖此启发式。
      `.trim(),

      regexShape: {
        title: "regexShape",
        summary: "匹配 ^\\[[\\w_.-]+\\]——避免误判 markdown 链接",
        content: `
匹配规则：trimStart() 后必须匹配 ^\\[[\\w_.-]+\\]。
方括号内仅允许字母数字 / 下划线 / 点 / 中划线，避免误判普通 markdown 链接 [text](url) 为错误。
        `.trim(),
      },

      commandErrorPrefix: {
        title: "[command-error]",
        summary: "manager 在 catch 块包装异常时的固定前缀",
        content: "manager 在 catch 块包装异常时的固定前缀。",
      },

      legacyErrorWord: {
        title: "[error]",
        summary: "早期手写前缀；新 command 不应再写",
        content: "早期实现手写前缀；遗留代码使用，新 command 不应再写。",
      },

      perCommandPrefix: {
        title: "[<command>] / [<window>.<command>]",
        summary: "各 command 自定义错误前缀，便于识别来源",
        content:
          "各 command 自定义错误前缀（如 [file_window.edit] / [talk_window.say]），便于 LLM 识别错误来源。",
      },
    },

    thrownException: {
      title: "thrownException",
      summary: "exec 抛异常 → [command-error] <err.message>",
      content: `
exec 直接抛异常时 catch，result 拼为 [command-error] <err.message>，isError=true。
      `.trim(),
    },
  },

  knowledgeRefCount: {
    title: "knowledge 引用计数",
    summary: "多 window 共享同一 path 时的引用计数规则",
    content: `
WindowManager 维护 knowledgeRefs: Map<path, Set<windowId>> 引用计数。
form 创建时通过 recordKnowledgeRefs 把它持有的所有 knowledge path 记 +1；
form 移除时 releaseKnowledgeRefs -1。多 window 共享同一 path 时不会被任一 form 提前释放。
    `.trim(),

    multiWindowSharing: {
      title: "multiWindowSharing",
      summary: "Set<windowId> 确保任一 form 移除时只释放自己一份",
      content: `
同一 knowledge path 可被多个 window 同时持有；引用集合 Set<windowId> 用来确保
任一 form 移除时只释放自己一份，path 自身仅在 set 空时才真正从 knowledgeRefs 删除。
这避免 LLM 关一个 form 把另一个还在用的 knowledge 提前撤出 context。
      `.trim(),
    },

    autoRemoveReleasesRefs: {
      title: "autoRemoveReleasesRefs",
      summary: "submit 成功时自动释放引用，无需显式 close",
      content: `
submit 成功时 form 自动从 contextWindows 移除会同时调 releaseKnowledgeRefs；
LLM 不需要显式 close 也不会泄露引用计数。
      `.trim(),
    },
  },
};

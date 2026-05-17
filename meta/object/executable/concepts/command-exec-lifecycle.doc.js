import * as manager from "@src/executable/windows/manager";

/**
 * command_exec form 生命周期概念：open → executing → executed → 自动移除 / 保留待 close。
 *
 * sources:
 *  - manager — openCommandExec / refine / submit 实现 form 状态机
 */
export const command_exec_lifecycle_v20260515_1 = {
  name: "CommandExecLifecycle",
  description: `command_exec 是 LLM 调用某个 command 时产生的临时 sub-window；其状态机由 WindowManager 在 openCommandExec / refine / submit 三个入口推进。`,
  sources: { manager },

  states: {
    title: "states",
    content: `3 个状态枚举值；过渡规则见各子节点。`,

    open: {
      title: "open",
      content: `
刚创建的 form。可继续 refine 累积 args、或 submit 执行。
refine 仅在此状态下接受；其他状态返回 false。
      `,
    },

    executing: {
      title: "executing",
      content: `
submit 已切到该状态、正在跑 entry.exec(ctx)。
该状态对外是瞬态，调用 try/catch 后立刻进入 executed 或被移除。
      `,
    },

    executed: {
      title: "executed",
      content: `
exec 已完成。
- 成功 → 自动从 contextWindows 移除（不写回此状态；form 直接消失）
- 失败 → 保留 form + result 字段，等 LLM 显式 close
      `,
    },
  },

  transitions: {
    title: "transitions",
    content: `4 个关键过渡边。`,

    openToOpenAutoRefine: {
      title: "open → open (auto-refine on creation)",
      content: `
openCommandExec(opts) 时若 opts.args 非空，立即应用一次累积：
accumulatedArgs = { ...args } 与 commandPaths = entry.match(args)。
不算独立 refine，但已生效。
      `,
    },

    openToExecutedAutoSubmit: {
      title: "open → executed (auto-submit at open)",
      content: `
openCommandExec 内部判定（详见 autoSubmitRule）满足时直接调 submit，跳过显式 submit 步骤。
返回 { formId, autoSubmitted: true, submitResult }。
      `,
    },

    submitSuccessRemoval: {
      title: "submit success → 自动移除",
      content: `
entry.exec 返回 {ok:true,...} / undefined / 不带错误前缀的 string 时视为成功；
直接 removeWindow(formId)，form 从 contextWindows 消失，不留 executed 痕迹。
      `,
    },

    submitFailurePersist: {
      title: "submit failure → executed + result 保留",
      content: `
失败判定见 failureDetection。保留为 {...form, status:"executed", result}，
等 LLM 通过 close(formId) 释放。
      `,
    },
  },

  autoSubmitRule: {
    title: "auto Submit Rule",
    content: `
openCommandExec 的 auto-submit 判定（"args 给齐 + 不引入新协议知识"⇒一步执行）：

3 条同时满足才触发：

- Object.keys(args).length > 0 —— 空 args 等价于 LLM 想观察 form 状态再决定
- setSubset(baselinePaths, nextCommandPaths) —— 新 path 由 LLM 显式给出，不算 surprise
- setSubset(nextKnowledgeKeys, baselineKnowledgeKeys) —— command 自身不引入新 knowledge key

具体 command 通过自身的 match() 与 knowledge() 实现来控制是否走 auto-submit；
如 root.do / root.todo / open_file 通常一步直建。
    `,

    baseline: {
      title: "baseline 取自空 args",
      content: `
baselinePaths = entry.match({})；
baselineKnowledgeKeys = Object.keys(entry.knowledge({}, "open"))。
两者代表"未填任何参数时的 path / knowledge 集合"。
      `,
    },

    nextSet: {
      title: "next set 取自实际 args",
      content: `
nextCommandPaths = entry.match(args)；
nextKnowledgeKeys = Object.keys(entry.knowledge(args, "open"))。
仅当 next 是 baseline 的扩展（不引入新 protocol knowledge）时才安全 auto-submit。
      `,
    },
  },

  failureDetection: {
    title: "failure Detection",
    content: `submit 内部的 3 种失败判定路径。`,

    explicitOutcome: {
      title: "explicitOutcome",
      content: `
exec 返回对象带 ok: boolean 字段（CommandExecOutcome）时，最权威：
- ok:true → 成功；result = raw.result
- ok:false → 失败；result = raw.error
      `,
    },

    legacyErrorPrefix: {
      title: "legacyErrorPrefix（isLegacyErrorResult）",
      content: `
返回 string 且 trimStart() 后匹配正则 ^\\[[\\w_.-]+\\] 视为失败。
prefixPatterns 列出当前常见前缀；新代码应改用 CommandExecOutcome，避免依赖此启发式。
      `,

      regexShape: {
        title: "regexShape",
        content: `
匹配规则：trimStart() 后必须匹配 ^\\[[\\w_.-]+\\]。
方括号内仅允许字母数字 / 下划线 / 点 / 中划线，避免误判普通 markdown 链接 [text](url) 为错误。
        `,
      },

      commandErrorPrefix: {
        title: "[command-error]",
        content: `
        manager 在 catch 块包装异常时的固定前缀。
        `,
      },

      legacyErrorWord: {
        title: "[error]",
        content: `
        早期实现手写前缀；遗留代码使用，新 command 不应再写。
        `,
      },

      perCommandPrefix: {
        title: "[<command>] / [<window>.<command>]",
        content: `
        各 command 自定义错误前缀（如 [file_window.edit] / [talk_window.say]），便于 LLM 识别错误来源。
        `,
      },
    },

    thrownException: {
      title: "thrownException",
      content: `
exec 直接抛异常时 catch，result 拼为 [command-error] <err.message>，isError=true。
      `,
    },
  },

  knowledgeRefCount: {
    title: "knowledge Ref Count",
    content: `
WindowManager 维护 knowledgeRefs: Map<path, Set<windowId>> 引用计数。
form 创建时通过 recordKnowledgeRefs 把它持有的所有 knowledge path 记 +1；
form 移除时 releaseKnowledgeRefs -1。多 window 共享同一 path 时不会被任一 form 提前释放。
详细规则见各子节点。
    `,

    multiWindowSharing: {
      title: "multiWindowSharing",
      content: `
同一 knowledge path 可被多个 window 同时持有；引用集合 Set<windowId> 用来确保
任一 form 移除时只释放自己一份，path 自身仅在 set 空时才真正从 knowledgeRefs 删除。
这避免 LLM 关一个 form 把另一个还在用的 knowledge 提前撤出 context。
      `,
    },

    autoRemoveReleasesRefs: {
      title: "autoRemoveReleasesRefs",
      content: `
submit 成功时 form 自动从 contextWindows 移除会同时调 releaseKnowledgeRefs；
LLM 不需要显式 close 也不会泄露引用计数。
      `,
    },
  },
};

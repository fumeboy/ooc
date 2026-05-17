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

  states_v20260517_1: {
    index: `3 个状态枚举值；过渡规则见各子节点。`,

    open_v20260517_1: {
      index: `
#### open

刚创建的 form。可继续 \`refine\` 累积 args、或 \`submit\` 执行。
\`refine\` 仅在此状态下接受；其他状态返回 false。
`.trim(),
    },

    executing_v20260517_1: {
      index: `
#### executing

\`submit\` 已切到该状态、正在跑 \`entry.exec(ctx)\`。
该状态对外是瞬态，调用 try/catch 后立刻进入 executed 或被移除。
`.trim(),
    },

    executed_v20260517_1: {
      index: `
#### executed

exec 已完成。
- 成功 → 自动从 contextWindows 移除（不写回此状态；form 直接消失）
- 失败 → 保留 form + \`result\` 字段，等 LLM 显式 close
`.trim(),
    },
  },

  transitions_v20260517_1: {
    index: `4 个关键过渡边。`,

    openToOpenAutoRefine_v20260517_1: {
      index: `
#### open → open (auto-refine on creation)

\`openCommandExec(opts)\` 时若 \`opts.args\` 非空，立即应用一次累积：
\`accumulatedArgs = { ...args }\` 与 \`commandPaths = entry.match(args)\`。
不算独立 refine，但已生效。
`.trim(),
    },

    openToExecutedAutoSubmit_v20260517_1: {
      index: `
#### open → executed (auto-submit at open)

\`openCommandExec\` 内部判定（详见 \`autoSubmitRule\`）满足时直接调 \`submit\`，跳过显式 submit 步骤。
返回 \`{ formId, autoSubmitted: true, submitResult }\`。
`.trim(),
    },

    submitSuccessRemoval_v20260517_1: {
      index: `
#### submit success → 自动移除

\`entry.exec\` 返回 \`{ok:true,...}\` / undefined / 不带错误前缀的 string 时视为成功；
直接 \`removeWindow(formId)\`，form 从 contextWindows 消失，不留 executed 痕迹。
`.trim(),
    },

    submitFailurePersist_v20260517_1: {
      index: `
#### submit failure → executed + result 保留

失败判定见 \`failureDetection\`。保留为 \`{...form, status:"executed", result}\`，
等 LLM 通过 \`close(formId)\` 释放。
`.trim(),
    },
  },

  autoSubmitRule_v20260517_1: {
    index: `
\`openCommandExec\` 的 auto-submit 判定（"args 给齐 + 不引入新协议知识"⇒一步执行）：

3 条同时满足才触发：

- \`Object.keys(args).length > 0\` —— 空 args 等价于 LLM 想观察 form 状态再决定
- \`setSubset(baselinePaths, nextCommandPaths)\` —— 新 path 由 LLM 显式给出，不算 surprise
- \`setSubset(nextKnowledgeKeys, baselineKnowledgeKeys)\` —— command 自身不引入新 knowledge key

具体 command 通过自身的 \`match()\` 与 \`knowledge()\` 实现来控制是否走 auto-submit；
如 root.do / root.todo / open_file 通常一步直建。
`.trim(),

    baseline_v20260517_1: {
      index: `
#### baseline 取自空 args

baselinePaths = \`entry.match({})\`；
baselineKnowledgeKeys = \`Object.keys(entry.knowledge({}, "open"))\`。
两者代表"未填任何参数时的 path / knowledge 集合"。
`.trim(),
    },

    nextSet_v20260517_1: {
      index: `
#### next set 取自实际 args

nextCommandPaths = \`entry.match(args)\`；
nextKnowledgeKeys = \`Object.keys(entry.knowledge(args, "open"))\`。
仅当 next 是 baseline 的扩展（不引入新 protocol knowledge）时才安全 auto-submit。
`.trim(),
    },
  },

  failureDetection_v20260517_1: {
    index: `\`submit\` 内部的 3 种失败判定路径。`,

    explicitOutcome_v20260517_1: {
      index: `
#### explicitOutcome

\`exec\` 返回对象带 \`ok: boolean\` 字段（CommandExecOutcome）时，最权威：
- \`ok:true\` → 成功；result = raw.result
- \`ok:false\` → 失败；result = raw.error
`.trim(),
    },

    legacyErrorPrefix_v20260517_1: {
      index: `
#### legacyErrorPrefix（isLegacyErrorResult）

返回 string 且 \`trimStart()\` 后匹配正则 \`^\\[[\\w_.-]+\\]\` 视为失败：

- \`[command-error] ...\` — manager 在 catch 块的固定前缀
- \`[error] ...\` — 旧实现手写前缀
- \`[<command>] ...\` / \`[<window>.<command>] ...\` — 各 command 自定义错误前缀

新代码应改用 CommandExecOutcome，避免依赖此启发式。
`.trim(),
    },

    thrownException_v20260517_1: {
      index: `
#### thrownException

\`exec\` 直接抛异常时 catch，result 拼为 \`[command-error] <err.message>\`，isError=true。
`.trim(),
    },
  },

  knowledgeRefCount_v20260517_1: {
    index: `
WindowManager 维护 \`knowledgeRefs: Map<path, Set<windowId>>\` 引用计数。
form 创建时通过 \`recordKnowledgeRefs\` 把它持有的所有 knowledge path 记 +1；
form 移除时 \`releaseKnowledgeRefs\` -1。多 window 共享同一 path 时不会被任一 form 提前释放。
`.trim(),
  },
};

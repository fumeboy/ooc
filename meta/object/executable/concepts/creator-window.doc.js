import * as init from "@src/executable/windows/init";

/**
 * Creator window 概念：每个 thread 启动时与创建方的恒在通道。
 *
 * sources:
 *  - init — initContextWindows + isCreatorSelf / isUserRootThread / hasRealCreator 派生规则
 */
export const creator_window_v20260515_1 = {
  name: "CreatorWindow",
  description: `每个有 creator 的 thread 启动时由 initContextWindows 注入一条 creator window，作为与创建方的恒在通道。`,
  sources: { init },

  typeSelection_v20260517_1: {
    index: `creator window 的 type 由 \`thread.creatorObjectId\` vs \`thread.persistence?.objectId\` 决定；3 个分支详见子节点。`,

    sameObject_v20260517_1: {
      index: `
#### sameObject → type=do

\`isCreatorSelf(thread) === true\`（含两者都缺省）：creator 是父 thread 同 object 内的某个线程。

注入字段：
- \`type: "do"\`
- \`targetThreadId: opts.creatorThreadId ?? SESSION_CREATOR_THREAD_ID\`
- \`status: "running"\`
- \`isCreatorWindow: true\`
- \`parentWindowId: ROOT_WINDOW_ID\`
`.trim(),
    },

    crossObject_v20260517_1: {
      index: `
#### crossObject → type=talk

\`creatorObjectId !== persistence.objectId\`：跨对象 talk 派生的 callee thread；
creator 是 caller object 的某个 thread；callee 通过该 talk_window.say 回复 caller。

注入字段：
- \`type: "talk"\`
- \`target: thread.creatorObjectId\` (caller object id)
- \`targetThreadId: opts.creatorThreadId\`
- \`conversationId: creatorWindowId\`
- \`status: "open"\`
- \`isCreatorWindow: true\`
- \`parentWindowId: ROOT_WINDOW_ID\`
`.trim(),
    },

    userRootShortCircuit_v20260517_1: {
      index: `
#### userRootShortCircuit

\`isUserRootThread(thread) === true\`（即 \`persistence.objectId === "user" && thread.id === "root"\`）：
整个 session 的交互起点，没有 "creator"，所以也不应该有初始 creator window。
\`initContextWindows\` 直接返回，仅确保 \`thread.contextWindows = []\`。
`.trim(),
    },

    selfDrivenRootShortCircuit_v20260517_1: {
      index: `
#### selfDrivenRootShortCircuit

\`hasRealCreator(thread, opts) === false\`（详见 \`hasRealCreatorRule\`）：没有可指向的 creator，
不应注入 phantom creator window，避免 wait 校验把它误判为合法 IO 来源导致死锁。
\`initContextWindows\` 直接返回。
`.trim(),
    },
  },

  hasRealCreatorRule_v20260517_1: {
    index: `\`hasRealCreator(thread, opts)\` 任一为真即视为"有 creator"；3 条来源详见子节点。`,

    optsCreatorThreadId_v20260517_1: {
      index: `#### opts.creatorThreadId — fork / talk-delivery 调用方显式给出。`,
    },

    threadCreatorThreadId_v20260517_1: {
      index: `#### thread.creatorThreadId — 磁盘恢复时 thread.json 里已写过。`,
    },

    threadCreatorObjectId_v20260517_1: {
      index: `#### thread.creatorObjectId — 跨 object talk-delivery 总会设这条。`,
    },
  },

  idempotency_v20260517_1: {
    index: `
两种 window 共用 \`creatorWindowIdOf(thread.id)\` 派生的稳定 id；
\`initContextWindows\` 在写入前检查 list 中是否已有该 id，幂等插入。
\`creatorWindow\` 总是放在 list 头部（unshift 语义）。
`.trim(),
  },

  closeGuard_v20260517_1: {
    index: `
creator window 的 \`isCreatorWindow=true\` 标志使它不可被 LLM 主动 close：
对应 type 的 onClose hook（详见 \`windows.doWindow.onCloseHook.creatorGuard\` /
\`windows.talkWindow.onCloseHook.creatorGuard\`）会向 thread.events 追加一条
\`context_change.inject\` 提示并返回 false，保证与 caller 的通道始终在场。
`.trim(),
  },
};

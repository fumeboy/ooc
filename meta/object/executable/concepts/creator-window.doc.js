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

  typeSelection: {
    title: "type Selection",
    content: `creator window 的 type 由 thread.creatorObjectId vs thread.persistence?.objectId 决定；3 个分支详见子节点。`,

    sameObject: {
      title: "sameObject → type=do",
      content: `
isCreatorSelf(thread) === true（含两者都缺省）：creator 是父 thread 同 object 内的某个线程。

注入字段：
- type: "do"
- targetThreadId: opts.creatorThreadId ?? SESSION_CREATOR_THREAD_ID
- status: "running"
- isCreatorWindow: true
- parentWindowId: ROOT_WINDOW_ID
      `,
    },

    crossObject: {
      title: "crossObject → type=talk",
      content: `
creatorObjectId !== persistence.objectId：跨对象 talk 派生的 callee thread；
creator 是 caller object 的某个 thread；callee 通过该 talk_window.say 回复 caller。

注入字段：
- type: "talk"
- target: thread.creatorObjectId (caller object id)
- targetThreadId: opts.creatorThreadId
- conversationId: creatorWindowId
- status: "open"
- isCreatorWindow: true
- parentWindowId: ROOT_WINDOW_ID
      `,
    },

    userRootShortCircuit: {
      title: "userRootShortCircuit",
      content: `
isUserRootThread(thread) === true（即 persistence.objectId === "user" && thread.id === "root"）：
整个 session 的交互起点，没有 "creator"，所以也不应该有初始 creator window。
initContextWindows 直接返回，仅确保 thread.contextWindows = []。
      `,
    },

    selfDrivenRootShortCircuit: {
      title: "selfDrivenRootShortCircuit",
      content: `
hasRealCreator(thread, opts) === false（详见 hasRealCreatorRule）：没有可指向的 creator，
不应注入 phantom creator window，避免 wait 校验把它误判为合法 IO 来源导致死锁。
initContextWindows 直接返回。
      `,
    },
  },

  hasRealCreatorRule: {
    title: "has Real Creator Rule",
    content: `hasRealCreator(thread, opts) 任一为真即视为"有 creator"；3 条来源详见子节点。`,

    optsCreatorThreadId: {
      title: "opts.creatorThreadId",
      content: `
      fork / talk-delivery 调用方显式给出。
      `,
    },

    threadCreatorThreadId: {
      title: "thread.creatorThreadId",
      content: `
      磁盘恢复时 thread.json 里已写过。
      `,
    },

    threadCreatorObjectId: {
      title: "thread.creatorObjectId",
      content: `
      跨 object talk-delivery 总会设这条。
      `,
    },
  },

  idempotency: {
    title: "idempotency",
    content: `creator window 的幂等插入规则；3 条详见各子节点。`,

    stableIdDerivation: {
      title: "stableIdDerivation",
      content: `
两种 window 共用 creatorWindowIdOf(thread.id) 派生的稳定 id（输入相同 → 输出相同）。
让磁盘恢复 / 重复 init 调用都能命中同一 id，避免出现两个 creator window。
      `,
    },

    skipIfAlreadyPresent: {
      title: "skipIfAlreadyPresent",
      content: `
initContextWindows 在写入前检查 list 中是否已有该 id；存在则直接 return，
不覆盖现有状态（保留 transcript / status 等运行时累积字段）。
      `,
    },

    unshiftToHead: {
      title: "unshiftToHead",
      content: `
creatorWindow 总是放在 list 头部（unshift 语义），让 LLM 默认渲染顺序中
"与 caller 的通道"位于最显眼的位置。
      `,
    },
  },

  closeGuard: {
    title: "close Guard",
    content: `
creator window 的 isCreatorWindow=true 标志使它不可被 LLM 主动 close。
具体 hook 与拒绝路径详见各 type 文档；这里只描述跨 type 的共同规则。
    `,

    flagBasedGuard: {
      title: "flagBasedGuard",
      content: `
判定依据：window.isCreatorWindow === true。
hook 不查询 thread.creator* 字段，避免初始化时机差异——init 阶段写入的标志比 thread.creatorThreadId 等更早可用。
      `,
    },

    injectOnReject: {
      title: "injectOnReject",
      content: `
hook 拒绝时向 thread.events 追加一条 context_change.inject 提示文本，
让下一轮 LLM 看到自己上轮的 close 尝试被拒绝及原因（避免反复 close 振荡）。
      `,
    },

    returnFalseSignal: {
      title: "returnFalseSignal",
      content: `
hook 返回 false → WindowManager.close 据此放弃删除并保留 window。
这是 onClose hook 与 manager 之间的统一信号约定，所有 type 都遵守。
      `,
    },
  },
};

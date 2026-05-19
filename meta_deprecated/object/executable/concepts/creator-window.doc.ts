import type { Concept, DocNode } from "@meta/doc-types";
import * as init from "@src/executable/windows/init";

/* ────────────────────────────────────────────────────────────────
 *  目录页：creator window 注入与守护规则
 * ──────────────────────────────────────────────────────────────── */

/**
 * CreatorWindow 概念：每个 thread 启动时与创建方的恒在通道。
 *
 * sources:
 *  - init — initContextWindows + isCreatorSelf / isUserRootThread / hasRealCreator 派生规则
 */
export type CreatorWindowConcept = Concept & {
  sources: { init: typeof init };

  /** creator window 的 type 分支（4 个：sameObject/crossObject + 2 个短路） */
  typeSelection: DocNode & {
    sameObject: DocNode;
    crossObject: DocNode;
    userRootShortCircuit: DocNode;
    selfDrivenRootShortCircuit: DocNode;
  };

  /** "有 creator" 判定的 3 个 OR 条件 */
  hasRealCreatorRule: DocNode & {
    optsCreatorThreadId: DocNode;
    threadCreatorThreadId: DocNode;
    threadCreatorObjectId: DocNode;
  };

  /** 幂等插入的 3 条规则 */
  idempotency: DocNode & {
    stableIdDerivation: DocNode;
    skipIfAlreadyPresent: DocNode;
    unshiftToHead: DocNode;
  };

  /** 不可被 LLM 主动 close 的 3 条公共规则 */
  closeGuard: DocNode & {
    flagBasedGuard: DocNode;
    injectOnReject: DocNode;
    returnFalseSignal: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const creator_window_v20260515_1: CreatorWindowConcept = {
  name: "CreatorWindow",
  sources: { init },
  description: `
每个有 creator 的 thread 启动时由 initContextWindows 注入一条 creator window，作为与
创建方的恒在通道。
`.trim(),

  typeSelection: {
    title: "type 选型",
    summary: "creator window 的 type 由 creatorObjectId vs persistence.objectId 决定",

    sameObject: {
      title: "sameObject → type=do",
      summary: "isCreatorSelf：父子 thread 同 object",
      content: `
isCreatorSelf(thread) === true（含两者都缺省）：creator 是父 thread 同 object 内的某个线程。

注入字段：
- type: "do"
- targetThreadId: opts.creatorThreadId ?? SESSION_CREATOR_THREAD_ID
- status: "running"
- isCreatorWindow: true
- parentWindowId: ROOT_WINDOW_ID
      `.trim(),
    },

    crossObject: {
      title: "crossObject → type=talk",
      summary: "跨对象 talk 派生的 callee thread",
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
      `.trim(),
    },

    userRootShortCircuit: {
      title: "userRootShortCircuit",
      summary: "user/root 整个 session 的交互起点——无 creator",
      content: `
isUserRootThread(thread) === true（即 persistence.objectId === "user" && thread.id === "root"）：
整个 session 的交互起点，没有 "creator"，所以也不应该有初始 creator window。
initContextWindows 直接返回，仅确保 thread.contextWindows = []。
      `.trim(),
    },

    selfDrivenRootShortCircuit: {
      title: "selfDrivenRootShortCircuit",
      summary: "无可指向的 creator → 不注入 phantom window",
      content: `
hasRealCreator(thread, opts) === false（详见 hasRealCreatorRule）：没有可指向的 creator，
不应注入 phantom creator window，避免 wait 校验把它误判为合法 IO 来源导致死锁。
initContextWindows 直接返回。
      `.trim(),
    },
  },

  hasRealCreatorRule: {
    title: "hasRealCreator 判定",
    summary: "任一为真即视为'有 creator'",

    optsCreatorThreadId: {
      title: "opts.creatorThreadId",
      summary: "fork / talk-delivery 调用方显式给出",
      content: "fork / talk-delivery 调用方显式给出。",
    },

    threadCreatorThreadId: {
      title: "thread.creatorThreadId",
      summary: "磁盘恢复时 thread.json 里已写过",
      content: "磁盘恢复时 thread.json 里已写过。",
    },

    threadCreatorObjectId: {
      title: "thread.creatorObjectId",
      summary: "跨 object talk-delivery 总会设这条",
      content: "跨 object talk-delivery 总会设这条。",
    },
  },

  idempotency: {
    title: "幂等插入",
    summary: "3 条规则：stable id / skip if present / unshift to head",

    stableIdDerivation: {
      title: "stableIdDerivation",
      summary: "creatorWindowIdOf(thread.id) 派生的稳定 id",
      content: `
两种 window 共用 creatorWindowIdOf(thread.id) 派生的稳定 id（输入相同 → 输出相同）。
让磁盘恢复 / 重复 init 调用都能命中同一 id，避免出现两个 creator window。
      `.trim(),
    },

    skipIfAlreadyPresent: {
      title: "skipIfAlreadyPresent",
      summary: "已存在则不覆盖，保留运行时累积字段",
      content: `
initContextWindows 在写入前检查 list 中是否已有该 id；存在则直接 return，
不覆盖现有状态（保留 transcript / status 等运行时累积字段）。
      `.trim(),
    },

    unshiftToHead: {
      title: "unshiftToHead",
      summary: "总是放在 list 头部，渲染最显眼",
      content: `
creatorWindow 总是放在 list 头部（unshift 语义），让 LLM 默认渲染顺序中
"与 caller 的通道"位于最显眼的位置。
      `.trim(),
    },
  },

  closeGuard: {
    title: "close 守护",
    summary: "isCreatorWindow=true 使其不可被 LLM 主动 close",
    content: `
creator window 的 isCreatorWindow=true 标志使它不可被 LLM 主动 close。
具体 hook 与拒绝路径详见各 type 文档；这里只描述跨 type 的共同规则。
    `.trim(),

    flagBasedGuard: {
      title: "flagBasedGuard",
      summary: "判定依据 window.isCreatorWindow === true",
      content: `
判定依据：window.isCreatorWindow === true。
hook 不查询 thread.creator* 字段，避免初始化时机差异——init 阶段写入的标志比 thread.creatorThreadId 等更早可用。
      `.trim(),
    },

    injectOnReject: {
      title: "injectOnReject",
      summary: "拒绝时追加 context_change.inject 提示文本",
      content: `
hook 拒绝时向 thread.events 追加一条 context_change.inject 提示文本，
让下一轮 LLM 看到自己上轮的 close 尝试被拒绝及原因（避免反复 close 振荡）。
      `.trim(),
    },

    returnFalseSignal: {
      title: "returnFalseSignal",
      summary: "hook 返回 false → manager 放弃删除",
      content: `
hook 返回 false → WindowManager.close 据此放弃删除并保留 window。
这是 onClose hook 与 manager 之间的统一信号约定，所有 type 都遵守。
      `.trim(),
    },
  },
};

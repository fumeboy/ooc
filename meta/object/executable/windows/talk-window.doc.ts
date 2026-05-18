import type { Concept, DocNode } from "@meta/doc-types";
import * as talk from "@src/executable/windows/talk";
import * as talkDelivery from "@src/executable/windows/talk-delivery";

/**
 * talk_window 概念：与一个对端 flow object 的持续会话窗口。
 *
 * sources:
 *  - talk         — say / wait / close 命令注册 + onClose hook + basicKnowledge
 *  - talkDelivery — deliverTalkMessage：跨对象消息派送、callee thread 创建
 */
export type TalkWindowConcept = Concept & {
  sources: {
    talk: typeof talk;
    talkDelivery: typeof talkDelivery;
  };

  /** talk_window 命令的统一调用形态 */
  invocationShape: DocNode;

  /** 3 个命令（say 含子节点 / wait / close） */
  commands: {
    title: string;
    summary?: string;
    /** 向对端发一条消息（含 execution + inputKnowledge） */
    say: {
      title: string;
      summary?: string;
      content?: string;
      /** executeTalkWindowSay 4 步 */
      execution: DocNode;
      /** args.msg 缺失时的 input knowledge */
      inputKnowledge: DocNode;
    };
    /** 不发消息，仅父线程切 waiting */
    wait: DocNode;
    /** 等价于 close tool，结束本对话主题 */
    close: DocNode;
  };

  /** basicKnowledge 注入：命令面表 + 4 条关键约束 */
  basicKnowledge: {
    title: string;
    summary?: string;
    content?: string;
    /** 4 条关键约束 */
    constraints: DocNode;
  };

  /** onCloseTalkWindow hook：仅处理 creator 拦截 */
  onCloseHook: {
    title: string;
    summary?: string;
    /** isCreatorWindow=true 时拒关 */
    creatorGuard: DocNode;
  };

  /** deliverTalkMessage 跨对象派送细节 */
  delivery: {
    title: string;
    summary?: string;
    content?: string;
    /** callee thread 解析的 2 个分支 */
    calleeThreadResolution: {
      title: string;
      summary?: string;
      /** 首次派送：创建 callee thread + 注入 creator talk_window */
      firstDeliveryCreates: DocNode;
      /** 已有 callee thread 时复用 */
      subsequentReuses: DocNode;
    };
    /** 派送时同时写 caller.outbox + callee.inbox + callee 复活 */
    doubleWrite: {
      title: string;
      summary?: string;
      callerOutboxWrite: DocNode;
      calleeInboxWrite: DocNode;
      calleeStatusRevive: DocNode;
    };
  };
};

export const talk_window_v20260515_1: TalkWindowConcept = {
  name: "TalkWindow",
  sources: { talk, talkDelivery },
  description: `
talk_window 是与一个对端 flow object（含 "user"）的持续会话窗口。
`.trim(),

  invocationShape: {
    title: "调用形态",
    summary: "open(parent_window_id=\"<talk_window_id>\", command=\"...\", args={...})",
    content: `
talk_window 注册的 command 不挂在 root 上。调用形态统一是：
open(parent_window_id="<talk_window_id>", command="...", args={...})。
root.talk 只用来"创建 talk_window"，**不是**用来发消息。
    `.trim(),
  },

  commands: {
    title: "命令面",
    summary: "talk_window 注册 3 个 command",

    say: {
      title: "say",
      content: `
向对端发一条消息。paths: say / say.wait（args.wait=true 时追加 say.wait path）。

参数：
- msg: 必填，消息正文
- wait: 可选；true 时父线程在派送后切到 waiting，等对端回信进 inbox 唤醒
      `.trim(),

      execution: {
        title: "execution（executeTalkWindowSay）",
        content: `
1. 校验：parentWindow 必须是 type=talk；thread 必须带 persistence 才能跨对象派送
2. 调 deliverTalkMessage({ caller:{thread,talkWindow}, content, source:"talk" })
3. 派送成功后：若 args.wait===true →
   - thread.status = "waiting"
   - thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0
   - thread.waitingOn = window.id （等的就是这个 talk_window 上的回信）
4. 失败：返回 [talk_window.say] 派送失败：<msg>
        `.trim(),
      },

      inputKnowledge: {
        title: "inputKnowledge",
        content: `
formStatus==="open" 且 args.msg 缺失/空串时，knowledge 表追加 key
internal/windows/talk/say/input，正文提示 refine(args={ msg, wait })。
        `.trim(),
      },
    },

    wait: {
      title: "wait",
      content: `
不发消息，仅把父线程切到 waiting 等下一条 inbox。

参数：无。
执行：
- thread.status = "waiting"
- thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0
- thread.waitingOn = parentWindow.id
      `.trim(),
    },

    close: {
      title: "close",
      content: `
等价于 close tool，明确表达"结束本对话主题"。

- exec 体 no-op；副作用走 onClose hook
- 非 creator talk_window：直接释放
- creator talk_window：onClose 拒绝
      `.trim(),
    },
  },

  basicKnowledge: {
    title: "basic knowledge 注入",
    summary: "命令面表 + 4 条关键约束注入到 context",
    content: `
通过 registerWindowType("talk", { basicKnowledge: TALK_WINDOW_BASIC_KNOWLEDGE })
注入；只要 thread.contextWindows 里出现至少一个 talk_window，全局基础知识合成阶段就把
这段文本作为一个 protocol KnowledgeWindow 注入到 context。

内容覆盖：命令面表（say/wait/close 各自的 args 与典型用法）+ 4 条关键约束。
    `.trim(),

    constraints: {
      title: "4 条关键约束",
      content: `
- 不接受 root.talk — root.talk 用于"创建 talk_window"，不是发消息
- 想发消息只用 say — 一致心智，避免 LLM 把 say 与 talk 混淆
- 复用同一 talk_window — 不要每发一条就 close 再重开
- creator talk_window 是回信通道 — isCreatorWindow=true 的那条用于回 caller，
  收到 inbox 后回复就走它的 say，不要 open 新 talk
      `.trim(),
    },
  },

  onCloseHook: {
    title: "onClose hook",
    summary: "onCloseTalkWindow 注册到 type=talk 的 onClose hook，仅处理 creator 一种特例",

    creatorGuard: {
      title: "creatorGuard",
      content: `
window.isCreatorWindow === true 时拒绝关闭：

- 向 thread.events 追加一条 context_change.inject，文本
  [close 拒绝] talk_window "<id>" 是初始 creator talk_window，与 caller 的恒在通道，不可关闭。
- 返回 false，WindowManager.close 据此放弃删除并保留 window
      `.trim(),
    },
  },

  delivery: {
    title: "delivery",
    summary: "deliverTalkMessage 承担跨对象派送的核心逻辑",
    content: `
deliverTalkMessage(opts) 由 talk-delivery 模块提供，承担跨对象派送的核心逻辑。
talk_window.say 是它的唯一上游调用方。
    `.trim(),

    calleeThreadResolution: {
      title: "callee thread 解析",
      summary: "按 caller.talkWindow.target 定位或创建 callee thread",

      firstDeliveryCreates: {
        title: "firstDeliveryCreates",
        content: `
首次派送：创建 callee thread，注入 creator talk_window 指向 caller thread，
确保 callee 一启动就持有回信通道。
        `.trim(),
      },

      subsequentReuses: {
        title: "subsequentReuses",
        content: `
target objectId 已有对应 callee thread 时复用，不创建新线程。同一对话只会有一个 callee thread。
        `.trim(),
      },
    },

    doubleWrite: {
      title: "double write",
      summary: "派送时同时写 caller.outbox 与 callee.inbox",

      callerOutboxWrite: {
        title: "callerOutboxWrite",
        content: `
caller.thread.outbox 追加 message（windowId=本 talk_window.id, source=talk），
让 caller 自己看到"我刚发了什么"。
        `.trim(),
      },

      calleeInboxWrite: {
        title: "calleeInboxWrite",
        content: `
callee.thread.inbox 追加 message + 事件 context_change.inbox_message_arrived，
让 callee 下一轮 transcript 能看到这条消息。
        `.trim(),
      },

      calleeStatusRevive: {
        title: "calleeStatusRevive",
        content: `
callee thread 若处于 done/failed/paused 会被切到 running，由 scheduler 选中执行；
保证消息一定会被处理。
        `.trim(),
      },
    },
  },
};

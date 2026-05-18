import type { Concept, DocNode } from "@meta/doc-types";
import * as doWindow from "@src/executable/windows/do";

/**
 * do_window 概念：fork 子线程后产生的对话窗口。
 *
 * sources:
 *  - doWindow — continue / wait / close 命令注册 + onClose hook
 */
export type DoWindowConcept = Concept & {
  sources: { doWindow: typeof doWindow };

  /** 3 个关键字段（targetThreadId / isCreatorWindow / status） */
  fields: DocNode;

  /** 3 个命令（continue / wait / close） */
  commands: {
    title: string;
    summary?: string;
    /** 向 do_window 关联的子线程追加消息（含 execution 4 步 + inputKnowledge） */
    continue: {
      title: string;
      summary?: string;
      content?: string;
      /** executeDoWindowContinue 顺序 4 步 */
      execution: {
        title: string;
        summary?: string;
        /** parentWindow type 校验 + findChild 定位 child */
        step1Validate: DocNode;
        /** target.inbox + thread.outbox 双写 */
        step2DoubleWrite: DocNode;
        /** done/failed → running */
        step3ReviveChild: DocNode;
        /** args.wait===true 时父线程切 waiting */
        step4OptionalWait: DocNode;
      };
      /** args.msg 缺失时的 input knowledge */
      inputKnowledge: DocNode;
    };
    /** 不发消息，仅把父线程切 waiting */
    wait: DocNode;
    /** 等价于 close tool，归档子线程对话 */
    close: DocNode;
  };

  /** onCloseDoWindow hook：creator 拦截 / 非 creator 归档子线程 */
  onCloseHook: {
    title: string;
    summary?: string;
    /** isCreatorWindow=true 时拒关 */
    creatorGuard: DocNode;
    /** 非 creator do_window：归档子线程 */
    archiveChild: DocNode;
  };
};

export const do_window_v20260515_1: DoWindowConcept = {
  name: "DoWindow",
  sources: { doWindow },
  description: `
do_window 是同 object 内 fork 子线程后挂在父线程下的对话窗口；父线程通过它的
continue / wait / close 与子线程交互。
`.trim(),

  fields: {
    title: "字段",
    summary: "do_window 的 3 个关键字段",
    content: `
- targetThreadId — fork 出的 child thread id；transcript 视图按它过滤 inbox/outbox
- isCreatorWindow — true 时为初始 creator do_window（由 windows/init.ts 注入），
  不可被 LLM 主动 close
- status — 子线程当前状态投影（running / waiting / paused / done / failed）
    `.trim(),
  },

  commands: {
    title: "命令面",
    summary: "do_window 注册 3 个 command；调用形态：open(parent_window_id=\"<do_window_id>\", command=\"...\", args={...})",

    continue: {
      title: "continue",
      content: `
向 do_window 关联的子线程追加一条消息。paths: continue / continue.wait
（args.wait=true 时追加 continue.wait path）。

参数：
- msg: 必填
- wait: 可选；true 时父线程进入 waiting，等子线程回写消息再唤醒
      `.trim(),

      execution: {
        title: "execution（executeDoWindowContinue）",
        summary: "顺序 4 步",

        step1Validate: {
          title: "step1Validate",
          content: `
parentWindow 必须是 type=do；通过 findChild(thread, targetThreadId) 在子树中定位 child；
任一不满足 → 返回 [do_window.continue] 错误。
          `.trim(),
        },

        step2DoubleWrite: {
          title: "step2DoubleWrite",
          content: `
构造 message（source="do"）：target.inbox 追加 + 事件 context_change.inbox_message_arrived；
同时 thread.outbox 追加镜像消息让父线程能看到自己发了什么。
          `.trim(),
        },

        step3ReviveChild: {
          title: "step3ReviveChild",
          content: `
若 child.status 是 done/failed → 切到 running，让 scheduler 重新选中执行；
保证子线程不会因为之前的 end 错过新消息。
          `.trim(),
        },

        step4OptionalWait: {
          title: "step4OptionalWait",
          content: `
args.wait===true 时设置 thread.status=waiting / inboxSnapshotAtWait=inbox.length /
waitingOn=parentWindow.id；省一次显式 wait tool 调用。
          `.trim(),
        },
      },

      inputKnowledge: {
        title: "inputKnowledge",
        content: `
formStatus==="open" 且 args.msg 缺失/空串时，knowledge 表追加 key
internal/windows/do/continue/input，提示 refine(args={ msg, wait })。
        `.trim(),
      },
    },

    wait: {
      title: "wait",
      content: `
不向子线程发消息，仅把父线程切到 waiting 直到子线程回写。参数：无。

执行：
- thread.status = "waiting"
- thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0
- thread.waitingOn = parentWindow.id
      `.trim(),
    },

    close: {
      title: "close",
      content: `
等价于 close tool，明确表达"归档子线程对话"。

- exec 体调 archiveDoWindowChild(thread, window) 走快捷路径（与 onClose hook 同一副作用）
- 实际删除由 close tool / WindowManager 完成
      `.trim(),
    },
  },

  onCloseHook: {
    title: "onClose hook",
    summary: "onCloseDoWindow 注册到 type=do 的 onClose hook，分两支处理",

    creatorGuard: {
      title: "creatorGuard",
      content: `
window.isCreatorWindow === true 时拒绝关闭：

- 向 thread.events 追加 context_change.inject，文本
  [close 拒绝] window <id> 是初始 creator do_window，不可关闭（spec § 初始 creator 对话 window）。
- 返回 false，保证与父线程的恒在通道始终在场
      `.trim(),
    },

    archiveChild: {
      title: "archiveChild",
      content: `
非 creator do_window：调 archiveDoWindowChild —— 找到 targetThreadId 对应的 child；
若其 status 是 running / waiting → 切到 paused，不再被 scheduler 选中。
      `.trim(),
    },
  },
};

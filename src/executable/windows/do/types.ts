import type { BaseContextWindow } from "../_shared/types.js";

/**
 * Do window — fork 子线程后在父线程下产生的对话窗口。
 *
 * - targetThreadId：fork 出的 child thread id；transcript 视图按它过滤 inbox/outbox
 * - 注册的 command（详见 windows/do/index.ts）：continue / wait / close
 * - close 语义（B=ii archive）：标记 child thread 为 archived 状态；对应 onClose hook
 * - 特殊子类：初始 creator do_window（id 派生自 thread.id，targetThreadId=creator），不可被 close
 */
export interface DoWindow extends BaseContextWindow {
  type: "do";
  targetThreadId: string;
  status: "running" | "archived";
  /** 标记为初始 creator do_window，不可被 LLM close（spec § 初始 creator 对话 window）。 */
  isCreatorWindow?: boolean;
}

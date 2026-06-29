/**
 * user —— 真人用户在 OOC World 内的占位 **object class**（不是 LLM Agent，不跑 thinkloop）。
 *
 * 经 `_builtin/user` class 继承，可有多个实例（按 name 区分）；scheduler 跳过 user 实例。
 * agent.talk(target="user") 向 user 推 messages；控制面把人类回复写入对应 thread。
 */
export interface Data {
  /** display name / 标识。 */
  name?: string;
  /**
   * user 的 root thread id (S5, 2026-06-29 落地)。
   *
   * 用户裁决: "新建 session 时,给 user 创建一个名为 root 的 thread, 这个 thread 和普通的
   * thread 一样的结构, 只是不参与 thread 调度"。
   *
   * - root thread 是 user 与外部对话的入口容器(skip_scheduling=true)
   * - root thread.contextWindows 持子 thread refs(指向 user talk 的各 target agent thread)
   * - user 经 server endpoint `POST /api/flows/<sid>/continue` 写消息到 root.contextWindows
   *   中某个子 thread.transcript, 并唤醒该子 thread 的 worker
   */
  rootThreadId?: string;
}

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * 本 class 全部字段非版本化（运行时载体 / tool-object / sediment 已落 pool）。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = [] as const;

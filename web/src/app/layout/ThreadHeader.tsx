import type { ThreadContext } from "../../domains/chat";
import { useDisplayName, useDisplayNames } from "../../domains/objects";
import type { SessionThread } from "../state";
import { humanizeThreadId } from "./threadDisplay";

/**
 * ThreadHeader — 紧凑版 thread 标识：objectId · threadId、状态 pill、thread 切换 select。
 *
 * 与原 RightPanel 顶部的 assistant-head 区别：
 * - 无 avatar，整体高度小，能内联进 MainPanel breadcrumb-bar 同一行
 * - 不携带 chat 行为（只是显示与切换），方便在 RightPanel 被隐藏（如 user.root）时仍可见
 *
 * Issue #3 A2 fix: thread id 在 UI 上做表层 humanize（`t_user_*` → `user-talk`，
 * 其他 → 最后 6 字符），原始 token 保留在 title attr / option title 中供 hover 查看。
 * 这一轮**不**引入 displayName 模型字段（Supervisor 哲学层未决，详见 Issue #3 comment）。
 */
export function ThreadHeader({
  objectId,
  threadId,
  thread,
  sessionThreads,
  onSelectThread,
}: {
  objectId?: string;
  threadId?: string;
  thread?: ThreadContext;
  sessionThreads?: SessionThread[];
  onSelectThread?: (sel: SessionThread) => void;
}) {
  if (!objectId) return null;
  const status = thread?.status;
  // 2026-05-27: thread-switcher 隐藏 user.root —— 它是 session 主入口，不通过 switcher
  // 切换查看（路由 path 决定 view，user.root 不再是右栏可选 thread）。
  const threads = (sessionThreads ?? []).filter(
    (t) => !(t.objectId === "user" && t.threadId === "root"),
  );
  const activeKey = objectId && threadId ? `${objectId}/${threadId}` : "";
  const displayTid = threadId ? humanizeThreadId(threadId) : undefined;
  const { displayName: ownerDisplay } = useDisplayName(objectId);
  // 批量预热 select 中所有 objectId 的 displayName(共享 LRU,只一次并发请求)
  const peerNames = useDisplayNames(threads.map((t) => t.objectId));

  return (
    <div className="thread-header">
      {status && <span className={`status-pill status-pill-thread status-${status}`}>{status}</span>}
      {threads.length > 1 && onSelectThread && (
        <select
          className="thread-switcher"
          value={activeKey}
          onChange={(event) => {
            const [oid, tid] = event.target.value.split("/");
            if (oid && tid) onSelectThread({ objectId: oid, threadId: tid });
          }}
          title="切换 thread"
        >
          {threads.map((t) => {
            const key = `${t.objectId}/${t.threadId}`;
            const label = `${peerNames[t.objectId] ?? t.objectId} · ${humanizeThreadId(t.threadId)}`;
            // option 的 title attr 在大多数浏览器中 hover 时可见，让原始 objectId / thread id 仍可探查
            return (
              <option key={key} value={key} title={`${t.objectId} / ${t.threadId}`}>
                {label}
              </option>
            );
          })}
        </select>
      )}
    </div>
  );
}

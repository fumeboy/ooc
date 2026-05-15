import type { ThreadContext } from "../../domains/chat";
import type { SessionThread } from "../state";

/**
 * ThreadHeader — 紧凑版 thread 标识：objectId · threadId、状态 pill、thread 切换 select。
 *
 * 与原 RightPanel 顶部的 assistant-head 区别：
 * - 无 avatar，整体高度小，能内联进 MainPanel breadcrumb-bar 同一行
 * - 不携带 chat 行为（只是显示与切换），方便在 RightPanel 被隐藏（如 user.root）时仍可见
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
  const threads = sessionThreads ?? [];
  const activeKey = objectId && threadId ? `${objectId}/${threadId}` : "";

  return (
    <div className="thread-header">
      <span className="thread-header-id">
        <strong>{objectId}</strong>
        {threadId && <span className="muted small thread-header-tid">· {threadId}</span>}
      </span>
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
            return (
              <option key={key} value={key}>
                {t.objectId} · {t.threadId}
              </option>
            );
          })}
        </select>
      )}
    </div>
  );
}

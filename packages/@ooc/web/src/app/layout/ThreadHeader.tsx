import { useDisplayNames } from "../../domains/objects";
import type { ThreadContext } from "../../domains/chat";
import type { SessionThread } from "../state";
import { humanizeThreadId } from "./threadDisplay";

/**
 * ThreadHeader — 紧凑版 thread 标识：thread 切换 select（或静态 label）。
 *
 * 与原 RightPanel 顶部的 assistant-head 区别：
 * - 无 avatar，整体高度小，能内联进 MainPanel breadcrumb-bar 同一行
 * - 不携带 chat 行为（只是显示与切换），方便在 RightPanel 被隐藏（如 user.root）时仍可见
 *
 * thread.status pill 已搬至 RightPanel.right-footer (与 session-pause
 * 按钮同栏展示, 避免 "顶部 chip running / 底部 composer 已暂停" 的语义矛盾)。
 *
 * 单 thread 或 user.root 视角下也渲染 wrapper，但以静态 label 代替
 * select（避免 select.value 不在 options 的 React warning，并保证 breadcrumb 始终有
 * thread 上下文 —— `deriveHeaderTitle` 在带 thread 上下文时让位给 ThreadHeader）。
 */
export function ThreadHeader({
  objectId,
  threadId,
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
  // thread-switcher 隐藏 user.root —— 它是 session 主入口，不通过 switcher
  // 切换查看（路由 path 决定 view，user.root 不再是右栏可选 thread）。
  const threads = (sessionThreads ?? []).filter(
    (t) => !(t.objectId === "user" && t.threadId === "root"),
  );
  const activeKey = objectId && threadId ? `${objectId}/${threadId}` : "";
  const activeInList = threads.some(
    (t) => `${t.objectId}/${t.threadId}` === activeKey,
  );
  // 批量预热 select 中所有 objectId 的 displayName(共享 LRU,只一次并发请求)
  // 包含当前 objectId（user.root 视角下 objectId="user"，不在 threads 列表中但需展示）
  const peerNames = useDisplayNames(
    Array.from(new Set([...threads.map((t) => t.objectId), objectId])),
  );

  // 多 thread + 当前 thread 在可切换列表中 + 有 select 回调 → 渲染 switcher
  const canSwitch = threads.length >= 2 && activeInList && Boolean(onSelectThread);

  if (canSwitch) {
    return (
      <div className="thread-header">
        <select
          className="thread-switcher"
          value={activeKey}
          onChange={(event) => {
            const [oid, tid] = event.target.value.split("/");
            if (oid && tid) onSelectThread?.({ objectId: oid, threadId: tid });
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
      </div>
    );
  }

  // 单 thread 或 user.root 视角 → 静态 label（仍渲染 wrapper，保证 breadcrumb 不空）
  const staticLabel = `${peerNames[objectId] ?? objectId} · ${humanizeThreadId(threadId ?? "")}`;
  return (
    <div className="thread-header">
      <span
        className="thread-header-id"
        title={threadId ? `${objectId} / ${threadId}` : objectId}
      >
        {staticLabel}
      </span>
    </div>
  );
}

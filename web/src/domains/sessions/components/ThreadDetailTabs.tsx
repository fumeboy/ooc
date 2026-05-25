/**
 * ThreadDetailTabs — R0c 接入容器, 在 thread context tree 与 Loop Timeline 之间切换。
 *
 * 使用场景: MainPanel 在 `route.kind === "session"` + objectId !== "user" + 无 file
 * 时把原本直接 render 的 FileViewer (内嵌 ContextSnapshotViewer) 替换为本容器。
 *
 * 默认 tab: "context" — 与改造前的视觉一致, 避免一进页面就 fetch loops。
 * Loop Timeline tab lazy: 用户点击时才 mount, 触发 list-loops + thread fetch。
 * 这是 plan §6.3 的 "默认不打开 (避免一进页面就 fetch)" 约束的实现。
 *
 * 不重构现有 FileViewer: context tab 继续走 FileViewer (传 thread, 无 file), 其内部
 * 会渲染 ContextSnapshotViewer。
 */

import { useState } from "react";
import type { ThreadContext } from "../../chat";
import { FileViewer } from "../../files/components/FileViewer";
import { LoopTimeline } from "./LoopTimeline";

export interface ThreadDetailTabsProps {
  sessionId: string;
  objectId: string;
  threadId: string;
  thread?: ThreadContext;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
}

type Tab = "context" | "timeline";

export function ThreadDetailTabs({
  sessionId,
  objectId,
  threadId,
  thread,
  selfObjectId,
  onUserReply,
}: ThreadDetailTabsProps) {
  const [tab, setTab] = useState<Tab>("context");
  return (
    <div className="thread-detail-tabs">
      <div className="thread-detail-tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "context"}
          className={`thread-detail-tab ${tab === "context" ? "is-active" : ""}`}
          onClick={() => setTab("context")}
        >
          Context Snapshot
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "timeline"}
          className={`thread-detail-tab ${tab === "timeline" ? "is-active" : ""}`}
          onClick={() => setTab("timeline")}
          title="按 LLM 轮次展开 thread (R0c)"
        >
          Loop Timeline
        </button>
      </div>
      <div className="thread-detail-tab-body" role="tabpanel">
        {tab === "context" && (
          <FileViewer
            file={undefined}
            thread={thread}
            selfObjectId={selfObjectId}
            onUserReply={onUserReply}
          />
        )}
        {tab === "timeline" && (
          <LoopTimeline sessionId={sessionId} objectId={objectId} threadId={threadId} />
        )}
      </div>
    </div>
  );
}

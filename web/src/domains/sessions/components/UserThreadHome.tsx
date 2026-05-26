/**
 * UserThreadHome —— user 的 session 主视图。
 *
 * 2026-05-26 Round 8 D5 重构：
 *   主体完全替换为 `<SessionThreadsIndex>`，从 Round 7 的 "Chats list + SelectionDetail"
 *   形态升级为 "ObjectColumns + RelationOverlay + SelectionDetail" 多 object 索引。
 *
 *   设计依据: docs/2026-05-26-session-threads-index-design.md。
 *
 * 保留行为：
 *   - MainPanel 通过 `isUserThreadHome` 路由到这里, 不动 MainPanel 分发逻辑
 *   - ChatPanel 路径完全保留: SessionThreadsIndex 选中 chat:<wid> 时仍渲染 ChatPanel
 *   - H-3 "Seed via welcome" 在 empty session 仍能用 (移到 SessionThreadsIndex 内部)
 *   - URL `?selected=chat:<wid>` 兼容 (Round 7) + `?selected=thread:<obj>:<tid>` (Round 8)
 */
import type { ThreadContext } from "../../chat";
import { SessionThreadsIndex } from "./SessionThreadsIndex";

interface UserThreadHomeProps {
  sessionId: string;
  thread?: ThreadContext;
  /**
   * 旧的 user.root 默认 talk_window 派单回调；本视图改走 continueThread + 显式 windowId 直调，
   * 不再依赖此 prop。保留 prop 兼容 MainPanel 调用签名。
   */
  onUserReply?: (text: string) => Promise<void>;
  /** self objectId — 透传给 SessionThreadsIndex → ThreadInspectDetail → ThreadDetailTabs */
  selfObjectId?: string;
}

export function UserThreadHome({ sessionId, thread, selfObjectId }: UserThreadHomeProps) {
  return (
    <div className="user-thread-home">
      <SessionThreadsIndex
        sessionId={sessionId}
        thread={thread}
        selfObjectId={selfObjectId}
      />
    </div>
  );
}

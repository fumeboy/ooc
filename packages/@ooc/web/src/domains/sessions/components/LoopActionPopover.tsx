/**
 * LoopActionPopover — timeline 交互弹层。
 *
 * - "permission" : 显示 permission_ask 详情 + Approve / Reject 按钮 (+ 可选 reason)。
 *                  按钮触发 POST /api/runtime/.../permission, 成功后调 onResolved 让父级
 *                  refresh timeline; 失败时在 popover 内显示错误 (silent-swallow ban)。
 *
 * 设计取舍:
 * - 用 modal-backdrop / compact-modal 现有 token, 不引入新 popover 容器系统;
 *   功能上更接近 lightweight modal (centered card), 视觉与现有 talk modal 一致。
 * - 不引用 @radix-ui/react-dialog: 要求 "最小自写", 且 modal-backdrop 已是
 *   项目内通行模式 (见 styles.css L404-409 NewChatModal 用法)。
 * - 没把 fetch 写进本组件: 改用 onConfirm 回调注入, 让 LoopTimeline 拥有 fetcher (与单测
 *   注入路径一致)。本组件只关心 form state + 错误显示。
 */

import { useState } from "react";
import type { LoopEvent } from "./LoopEventBadge";

export type LoopActionPopoverMode = "permission";

export interface LoopActionPopoverProps {
  mode: LoopActionPopoverMode;
  event: LoopEvent;
  onClose: () => void;
  /**
   * permission 模式专用: 父级注入的决议执行器。
   * 期望失败时 throw — 本组件 catch 并显示错误。成功后由父级负责刷新, 不在本组件 close。
   */
  onDecide?: (args: { action: "approve" | "reject"; reason?: string }) => Promise<void>;
}

export function LoopActionPopover({
  mode,
  event,
  onClose,
  onDecide,
}: LoopActionPopoverProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleDecide = async (action: "approve" | "reject") => {
    if (!onDecide) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await onDecide({
        action,
        reason: reason.trim() ? reason.trim() : undefined,
      });
      // 成功 — 关闭由父级在 refresh 之后处理 (见 LoopTimeline.handleDecide)。
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop loop-action-backdrop"
      role="dialog"
      aria-modal="true"
      data-testid={`loop-action-${mode}`}
      onClick={(e) => {
        // 仅当点击 backdrop 本身(非 card 内部)时关闭。
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="modal-card compact-modal loop-action-card" onClick={(e) => e.stopPropagation()}>
        <PermissionContent
          event={event}
          reason={reason}
          setReason={setReason}
          submitting={submitting}
          error={error}
          onApprove={() => void handleDecide("approve")}
          onReject={() => void handleDecide("reject")}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

function PermissionContent({
  event,
  reason,
  setReason,
  submitting,
  error,
  onApprove,
  onReject,
  onClose,
}: {
  event: LoopEvent;
  reason: string;
  setReason: (v: string) => void;
  submitting: boolean;
  error: string | undefined;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const command = typeof event.method === "string" ? event.method : "(unknown)";
  const argsSummary = typeof event.argsSummary === "string" ? event.argsSummary : "";
  const windowId = typeof event.windowId === "string" ? event.windowId : "";
  return (
    <>
      <header className="loop-action-header">
        <strong>Permission ask</strong>
      </header>
      <dl className="loop-action-meta">
        <dt>command</dt>
        <dd><code>{command}</code></dd>
        {argsSummary && (
          <>
            <dt>args</dt>
            <dd className="loop-action-args">{argsSummary}</dd>
          </>
        )}
        {windowId && (
          <>
            <dt>window</dt>
            <dd><code>{windowId}</code></dd>
          </>
        )}
      </dl>
      <label className="field-label">
        Reason (可选)
        <textarea
          className="code-textarea loop-action-reason"
          value={reason}
          placeholder="拒绝原因; 留空则不附 reason"
          onChange={(e) => setReason(e.target.value)}
          disabled={submitting}
          data-testid="loop-action-reason"
        />
      </label>
      {error && (
        <div className="error" role="alert" data-testid="loop-action-error">
          决议失败: {error}
        </div>
      )}
      <div className="modal-actions loop-action-buttons">
        <button
          type="button"
          className="btn small"
          onClick={onClose}
          disabled={submitting}
          data-testid="loop-action-close"
        >
          Close
        </button>
        <button
          type="button"
          className="btn small"
          onClick={onReject}
          disabled={submitting}
          data-testid="loop-action-reject"
        >
          {submitting ? "…" : "Reject"}
        </button>
        <button
          type="button"
          className="btn small primary"
          onClick={onApprove}
          disabled={submitting}
          data-testid="loop-action-approve"
        >
          {submitting ? "…" : "Approve"}
        </button>
      </div>
    </>
  );
}


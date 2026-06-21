import type { Data } from "../types.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class";
import React from "react";

/**
 * Todo window 视图。
 *
 * 业务字段读自实例 `data`；在 **flow scope** 渲染时 renderer 注入 `callMethod`，此时
 * 卡片提供编辑交互（改正文 / 切完成）——经 visible/server 的 set_content / toggle_done
 * 改 object data。无 callMethod（stone scope / 未注入）则优雅降级为只读展示。
 *
 * 这是「class 自写 visible UI 经 flow callMethod 调 visible/server 改 data」的端到端
 * demonstrator：UI → callMethod → HTTP /call_method → visible/server → reportDataEdit。
 */
export default function TodoWindowDetail({
  window,
  callMethod,
}: {
  window: OocObjectRef & { data: Data };
  callMethod?: (method: string, args?: object) => Promise<unknown>;
}) {
  const data = window.data;
  // 本地乐观态：先用实例 data 初值，callMethod 成功后用返回的 data 覆盖（无需整页刷新）。
  const [content, setContent] = React.useState(data.content);
  const [status, setStatus] = React.useState<Data["status"]>(data.status);
  const [draft, setDraft] = React.useState(data.content);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  const readOnly = !callMethod;

  const onSaveContent = async () => {
    if (!callMethod) return;
    const next = draft.trim();
    if (!next) {
      setError("正文不能为空");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      // callMethod 返回的是已解包的 method result.data（renderer 取 response.data）。
      const res = (await callMethod("set_content", { content: next })) as { content?: string } | undefined;
      setContent(res?.content ?? next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onToggleDone = async () => {
    if (!callMethod) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = (await callMethod("toggle_done", {})) as { status?: Data["status"] } | undefined;
      if (res?.status) setStatus(res.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="llm-input-attr-row">
        <span className="llm-input-attr-key">status</span>
        <span className="llm-input-attr-value">{status}</span>
      </div>
      <pre className="llm-input-pre">{content}</pre>
      {data.activatesOn && data.activatesOn.length > 0 && (
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">activates_on</span>
          <span className="llm-input-attr-value">{data.activatesOn.join(", ")}</span>
        </div>
      )}
      {!readOnly && (
        <div className="todo-edit-area stack">
          <textarea
            className="textarea code-textarea"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="编辑待办正文…"
          />
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={onSaveContent}>
              {busy ? "…" : "保存正文"}
            </button>
            <button className="btn" disabled={busy} onClick={onToggleDone}>
              {status === "done" ? "标记未完成" : "标记完成"}
            </button>
          </div>
          {error && <span className="muted small">错误：{error}</span>}
        </div>
      )}
    </>
  );
}

export { TodoWindowDetail as WindowDetail };

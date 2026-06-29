/**
 * ProgramWindowDetail — program window 详情面板(视觉体)。
 *
 * Phase 1: read-only 静态展示 program window 的 history(exec 列表)。
 * - attrs 区:history count / language 分布 / 最后一次 exec 的 startedAt
 * - history 列表:倒序(新的在上),最多 20 条;超出附 "...still N more older" 提示
 *   - 每条头:language badge + execId(短) + startedAt(local time)+ ok 状态
 *   - code 单行预览(truncate 60 char,monospace)
 *   - args 单行 JSON 预览
 *   - output 完整显示(max-height 200px overflow auto)
 *
 * 签名统一为 `({ window }: { window: ContextWindow }) => JSX`,不带 callMethod。
 */
import React from "react";
import type { ContextWindow } from "../../context-snapshot";

type ProgramWindow = Extract<ContextWindow, { class: "program" }>;
type ExecEntry = ProgramWindow["history"][number];

const HISTORY_DISPLAY_LIMIT = 20;
const CODE_PREVIEW_LIMIT = 60;
const ARGS_PREVIEW_LIMIT = 80;

function truncateInline(s: string, limit: number): string {
  const single = s.replace(/\s+/g, " ").trim();
  if (single.length <= limit) return single;
  return `${single.slice(0, limit)}…`;
}

function shortExecId(execId: string): string {
  if (execId.length <= 10) return execId;
  return execId.slice(0, 8);
}

function previewArgs(args: unknown): string {
  try {
    return truncateInline(JSON.stringify(args), ARGS_PREVIEW_LIMIT);
  } catch {
    return "(unserializable)";
  }
}

export default function ProgramWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as ProgramWindow;
  const total = w.history.length;
  const langCounts: Record<string, number> = {};
  for (const ex of w.history) {
    langCounts[ex.language] = (langCounts[ex.language] ?? 0) + 1;
  }
  const langSummary = Object.entries(langCounts)
    .map(([lang, n]) => `${lang} ${n}`)
    .join(" · ");
  const lastExec = total > 0 ? w.history[total - 1] : undefined;
  const lastStartedAt = lastExec ? new Date(lastExec.startedAt).toLocaleString() : "(never)";

  // 倒序:新的在上;再切前 N 条
  const reversed = [...w.history].reverse();
  const shown: ExecEntry[] = reversed.slice(0, HISTORY_DISPLAY_LIMIT);
  const overflow = total - shown.length;

  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">history</span>
          <span className="llm-input-attr-value">{total} exec{total === 1 ? "" : "s"}</span>
        </div>
        {total > 0 && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">languages</span>
            <span className="llm-input-attr-value">{langSummary}</span>
          </div>
        )}
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">last exec</span>
          <span className="llm-input-attr-value">{lastStartedAt}</span>
        </div>
      </div>
      {total === 0 ? (
        <div className="llm-input-empty">no exec yet</div>
      ) : (
        <ul className="cw-program-history-list">
          {shown.map((ex) => {
            const startedAt = new Date(ex.startedAt).toLocaleString();
            const headLabel = ex.language === "function" ? (ex.function ?? "(anonymous)") : ex.language;
            const codePreview = ex.language === "function"
              ? undefined
              : ex.code
                ? truncateInline(ex.code, CODE_PREVIEW_LIMIT)
                : undefined;
            return (
              <li key={ex.execId} className="cw-program-history-row">
                <div className="llm-input-attr-row">
                  <span className="llm-input-attr-key">{headLabel}</span>
                  <span className="llm-input-attr-value">
                    <code className="muted small">{shortExecId(ex.execId)}</code>
                    <span className="muted small"> · {startedAt} · </span>
                    <span>{ex.ok ? "✅ ok" : "❌ fail"}</span>
                  </span>
                </div>
                {codePreview && (
                  <pre className="llm-input-pre" style={{ maxHeight: 80, overflow: "auto" }}>
                    {codePreview}
                  </pre>
                )}
                {ex.args !== undefined && (
                  <div className="llm-input-attr-row">
                    <span className="llm-input-attr-key">args</span>
                    <span className="llm-input-attr-value">
                      <code className="small">{previewArgs(ex.args)}</code>
                    </span>
                  </div>
                )}
                <pre className="llm-input-pre" style={{ maxHeight: 200, overflow: "auto" }}>
                  {ex.output || "(no output)"}
                </pre>
              </li>
            );
          })}
          {overflow > 0 && (
            <li className="muted small" style={{ padding: 14 }}>
              ...still {overflow} more older
            </li>
          )}
        </ul>
      )}
    </>
  );
}

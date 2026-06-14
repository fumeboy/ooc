/**
 * 进程 window 详情面板 —— terminal_process / interpreter_process 共用。
 * 渲染 exec history（最后一条展开 code + output，其余折叠）。
 */
import type { ProcessExecRecord } from "@ooc/builtins/_shared/executable/process-record";
import React from "react";
import CodeMirror from "@uiw/react-codemirror";
import { previewText } from "@ooc/builtins/_shared/visible/utils";

interface ProcessWindowLike {
  history: ProcessExecRecord[];
}

/** 进程 window 详情面板（history 列表，末条展开 script + output）。 */
export function ProcessWindowDetail({ window }: { window: ProcessWindowLike }) {
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">execs</span>
          <span className="llm-input-attr-value">{window.history.length}</span>
        </div>
      </div>
      {window.history.length > 0 && (
        <ul className="llm-input-exec-list">
          {window.history.map((exec, idx) => {
            const isLast = idx === window.history.length - 1;
            const head = `${exec.language}: ${(exec.code ?? "").split("\n")[0] ?? ""}`;
            return (
              <li key={exec.execId} className={`llm-input-exec-item llm-input-exec-${exec.ok ? "ok" : "fail"}`}>
                <div className="llm-input-exec-head">
                  <span className="llm-input-exec-index">[#{idx}]</span>
                  <span className="llm-input-exec-lang">{exec.language}</span>
                  <span className="llm-input-exec-status">{exec.ok ? "ok" : "fail"}</span>
                  <span className="llm-input-exec-time">{new Date(exec.startedAt).toLocaleTimeString()}</span>
                </div>
                <div className="llm-input-exec-title">{head}</div>
                {isLast && exec.code && (
                  <div className="llm-input-exec-section">
                    <div className="llm-input-exec-section-label">script</div>
                    <CodeMirror
                      className="code-editor is-readonly llm-input-exec-code"
                      value={exec.code}
                      editable={false}
                      basicSetup={{ lineNumbers: true, foldGutter: false }}
                    />
                  </div>
                )}
                {exec.output && (
                  <div className="llm-input-exec-section">
                    <div className="llm-input-exec-section-label">output</div>
                    <pre className="llm-input-pre llm-input-exec-output">{isLast ? exec.output : previewText(exec.output, 200)}</pre>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

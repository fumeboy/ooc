/**
 * terminal_process 详情面板 —— 渲染 bash exec history（末条展开 script + output，其余折叠）。
 */
import type { Data, ProcessExecRecord } from "../types.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class";
import React from "react";
import CodeMirror from "@uiw/react-codemirror";
import { previewText } from "@ooc/builtins/_shared/visible/utils";

/** terminal_process 详情面板（bash exec history 读自实例 `data`）。 */
export default function TerminalProcessWindowDetail({ window }: { window: OocObjectRef & { data: Data } }) {
  const history: ProcessExecRecord[] = window.data.history;
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">execs</span>
          <span className="llm-input-attr-value">{history.length}</span>
        </div>
      </div>
      {history.length > 0 && (
        <ul className="llm-input-exec-list">
          {history.map((exec, idx) => {
            const isLast = idx === history.length - 1;
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

export { TerminalProcessWindowDetail as WindowDetail };

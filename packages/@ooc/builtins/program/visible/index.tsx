import type { ProgramWindow } from "../types.js";
import React from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { formatJson, previewText } from "@ooc/builtins/_shared/visible/utils";

/** Program window 详情面板。 */
export default function ProgramWindowDetail({ window }: { window: ProgramWindow }) {
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
            const head = exec.language === "function"
              ? `fn:${exec.function ?? "?"}`
              : `${exec.language}: ${(exec.code ?? "").split("\n")[0] ?? ""}`;
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
                {isLast && exec.args !== undefined && (
                  <div className="llm-input-exec-section">
                    <div className="llm-input-exec-section-label">args</div>
                    <CodeMirror
                      className="code-editor is-readonly llm-input-exec-code"
                      value={formatJson(exec.args)}
                      editable={false}
                      extensions={[jsonLanguage()]}
                      basicSetup={{ lineNumbers: false, foldGutter: false }}
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

export { ProgramWindowDetail as WindowDetail };

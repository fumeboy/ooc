/**
 * MethodExecWindowDetail — UI for the method_exec form.
 *
 * P6.§10 cleanup (2026-06-02): moved here from `@ooc/builtins/command_exec/visible/index.tsx`.
 * The command_exec package is being deleted because form is an Object built-in feature
 * managed in core, not a stand-alone builtin object.
 */
import type { CommandExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import React from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { parseEditArgs, FileEditDiffView } from "./FileEditDiffView";
import { formatJson, statusToTone } from "@ooc/builtins/_shared/visible/utils";

export default function MethodExecWindowDetail({ window }: { window: CommandExecWindow }) {
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">command</span>
          <span className="llm-input-attr-value">{window.command}</span>
        </div>
        {window.description && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">description</span>
            <span className="llm-input-attr-value">{window.description}</span>
          </div>
        )}
        {window.commandPaths && window.commandPaths.length > 0 && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">paths</span>
            <span className="llm-input-attr-value">{window.commandPaths.join(", ")}</span>
          </div>
        )}
      </div>
      {(() => {
        const args = window.accumulatedArgs ?? {};
        const isEdit = window.command === "edit";
        const isWriteFile = window.command === "write_file";
        if (isEdit) {
          const pairs = parseEditArgs(args);
          if (pairs) {
            return (
              <div className="llm-input-edit-block">
                <div className="llm-input-edit-head">
                  file edit · {pairs.length} change{pairs.length === 1 ? "" : "s"}
                </div>
                <FileEditDiffView pairs={pairs} />
              </div>
            );
          }
        }
        if (isWriteFile && typeof (args as Record<string, unknown>).content === "string") {
          const rec = args as Record<string, unknown>;
          return (
            <>
              <div className="llm-input-attrs">
                {typeof rec.path === "string" && (
                  <div className="llm-input-attr-row">
                    <span className="llm-input-attr-key">path</span>
                    <span className="llm-input-attr-value">{rec.path}</span>
                  </div>
                )}
                <div className="llm-input-attr-row">
                  <span className="llm-input-attr-key">content size</span>
                  <span className="llm-input-attr-value">{(rec.content as string).length} chars</span>
                </div>
              </div>
              <div className="llm-input-edit-block">
                <div className="llm-input-edit-head">write_file content</div>
                <pre className="llm-input-pre">{rec.content as string}</pre>
              </div>
            </>
          );
        }
        if (Object.keys(args).length > 0) {
          return (
            <CodeMirror
              className="code-editor is-readonly"
              value={formatJson(args)}
              editable={false}
              extensions={[jsonLanguage()]}
              basicSetup={{ lineNumbers: false, foldGutter: true }}
            />
          );
        }
        return null;
      })()}
      {window.status === "failed" && window.result && (
        <pre className={`llm-input-pre llm-input-result-${statusToTone(window.status)}`}>{window.result}</pre>
      )}
    </>
  );
}

export { MethodExecWindowDetail as WindowDetail };

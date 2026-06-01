import type { CommandExecWindow } from "../types.js";
import React from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { parseEditArgs, FileEditDiffView } from "@ooc/web/src/domains/files/components/FileEditDiffView";
import { formatJson, statusToTone } from "@ooc/builtins/_shared/visible/utils";

/** Command exec form 详情面板。 */
export default function CommandExecWindowDetail({ window }: { window: CommandExecWindow }) {
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
        // edit:渲染为 unified diff
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
        // write_file:把 content 作为大段文本预览,其它字段平铺
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
        // 兜底:展示 JSON
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
      {/* 仅 failed 状态保留 result 渲染 (success 已自动移除) */}
      {window.status === "failed" && window.result && (
        <pre className={`llm-input-pre llm-input-result-${statusToTone(window.status)}`}>{window.result}</pre>
      )}
    </>
  );
}

export { CommandExecWindowDetail as WindowDetail };

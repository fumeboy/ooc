/**
 * MethodExecWindowDetail — UI for the method_exec form.
 *
 * P6.§10 cleanup (2026-06-02): moved here from `@ooc/builtins/command_exec/visible/index.tsx`.
 * The command_exec package is being deleted because form is an Object built-in feature
 * managed in core, not a stand-alone builtin object.
 */
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import React from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { parseEditArgs, FileEditDiffView } from "./FileEditDiffView";
import { formatJson, previewText, statusToTone } from "@ooc/builtins/_shared/visible/utils";

export default function MethodExecWindowDetail({ window }: { window: MethodExecWindow }) {
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">command</span>
          <span className="llm-input-attr-value">{window.method}</span>
        </div>
        {window.description && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">description</span>
            <span className="llm-input-attr-value">{window.description}</span>
          </div>
        )}
        {window.intentPaths && window.intentPaths.length > 0 && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">paths</span>
            <span className="llm-input-attr-value">{window.intentPaths.join(", ")}</span>
          </div>
        )}
      </div>
      {window.schema && window.fill && (
        <div className="llm-input-schema">
          <div className="llm-input-schema-title">Parameters</div>
          <table className="llm-input-schema-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Required</th>
                <th>Status</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(window.schema.args).map(([name, spec]) => {
                const fill = window.fill?.[name];
                const statusClass = fill?.status === "invalid"
                  ? "is-error"
                  : fill?.status === "provided"
                    ? "is-success"
                    : "is-warning";
                return (
                  <tr key={name} className={`llm-input-schema-row ${statusClass}`}>
                    <td className="llm-input-schema-name">
                      <code>{name}</code>
                    </td>
                    <td className="llm-input-schema-type">{spec.type}</td>
                    <td className="llm-input-schema-required">
                      {spec.required ? "yes" : "no"}
                    </td>
                    <td className="llm-input-schema-status">{fill?.status ?? "missing"}</td>
                    <td className="llm-input-schema-value">
                      {fill?.error ? (
                        <span className="llm-input-error">{fill.error}</span>
                      ) : fill?.value !== undefined ? (
                        <code>{previewText(String(fill.value), 60)}</code>
                      ) : spec.description ? (
                        <span className="llm-input-muted">{spec.description}</span>
                      ) : (
                        <span className="llm-input-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(() => {
            const missing = Object.entries(window.schema.args)
              .filter(([name, spec]) => spec.required && window.fill?.[name]?.status !== "provided")
              .map(([name]) => name);
            if (missing.length === 0) return null;
            return (
              <div className="llm-input-next-steps">
                <strong>Next steps:</strong>
                <ol>
                  {missing.map((name, i) => (
                    <li key={name}>
                      Provide <code>{name}</code> parameter (priority {i + 1})
                    </li>
                  ))}
                </ol>
              </div>
            );
          })()}
        </div>
      )}
      {(() => {
        const args = window.accumulatedArgs ?? {};
        const isEdit = window.method === "edit";
        const isWriteFile = window.method === "write_file";
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

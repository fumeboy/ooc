import type { TodoWindow } from "../types.js";
import React from "react";

/** Todo window 详情面板。 */
export default function TodoWindowDetail({ window }: { window: TodoWindow }) {
  return (
    <>
      <pre className="llm-input-pre">{window.content}</pre>
      {window.onMethodPath && window.onMethodPath.length > 0 && (
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">on_command_path</span>
          <span className="llm-input-attr-value">{window.onMethodPath.join(", ")}</span>
        </div>
      )}
    </>
  );
}

export { TodoWindowDetail as WindowDetail };

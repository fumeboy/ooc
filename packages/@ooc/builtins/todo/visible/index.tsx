import type { TodoWindow } from "../types.js";
import React from "react";

/** Todo window 详情面板。 */
export default function TodoWindowDetail({ window }: { window: TodoWindow }) {
  return (
    <>
      <pre className="llm-input-pre">{window.content}</pre>
      {window.activatesOn && window.activatesOn.length > 0 && (
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">activates_on</span>
          <span className="llm-input-attr-value">{window.activatesOn.join(", ")}</span>
        </div>
      )}
    </>
  );
}

export { TodoWindowDetail as WindowDetail };

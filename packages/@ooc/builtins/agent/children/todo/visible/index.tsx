import type { Data } from "../types.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class";
import React from "react";

/** Todo window 详情面板（业务字段读自实例 `data`）。 */
export default function TodoWindowDetail({ window }: { window: OocObjectInstance<Data> }) {
  const data = window.data;
  return (
    <>
      <pre className="llm-input-pre">{data.content}</pre>
      {data.activatesOn && data.activatesOn.length > 0 && (
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">activates_on</span>
          <span className="llm-input-attr-value">{data.activatesOn.join(", ")}</span>
        </div>
      )}
    </>
  );
}

export { TodoWindowDetail as WindowDetail };

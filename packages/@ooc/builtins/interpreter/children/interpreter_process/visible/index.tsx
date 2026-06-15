import type { Data } from "../types.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class";
import { ProcessWindowDetail } from "@ooc/builtins/_shared/visible/process-detail";

/** interpreter_process 详情面板（ts/js exec history 读自实例 `data`）。 */
export default function InterpreterProcessWindowDetail({ window }: { window: OocObjectInstance<Data> }) {
  return <ProcessWindowDetail window={window.data} />;
}

export { InterpreterProcessWindowDetail as WindowDetail };

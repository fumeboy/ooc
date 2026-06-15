import type { Data } from "../types.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class";
import { ProcessWindowDetail } from "@ooc/builtins/_shared/visible/process-detail";

/** terminal_process 详情面板（bash exec history 读自实例 `data`）。 */
export default function TerminalProcessWindowDetail({ window }: { window: OocObjectInstance<Data> }) {
  return <ProcessWindowDetail window={window.data} />;
}

export { TerminalProcessWindowDetail as WindowDetail };

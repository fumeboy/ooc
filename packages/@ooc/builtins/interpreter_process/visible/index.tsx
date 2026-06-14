import type { InterpreterProcessWindow } from "../types.js";
import { ProcessWindowDetail } from "@ooc/builtins/_shared/visible/process-detail";

/** interpreter_process 详情面板（ts/js exec history）。 */
export default function InterpreterProcessWindowDetail({ window }: { window: InterpreterProcessWindow }) {
  return <ProcessWindowDetail window={window} />;
}

export { InterpreterProcessWindowDetail as WindowDetail };

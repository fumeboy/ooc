import type { TerminalProcessWindow } from "../types.js";
import { ProcessWindowDetail } from "@ooc/builtins/_shared/visible/process-detail";

/** terminal_process 详情面板（bash exec history）。 */
export default function TerminalProcessWindowDetail({ window }: { window: TerminalProcessWindow }) {
  return <ProcessWindowDetail window={window} />;
}

export { TerminalProcessWindowDetail as WindowDetail };

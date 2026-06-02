import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

export interface SupervisorWindow extends BaseContextWindow {
  type: "supervisor";
  status: "active";
}

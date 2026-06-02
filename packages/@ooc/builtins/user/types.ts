import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

export interface UserWindow extends BaseContextWindow {
  type: "user";
  status: "active";
}

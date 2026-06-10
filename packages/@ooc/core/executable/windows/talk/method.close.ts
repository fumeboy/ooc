import type { ObjectMethod } from "../_shared/method-types.js";

export const closeMethod: ObjectMethod = {
  description: "Close this talk_window (creator talk_window cannot be closed).",
  // close side effects handled by onClose hook; exec is no-op
  exec: () => undefined,
};

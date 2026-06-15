import type { Data } from "../types.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class";
import React from "react";

export default function RootWindowDetail({ window: _window }: { window: OocObjectInstance<Data> }) {
  return null;
}

export { RootWindowDetail as WindowDetail };

/**
 * root.example method — 委托到 example_window constructor。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";

import "@ooc/builtins/example";

export const exampleMethod: ObjectMethod = {
  description: "Create an example window (authoring reference).",
  intents: ["example"],
  exec: makeRootDelegator({
    method: "example",
    constructorKind: "example",
    objectLabel: "example_window",
  }),
};

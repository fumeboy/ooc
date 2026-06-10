/**
 * root.open_knowledge method — 委托到 knowledge_window constructor。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";

import "@ooc/builtins/knowledge";

const OPEN_KNOWLEDGE_TIP = `open_knowledge 显式打开一个 knowledge doc，作为 knowledge_window 持续可见（等价于 pinnedKnowledge）。
参数：path（必填，knowledge 索引中的路径，不带 .md）。`;

export const openKnowledgeMethod: ObjectMethod = {
  description: "Pin a knowledge doc by path so it stays visible in context.",
  intents: ["open_knowledge"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "knowledge 索引中的路径（不带 .md）" },
    },
  },
  onFormChange(change, { form }) {
    const args = (form as MethodExecWindow).accumulatedArgs;
    const hasPath = typeof args.path === "string" && args.path.length > 0;
    return {
      tip: hasPath ? `Opening knowledge ${args.path}...` : OPEN_KNOWLEDGE_TIP,
      intents: [{ name: "open_knowledge" }],
      quick_exec_submit: hasPath,
    };
  },
  exec: (ctx) => executeOpenKnowledgeMethod(ctx),
};

export const executeOpenKnowledgeMethod = makeRootDelegator({
  method: "open_knowledge",
  constructorKind: "knowledge",
  objectLabel: "knowledge_window",
});

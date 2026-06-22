/**
 * method_exec_form —— readable 维度（投影成 `method_exec` context window）。
 *
 * 把 form Data 投影成 method_exec 窗，渲染 method / description / accumulated_args / tip /
 * intent paths / schema / fill_state / next_steps，并经 window 声明暴露 refine / submit 方法菜单。
 */

import type { ReadableContext, ReadableModule } from "@ooc/core/readable/contract.js";
import type { ReadonlySelfProxy } from "@ooc/core/_shared/types/self-proxy.js";
import {
  xmlElement,
  xmlText,
  renderPathList,
  appendNode,
  type XmlNode,
} from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** method_exec 无 viewport 投影态。 */
export type MethodExecWin = Record<string, never>;

const readable: ReadableModule<Data, MethodExecWin> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>) => {
    const children: XmlNode[] = [
      xmlElement("method", {}, [xmlText(self.data.method)]),
      xmlElement("description", {}, [xmlText(self.data.description)]),
      xmlElement("accumulated_args", {}, [xmlText(JSON.stringify(self.data.accumulatedArgs))]),
    ];
    if (self.data.tip) children.push(xmlElement("tip", {}, [xmlText(self.data.tip)]));
    appendNode(children, renderPathList("intent_paths", self.data.intentPaths));
    // 仅 failed 留 result（success 已移除窗；open/executing 无 result）。
    if (self.data.status === "failed" && self.data.result) {
      children.push(xmlElement("result", {}, [xmlText(self.data.result)]));
    }

    // ── schema / fill_state / next_steps 结构化渲染 ──
    if (self.data.schema) {
      children.push({
        kind: "element",
        tag: "schema",
        children: Object.entries(self.data.schema.args).map(([name, spec]) => ({
          kind: "element" as const,
          tag: "arg",
          attrs: { name, type: spec.type, required: spec.required ? "true" : "false" },
          children: spec.description ? [{ kind: "text" as const, value: spec.description }] : undefined,
        })),
      });
      if (self.data.fill) {
        children.push({
          kind: "element",
          tag: "fill_state",
          children: Object.entries(self.data.fill).map(([name, state]) => ({
            kind: "element" as const,
            tag: "arg",
            attrs: { name, status: state.status },
            children:
              state.status === "invalid"
                ? [{ kind: "text" as const, value: `错误：${state.error}` }]
                : state.value !== undefined
                  ? [{ kind: "text" as const, value: String(state.value) }]
                  : undefined,
          })),
        });
      }
      // 还缺哪些必填参数 → next_steps，引导继续 refine。
      const nextSteps = Object.entries(self.data.schema.args)
        .filter(([name, spec]) => {
          if (!spec.required) return false;
          const fs = self.data.fill?.[name];
          return !fs || fs.status !== "provided";
        })
        .map(([name]) => name);
      if (nextSteps.length > 0) {
        children.push({
          kind: "element",
          tag: "next_steps",
          children: nextSteps.map((name, i) => ({
            kind: "element" as const,
            tag: "step",
            attrs: { priority: String(i + 1) },
            children: [{ kind: "text" as const, value: `refine 提供 ${name} 参数` }],
          })),
        });
      }
    }

    return { class: "method_exec", content: children };
  },
  window: [
    {
      class: "method_exec",
      object_methods: ["refine", "submit"],
      window_methods: [],
    },
  ],
};

export default readable;

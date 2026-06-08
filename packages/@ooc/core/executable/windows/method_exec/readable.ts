/**
 * method_exec window 的 readable hook：accumulated_args / paths / result。
 *
 * P6.§9（2026-06-02）：源文件从 `packages/@ooc/builtins/command_exec/readable.ts`
 * 迁移到 `packages/@ooc/core/executable/windows/method_exec/readable.ts`。
 */

import { type RenderContext } from "../_shared/registry.js";
import { xmlElement, xmlText, renderPathList, appendNode, type XmlNode } from "../../../thinkable/context/xml.js";
import type { MethodExecWindow } from "../_shared/types.js";

export function readable(ctx: RenderContext): XmlNode[] {
  const form = ctx.window as MethodExecWindow;
  const children: XmlNode[] = [
    xmlElement("method", {}, [xmlText(form.method)]),
    xmlElement("description", {}, [xmlText(form.description)]),
    xmlElement("accumulated_args", {}, [xmlText(JSON.stringify(form.accumulatedArgs))]),
  ];
  appendNode(children, renderPathList("method_paths", form.methodPaths));
  appendNode(children, renderPathList("loaded_knowledge", form.loadedKnowledgePaths));
  appendNode(children, renderPathList("method_knowledge_paths", form.methodKnowledgePaths));
  // Round 13: 仅 failed 状态保留 result 渲染 (success 已自动移除; open/executing 无 result)
  if (form.status === "failed" && form.result) {
    children.push(xmlElement("result", {}, [xmlText(form.result)]));
  }

  // ── P4: structured schema / fill_state / next_steps rendering ──
  if (form.schema) {
    // <schema>
    children.push({
      kind: "element",
      tag: "schema",
      children: Object.entries(form.schema.args).map(([name, spec]) => ({
        kind: "element" as const,
        tag: "arg",
        attrs: {
          name,
          type: spec.type,
          required: spec.required ? "true" : "false",
        },
        children: spec.description ? [{ kind: "text" as const, value: spec.description }] : undefined,
      })),
    });
    // <fill_state>
    if (form.fill) {
      children.push({
        kind: "element",
        tag: "fill_state",
        children: Object.entries(form.fill).map(([name, state]) => ({
          kind: "element" as const,
          tag: "arg",
          attrs: { name, status: state.status },
          children: state.status === "invalid"
            ? [{ kind: "text" as const, value: `错误：${state.error}` }]
            : state.value !== undefined
              ? [{ kind: "text" as const, value: String(state.value) }]
              : undefined,
        })),
      });
    }
    // <next_steps> — derived from schema.required + fill_state
    const nextSteps = Object.entries(form.schema.args)
      .filter(([name, spec]) => {
        if (!spec.required) return false;
        const fs = form.fill?.[name];
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
          children: [{ kind: "text" as const, value: `提供 ${name} 参数` }],
        })),
      });
    }
  }
  // ── End P4 structured rendering ──

  return children;
}

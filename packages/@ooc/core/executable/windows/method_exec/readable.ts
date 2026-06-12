/**
 * method_exec window 的 readable hook：accumulated_args / paths / result。
 */

import { type RenderContext } from "../_shared/registry.js";
import { xmlElement, xmlText, renderPathList, appendNode, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { MethodExecWindow } from "../_shared/types.js";

export function readable(ctx: RenderContext): XmlNode[] {
  const form = ctx.window as MethodExecWindow;
  const children: XmlNode[] = [
    xmlElement("method", {}, [xmlText(form.method)]),
    xmlElement("description", {}, [xmlText(form.description)]),
    xmlElement("accumulated_args", {}, [xmlText(JSON.stringify(form.accumulatedArgs))]),
  ];
  appendNode(children, renderPathList("method_paths", form.intentPaths));
  appendNode(children, renderPathList("loaded_knowledge", form.loadedKnowledgePaths));
  appendNode(children, renderPathList("method_knowledge_paths", form.methodKnowledgePaths));
  // 仅 failed 状态保留 result 渲染 (success 已自动移除; open/executing 无 result)
  if (form.status === "failed" && form.result) {
    children.push(xmlElement("result", {}, [xmlText(form.result)]));
  }

  // ── structured schema / fill_state / next_steps rendering ──
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
    // <unknown_args> — 响亮回显 LLM 传了但不在 schema.args 里的 key（如把 say 的 msg 传成 content）。
    // 不静默映射、不静默忽略：列出被忽略的 key + 本 method 接受的参数（必填标注），治 false confidence 的残余猜测面。
    const known = new Set(Object.keys(form.schema.args));
    const unknownArgs = Object.keys(form.accumulatedArgs).filter((k) => !known.has(k));
    if (unknownArgs.length > 0) {
      const accepted = Object.entries(form.schema.args)
        .map(([name, spec]) => (spec.required ? `${name}(必填)` : name))
        .join(", ");
      children.push({
        kind: "element",
        tag: "unknown_args",
        attrs: { ignored: unknownArgs.join(",") },
        children: [{
          kind: "text" as const,
          value: `未知参数 ${unknownArgs.map((k) => `\`${k}\``).join("、")} 已忽略（未做静默映射）。本 method 接受：${accepted}。请用正确的参数名重新 refine。`,
        }],
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
  // ── End structured rendering ──

  return children;
}

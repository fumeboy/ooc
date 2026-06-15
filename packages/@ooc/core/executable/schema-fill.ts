/**
 * Schema fill_state 构造 + 参数校验 —— 从 WindowManager 抽出的纯逻辑（无实例状态）。
 *
 * `buildFillState`：给 method_exec form 按 schema 计算每个 arg 的 fill 状态
 * （provided / missing / invalid）。Fail-soft：校验错误标记在 fill 里但不阻塞 refine。
 */
import type { MethodCallSchema, MethodArgSpec } from "@ooc/core/_shared/types/intent.js";
import type { Data as MethodExecFormData } from "@ooc/builtins/agent/method_exec_form";

export function buildFillState(
  schema: MethodCallSchema | undefined,
  args: Record<string, unknown>,
  existingFill?: MethodExecFormData["fill"],
): MethodExecFormData["fill"] | undefined {
  if (!schema) return undefined;
  const fill: NonNullable<MethodExecFormData["fill"]> = {};
  for (const [argName, spec] of Object.entries(schema.args)) {
    const hasValue = argName in args && args[argName] !== undefined && args[argName] !== null && args[argName] !== "";
    const prev = existingFill?.[argName];
    if (!hasValue) {
      // Missing — but check default
      if (spec.default !== undefined) {
        fill[argName] = {
          status: "provided",
          value: spec.default,
          source: "default",
          refinedAt: prev?.refinedAt ?? Date.now(),
        };
      } else {
        fill[argName] = {
          status: "missing",
          source: prev?.source ?? "initial",
          refinedAt: prev?.refinedAt,
        };
      }
      continue;
    }
    // Has value — validate
    const value = args[argName];
    const error = validateArgValue(spec, value);
    if (error) {
      fill[argName] = {
        status: "invalid",
        value,
        error,
        source: prev?.source === "initial" ? "refine" : prev?.source ?? "refine",
        refinedAt: Date.now(),
      };
    } else {
      fill[argName] = {
        status: "provided",
        value,
        source: prev?.source === "initial" ? "refine" : prev?.source ?? "refine",
        refinedAt: prev?.refinedAt ?? Date.now(),
      };
    }
  }
  return fill;
}

function validateArgValue(spec: MethodArgSpec, value: unknown): string | undefined {
  if (spec.enum && !spec.enum.includes(value as any)) {
    return spec.validation?.customMessage ?? `值必须是: ${spec.enum.join(", ")}`;
  }
  if (spec.type === "string" && typeof value !== "string") {
    return spec.validation?.customMessage ?? "需要字符串类型";
  }
  if (spec.type === "number" && typeof value !== "number") {
    return spec.validation?.customMessage ?? "需要数字类型";
  }
  if (spec.type === "boolean" && typeof value !== "boolean") {
    return spec.validation?.customMessage ?? "需要布尔类型";
  }
  if (spec.type === "array" && !Array.isArray(value)) {
    return spec.validation?.customMessage ?? "需要数组类型";
  }
  if (spec.type === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
    return spec.validation?.customMessage ?? "需要对象类型";
  }
  const v = spec.validation;
  if (v && typeof value === "string") {
    if (v.minLength !== undefined && value.length < v.minLength) {
      return v.customMessage ?? `至少 ${v.minLength} 个字符`;
    }
    if (v.maxLength !== undefined && value.length > v.maxLength) {
      return v.customMessage ?? `最多 ${v.maxLength} 个字符`;
    }
    if (v.pattern) {
      try {
        if (!new RegExp(v.pattern).test(value)) {
          return v.customMessage ?? `格式不匹配: ${v.pattern}`;
        }
      } catch {
        // Invalid regex — skip
      }
    }
  }
  if (v && typeof value === "number") {
    if (v.minimum !== undefined && value < v.minimum) {
      return v.customMessage ?? `不能小于 ${v.minimum}`;
    }
    if (v.maximum !== undefined && value > v.maximum) {
      return v.customMessage ?? `不能大于 ${v.maximum}`;
    }
  }
  return undefined;
}

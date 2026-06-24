/**
 * method call 参数 schema —— 零依赖纯类型。
 *
 * 供 method_exec form 的结构化 fill_state 渲染 + fail-soft refine 校验。
 * （旧 onFormChange 机制的 Intent / FormChangeEvent / IntentCache* / hashArgs / diffArgs
 * 已随填表机制重构退役。）
 */

/**
 * Parameter schema for a method call. Optional; enables structured fill_state rendering
 * and fail-soft refine validation. All fields are optional.
 */
export type MethodCallSchema = Record<string, MethodArgSpec>

export interface MethodArgSpec {
  type: "string" | "number" | "boolean" | "array" | "object" | "any";
  required?: boolean;
  default?: unknown;
  description?: string;
  enum?: Array<string | number | boolean>;
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minimum?: number;
    maximum?: number;
    customMessage?: string;
  };
}

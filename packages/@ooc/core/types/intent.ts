/**
 * method call 参数 schema —— 零依赖纯类型。
 *
 * 供 method_exec form 的结构化 fill_state 渲染 + fail-soft refine 校验。
 */

/**
 * Method call 参数 schema —— 直接 map 参数名到规格（flat 形式，不要 `args` wrapper）。
 *
 *   schema: {
 *     msg: { type: "string", required: true, description: "..." },
 *     count: { type: "number" },
 *   }
 */
export type MethodCallSchema = Record<string, MethodArgSpec>;

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

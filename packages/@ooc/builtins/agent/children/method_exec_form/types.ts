/**
 * method_exec_form —— 调用某 method 时的临时 form 的 **object data** 结构（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗信封字段（id/class/parentObjectId/title/createdAt/信封 status）——那些由 runtime 管理。
 *
 * 字段（与旧 ActiveForm 一一对应）：
 * - 由 `exec` tool 在 args 不齐全 / 引入新 path/knowledge 时创建
 * - 自身注册了两条命令 `refine` / `submit`，LLM 通过
 *   `exec(<form_id>, "refine", args={...})` 累加参数；`exec(<form_id>, "submit")` 触发执行
 * - status 是 form 业务生命周期态（非窗信封 status）：open → executing → success | failed
 *   - success：自动从 context 移除（submit 段）
 *   - failed：保留 result，且可通过 refine 回 open（"复活"路径）
 *
 * 注：form 机制 Wave4 已废，本类型仅为类型归位 + 注册占位 class 而保留。
 */
export interface Data {
  method: string;
  description: string;
  accumulatedArgs: Record<string, unknown>;
  intentPaths: string[];
  loadedKnowledgePaths: string[];
  methodKnowledgePaths?: string[];
  /** form 业务生命周期态（非窗信封 status）。 */
  status: "open" | "executing" | "success" | "failed";
  result?: string;
  /** Optional schema (from ObjectMethod.schema). Undefined if the method doesn't declare one. */
  schema?: import("@ooc/core/_shared/types/intent.js").MethodCallSchema;
  /**
   * Structured fill state derived from accumulatedArgs + schema.
   * Undefined if schema is not declared.
   */
  fill?: Record<string, {
    status: "missing" | "provided" | "invalid";
    value?: unknown;
    error?: string;
    source: "initial" | "refine" | "default";
    refinedAt?: number;
  }>;
}

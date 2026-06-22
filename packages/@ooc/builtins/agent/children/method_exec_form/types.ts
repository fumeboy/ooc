/**
 * method_exec_form —— 调用某 method 时的临时 form 的 **object data** 结构（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗的元信息字段（id/class/parentWindowId/title/createdAt/元信息 status）——那些由 runtime 管理。
 *
 * 字段：
 * - 由 `exec` tool 在目标 method 声明了 `route` 且 route 未返回 quickSubmit 时创建
 * - 自身注册了两条命令 `refine` / `submit`，LLM 通过
 *   `exec(<form_id>, "refine", args={...})` 累加参数；`exec(<form_id>, "submit")` 触发执行
 * - status 是 form 业务生命周期态（非窗的元信息 status）：open → executing → success | failed
 *   - success：自动从 context 移除（submit 段）
 *   - failed：保留 result，且可通过 refine 回 open（"复活"路径）
 */
export interface Data {
  /**
   * 本 form 代理的目标对象 id —— submit 时 `runtime.callMethod(targetObjectId, method, accumulatedArgs)`
   * 回调它真正执行。route 只在 exec 工具边界消费，callMethod 走 runtime 不再触发 route（不递归）。
   */
  targetObjectId: string;
  method: string;
  description: string;
  accumulatedArgs: Record<string, unknown>;
  /** route 返回的提示语；填表未齐时回显给 LLM。 */
  tip?: string;
  intentPaths: string[];
  loadedKnowledgePaths: string[];
  methodKnowledgePaths?: string[];
  /** form 业务生命周期态（非窗的元信息 status）。 */
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

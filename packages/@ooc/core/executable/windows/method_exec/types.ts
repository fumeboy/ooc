import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * MethodExec form — 调用某 method 时的临时 sub-window。
 *
 * 字段（与 ActiveForm 一一对应；plan §exec 升级后）：
 * - 由 `exec` tool 在 args 不齐全 / 引入新 path/knowledge 时创建
 * - 自身注册了两条命令 `refine` / `submit`，LLM 通过
 *   `exec(<form_id>, "refine", args={...})` 累加参数；
 *   `exec(<form_id>, "submit")` 触发执行
 * - 状态过渡：open → executing → success | failed
 *   - success：自动从 contextWindows 移除（spec § submit 段）
 *   - failed：保留 result，且可通过 refine 回 open（"复活"路径，Round 13 新增）
 * - parentWindowId 是该 method 注册到的 window 的 id（root 命令时 = "root"；
 *   do_window 上的 continue 时 = 该 do_window 的 id）。
 */
export interface MethodExecWindow extends BaseContextWindow {
  type: "method_exec";
  parentWindowId: string;
  method: string;
  description: string;
  accumulatedArgs: Record<string, unknown>;
  intentPaths: string[];
  loadedKnowledgePaths: string[];
  methodKnowledgePaths?: string[];
  status: "open" | "executing" | "success" | "failed";
  result?: string;
  /** Optional schema (from ObjectMethod.schema). Undefined if the method doesn't declare one. */
  schema?: import("@ooc/core/_shared/types/intent.js").MethodCallSchema;
  /**
   * Structured fill state derived from accumulatedArgs + schema.
   * Undefined if schema is not declared.
   * Populated by WindowManager.openMethodExec / refine / submit.
   */
  fill?: Record<string, {
    status: "missing" | "provided" | "invalid";
    value?: unknown;
    error?: string;
    source: "initial" | "refine" | "default";
    refinedAt?: number;
  }>;
}


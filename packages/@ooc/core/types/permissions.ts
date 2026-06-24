/** 单档准入级别。 */
export type PermissionLevel = "allow" | "ask" | "deny";

/** decidePermission 的结构化返回。 */
export type PermissionDecision =
  | { decision: "allow" }
  | { decision: "ask" }
  | { decision: "deny"; reason: string };

/**
 * thinkloop 在分派 tool call 前组装的待审计载荷。
 *
 * - exec: method = args.method (实际 OOC method 名); windowId = args.window_id (目标 window);
 *   args = args.args (method 的业务参数)。compress/resize 是 class 自实现的 window method，经此路 exec 派发。
 * - close / wait: method = toolName 自身; windowId / args 视情况填
 */
export type PendingToolCall = {
  /** 触发的 LLM tool 原语名。 */
  toolName: "exec" | "close" | "wait";
  /**
   * 对 exec: 解析自 args.method 的 method 路径 (例如 "talk", "write_file")。
   * 对 close/wait: 等于 toolName。
   */
  method?: string;
  /** 调用的原始 args (透传给 decider, 便于 escape hatch 做精细判断)。 */
  args?: unknown;
  /** 对 exec: 目标 window id (例如 "root" 或 form_id); 其他 tool 视情况填。 */
  windowId?: string;
};

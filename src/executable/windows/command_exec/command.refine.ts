import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";

/**
 * command_exec.refine method — 把 ctx.args 整体 merge 到 form.accumulatedArgs。
 *
 * 调用形态：exec(<form_id>, "refine", args={ msg: "..." })
 *
 * exec ctx 中：
 * - parentWindow = 该 form 自身（type=command_exec）
 * - ctx.args = 要累积/覆盖到 form 上的键值对
 * - manager 用来调内部 refine 方法重算 commandPaths
 *
 * 这条命令本身不引入新 path/knowledge，所以走 exec tool 的 auto-execute 路径，
 * 不会再创建嵌套 form。
 */
async function executeRefine(ctx: MethodExecutionContext): Promise<string | undefined> {
  const form = ctx.parentWindow;
  if (!form || form.type !== "command_exec") {
    return "[command_exec.refine] 必须挂在 command_exec form 上调用。";
  }
  // Round 13: 允许 open 或 failed (failed 上 refine 触发"复活"路径, 自动切回 open)
  if (form.status !== "open" && form.status !== "failed") {
    return `[command_exec.refine] form ${form.id} 不在 open / failed 状态（当前 ${form.status}）, 无法 refine。`;
  }
  const incoming = ctx.args;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return "[command_exec.refine] 缺少 args 对象（业务参数键值对）。";
  }
  if (Object.keys(incoming).length === 0) {
    return "[command_exec.refine] 收到空 args（{}）。要么填上至少一个键值对，要么直接 exec(form_id, \"submit\")。";
  }
  if (!ctx.manager) {
    return "[command_exec.refine] 缺少 manager 上下文。";
  }
  const ok = ctx.manager.refine(form.id, incoming);
  if (!ok) {
    return `[command_exec.refine] refine 失败：form ${form.id} 不存在或不在 open / failed 状态。`;
  }
  const updated = ctx.manager.get(form.id);
  const paths = updated && updated.type === "command_exec" ? updated.commandPaths.join(", ") : "";
  // Round 13: 如果是从 failed 复活, 标注一下让 LLM 知道 form 已切回 open。
  const revived = form.status === "failed" ? "（form 从 failed 复活, 已切回 open, 可 submit）" : "";
  return `Form ${form.id} 已累积参数${revived}。当前路径：${paths}。`;
}

export const refineCommand: MethodEntry = {
  paths: ["refine"],
  match: () => ["refine"],
  knowledge: (_args, _formStatus): MethodKnowledgeEntries => ({
    "internal/windows/command_exec/refine/basic": [
      "command_exec.refine 用于向 form 累积参数；ctx.args 整体作为要累积的键值对。",
      "调用：exec(window_id=<form_id>, method=\"refine\", args={ <要累积的键值对> })",
      "多次调用会叠加；填齐参数后用 exec(form_id, \"submit\") 触发执行。",
      "Round 13: refine 也接受 status=failed 的 form (submit 失败后); 调 refine 会自动把 form 切回 open + 清旧 result, 可重 submit。这是首选的失败修复路径 (保留 form 上下文)。",
    ].join("\n"),
  }),
  exec: (ctx) => executeRefine(ctx),
};

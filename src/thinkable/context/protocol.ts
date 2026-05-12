import type { ActiveForm } from "../../executable/forms/form";

/** 根据 form 生命周期推断 LLM 下一步最可能的合法动作。 */
export function inferNextAction(form: ActiveForm): string {
  if (form.status === "executing") {
    return "wait_for_result";
  }
  if (form.status === "executed") {
    return "inspect_result_then_close_or_open_next_form";
  }
  return "refine_or_submit_or_close";
}

/** 给 program form 提供更强的协议提示，降低参数塞错位置的概率。 */
function inferProgramProtocolHint(form: ActiveForm): string {
  const args = form.accumulatedArgs;
  const fn = args.function;
  const lang = typeof args.language === "string"
    ? args.language
    : typeof args.lang === "string"
      ? args.lang
      : undefined;
  const code = typeof args.code === "string" ? args.code.trim() : "";
  const fnArgs = args.args;

  if (typeof fn === "string" && fn.length > 0) {
    if (fnArgs && typeof fnArgs === "object" && !Array.isArray(fnArgs)) {
      return "program.function 参数已具备；确认无误后可直接 submit(form_id)。";
    }
    return "program.function 缺少 args 对象；先用 refine(args={ function: \"name\", args: {...} })，再 submit(form_id)。";
  }

  if (lang && code) {
    return "program shell/ts/js 参数已具备；可直接 submit(form_id)。";
  }

  return "program form 缺少可执行参数；若要执行 shell/ts/js，请先用 refine(args={ language: \"shell\" | \"ts\" | \"js\", code: \"...\" })；若要调 server 方法，请先用 refine(args={ function: \"name\", args: {...} })。";
}

/** 按 command + status 推导 form 的协议提示。 */
export function inferProtocolHint(form: ActiveForm): string {
  if (form.status === "executing") {
    return "该 form 正在执行；等待 result 写入后再继续，不要再次 refine 或 submit。";
  }
  if (form.status === "executed") {
    return "先阅读 result；如果结果已经消费，使用 close(form_id, reason=...) 释放 form。";
  }
  if (form.command === "program") {
    return inferProgramProtocolHint(form);
  }
  return "open 只负责创建 form；业务参数请放在 refine(args={...}) 或 open(..., args={...})；参数齐全后再 submit(form_id)。";
}

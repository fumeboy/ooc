import type { FormManager } from "../../executable/forms/form.js";
import type { ThreadsTree } from "../thread-tree/tree.js";

export function resolveToolFormId(formManager: FormManager, args: Record<string, unknown>): string {
  let formId = typeof args.form_id === "string" ? args.form_id : "";
  if (!formId) {
    const activeForms = formManager.activeForms();
    if (activeForms.length === 1) {
      formId = activeForms[0]!.formId;
      args.form_id = formId;
    }
  }
  return formId;
}

function countRecentInjects(tree: ThreadsTree, threadId: string, needle: string, limit = 12): number {
  const td = tree.readThreadData(threadId);
  if (!td) return 0;
  let count = 0;
  for (let i = td.events.length - 1; i >= 0 && i >= td.events.length - limit; i--) {
    const event = td.events[i];
    if (event?.type === "inject" && event.content.includes(needle)) count++;
  }
  return count;
}

export function buildInvalidOpenMessage(tree: ThreadsTree, threadId: string): string {
  const base = `open 参数不完整：必须指定 title 和 type；type="command" 时还必须指定 command，type="file" 时必须指定 path，type="trait"/"skill" 时必须指定 name。`;
  if (countRecentInjects(tree, threadId, "open 参数不完整") >= 1) {
    return `[错误] ${base}\n[连续协议错误] 你刚刚已经收到过 open 参数错误。下一步不要再次调用 open({})；请根据目标补齐必要字段，或用 wait({reason:"..."}) 报告卡住原因。`;
  }
  return `[错误] ${base}`;
}

/**
 * root.do_close method —— 归档一个子线程对话（OOC-4 L6b）。
 *
 * agent 不再经 do_window 上的 close 交互；改 root.do_close(target=<子线程 id>) 一步合一：
 * 按 target 找到指向该子线程的 do_window，走 archiveDoWindowChild 归档（子线程切 paused、
 * 借出的 owner window 自动归还）。do_close 后该子线程不再出现在 <self_view><active_children>。
 *
 * 找不到对应 do_window（或 target 是 creator 回报口，不可关闭）→ 返回 explicit 提示串（不静默）。
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";
import type { DoWindow } from "../_shared/types.js";
import { archiveDoWindowChild } from "../do/helpers.js";

const DO_CLOSE_BASIC_PATH = "internal/executable/do_close/basic";
const DO_CLOSE_INPUT_PATH = "internal/executable/do_close/input";

const KNOWLEDGE = `
do_close 归档一个你派生的子线程对话。子线程被标记 paused、不再被调度，且不再出现在
<self_view><active_children> 切片里；之前借给它的 window 会自动归还。

参数：
- target: 必填，要归档的子线程 id（在 <self_view><active_children><child thread_id=...> 里能看到）。

行为：
  exec(method="do_close", title="归档子线程", args={ target: "<子线程 id>" })

提示：do_close 只能归档你派生的子线程；你的 parent 线程（<parent_task> 里的回报口）不能被 do_close 关闭。
`.trim();

/** root.do_close method：按子线程 id 归档对应 do 对话。 */
export const doCloseCommand: MethodEntry = {
  paths: ["do_close"],
  match: () => ["do_close"],
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = { [DO_CLOSE_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const target = typeof args.target === "string" ? args.target.trim() : "";
    if (!target) {
      entries[DO_CLOSE_INPUT_PATH] =
        "do_close 还缺 target（子线程 id）。\n" +
        "请用 refine(form_id, args={ target: \"<子线程 id>\" }) 补齐后 submit(form_id)。";
    }
    return entries;
  },
  exec: (ctx) => executeDoCloseCommand(ctx),
};

export async function executeDoCloseCommand(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[do_close] 缺少 thread context。";
  const target = typeof ctx.args.target === "string" ? ctx.args.target.trim() : "";
  if (!target) return "[do_close] 缺少 target 参数（子线程 id）。";

  const doWindow = (thread.contextWindows ?? []).find(
    (w): w is DoWindow =>
      w.type === "do" && !w.isCreatorWindow && w.targetThreadId === target,
  );
  if (!doWindow) {
    return (
      `[do_close] 找不到指向子线程 ${target} 的子线程对话。` +
      "请确认 target 是你派生的子线程 id（见 <self_view><active_children>）；parent 回报口不能被 do_close。"
    );
  }

  archiveDoWindowChild(thread, doWindow);
  // 同步把 do_window 标记 archived（内部数据一致；归档后不再作为 wait 候选 / active child）。
  const list = thread.contextWindows;
  const idx = list.findIndex((w) => w.id === doWindow.id);
  if (idx >= 0) {
    list[idx] = { ...doWindow, status: "archived" };
  }
  return `已归档子线程 ${target}（标记 paused，不再被调度）。`;
}

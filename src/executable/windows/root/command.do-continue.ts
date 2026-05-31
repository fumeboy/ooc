/**
 * root.do_continue method —— 向一个子线程追加消息 / 向 parent 线程回报（OOC-4 L6b）。
 *
 * agent 不再经 do_window 上的 continue 交互；改 root.do_continue(target=<threadId>, content, wait?)
 * 一步合一：按 target 线程 id 直接派送。共享核心 deliverDoMessage（与 do_window.continue 同源）。
 *
 * 两个方向都合法（findThreadInScope 自动判别向下 / 向上）：
 * - 父→子追加：target = 你 do 出来的子线程 id（在 <self_view><active_children> 里看得到）。
 * - 子→父回报：target = 你的 parent 线程 id（在 <self_view><parent_task> 里看得到）——这是
 *   你把结果 / 状态回报给 parent 的通道。
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";
import { deliverDoMessage } from "../do/deliver.js";

const DO_CONTINUE_BASIC_PATH = "internal/executable/do_continue/basic";
const DO_CONTINUE_INPUT_PATH = "internal/executable/do_continue/input";

const KNOWLEDGE = `
do_continue 向某个线程追加一条消息——既可以给你派生的子线程追加任务，也可以向你的 parent 线程回报。

参数：
- target: 必填，对端线程 id。
  - 追加给子线程：填子线程 id（在 <self_view><active_children><child thread_id=...> 里能看到）。
  - 回报给 parent：填 parent 线程 id（在 <self_view><parent_task parent_thread_id=...> 里能看到）。
- content: 必填，消息正文。
- wait: 可选，true 时发完进入 status="waiting"，等对端回写消息进 inbox 后唤醒；false / 缺省发完不等。

行为（一步到位，args 给齐时 open 立即提交 form）：
  exec(method="do_continue", title="追加任务", args={ target: "<子线程 id>", content: "再处理一批", wait: true })
  exec(method="do_continue", title="回报结果", args={ target: "<parent 线程 id>", content: "已处理完毕：见 memo/x.md" })

提示：
- 你与各子线程的往返会出现在 <self_view><active_children> 切片；你对 parent 的回报口在 <self_view><parent_task> 切片。
- 向 parent 回报是你把中间进展 / 最终结果交还的唯一显式通道；不要试图通过 end({result}) 等隐式参数夹带复杂状态。
`.trim();

/** root.do_continue method：按 target 线程 id 派送一条 do 消息（可选 wait）。 */
export const doContinueCommand: MethodEntry = {
  paths: ["do_continue", "do_continue.wait"],
  match: (args) => {
    const hit = ["do_continue"];
    if (args.wait === true) hit.push("do_continue.wait");
    return hit;
  },
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = { [DO_CONTINUE_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const missing: string[] = [];
    const target = typeof args.target === "string" ? args.target.trim() : "";
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!target) missing.push("target");
    if (!content) missing.push("content");
    if (missing.length > 0) {
      entries[DO_CONTINUE_INPUT_PATH] =
        `do_continue 还缺以下参数: ${missing.join(", ")}。\n` +
        "请用 refine(form_id, args={ target: \"<线程 id>\", content: \"<消息正文>\", wait: true|false }) 补齐后 submit(form_id)。";
    }
    return entries;
  },
  exec: (ctx) => executeDoContinueCommand(ctx),
};

export async function executeDoContinueCommand(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[do_continue] 缺少 thread context。";
  const target = typeof ctx.args.target === "string" ? ctx.args.target.trim() : "";
  if (!target) return "[do_continue] 缺少 target 参数（对端线程 id）。";
  const content = typeof ctx.args.content === "string" ? ctx.args.content : "";
  if (!content.trim()) return "[do_continue] 缺少 content 参数。";

  return deliverDoMessage(thread, target, content, ctx.args.wait === true);
}

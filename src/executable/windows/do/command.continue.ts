import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";
import { deliverDoMessage } from "./deliver.js";

const DO_WINDOW_CONTINUE_BASIC = "internal/windows/do/continue/basic";
const DO_WINDOW_CONTINUE_INPUT = "internal/windows/do/continue/input";

const CONTINUE_KNOWLEDGE = `
do_window.continue 用于向 do_window 关联的对端线程追加消息。

适用方向（两种都合法）：
- **父→子（主流）**：父 thread 在自己创建的子 do_window 上调，向 child 追加任务/消息
- **子→父 reply（root cause #1 dogfooding 闭环）**：子 thread 在自身的 creator do_window
  （isCreatorWindow=true）上调，把结果 / 状态 / 中间进展回报给父——这是子→父的**唯一**
  合法通道，不要试图通过 \`end({result})\` 等隐式参数夹带

参数：
- msg: 必填，要追加的消息
- wait: 可选，true 时本 thread 进入 waiting，等对端回写消息再唤醒

示例（父向子追加）：
open(parent_window_id="<do_window_id>", method="continue", title="追加任务", args={ msg: "再处理一批", wait: true })

示例（子向父回报）：
open(parent_window_id="<creator_do_window_id>", method="continue", args={ msg: "已处理完毕：见 memo/x.md" })
`.trim();

async function executeDoWindowContinue(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  const window = ctx.parentWindow;
  if (!window || window.type !== "do") {
    return "[do_window.continue] 未挂载在 do_window 上，无法执行。";
  }
  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content) return "[do_window.continue] 缺少 msg。";

  // OOC-4 L6b：核心搬入 deliverDoMessage（共享给 root.do_continue）。do_window.continue 本身
  // 保留作内部数据/end.result 路径（end.ts 仍 import continueCommand）；行为不变。
  return deliverDoMessage(thread, window.targetThreadId, content, ctx.args.wait === true);
}

export const continueCommand: MethodEntry = {
  paths: ["continue", "continue.wait"],
  match: (args) => {
    const hit = ["continue"];
    if (args.wait === true) hit.push("continue.wait");
    return hit;
  },
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = { [DO_WINDOW_CONTINUE_BASIC]: CONTINUE_KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.msg !== "string" || args.msg.trim().length === 0) {
      entries[DO_WINDOW_CONTINUE_INPUT] = "do_window.continue 需要 msg；用 refine(args={ msg: \"...\", wait: true|false })。";
    }
    return entries;
  },
  exec: (ctx) => executeDoWindowContinue(ctx),
};

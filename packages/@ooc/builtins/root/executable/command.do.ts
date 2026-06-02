/**
 * root.do command — 委托到 do_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.do 的构造逻辑已迁到 packages/@ooc/core/executable/windows/do/index.ts
 * 的 kind="constructor" do method（child thread fork + creator do_window + inbox/outbox + share_windows）。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("do") 委托。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
  MethodOutcome,
} from "@ooc/core/extendable/_shared/command-types.js";
import { lookupConstructor } from "@ooc/core/extendable/_shared/registry.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 do_window constructor 注册
import "@ooc/core/executable/windows/do/index.js";

const DO_BASIC_PATH = "internal/executable/do/basic";
const DO_INPUT_PATH = "internal/executable/do/input";

const KNOWLEDGE = `
do 用于在当前对象内部派生子线程，并在父线程下产生一个 do_window 用于后续与子线程交互。

参数：
- msg: 必填，写入子线程 inbox 的初始消息
- wait: 可选，true 时父线程立刻进入 waiting，等子线程回写消息再唤醒
- share_windows: 可选，要在子线程创建时一并分享的 windows 列表，每条形如
  { window_id: "<id>", mode: "ref" | "move" }；ref = 只读 snapshot；move = 移交所有权
  内部展开为多次 do_window.move 命令；之后还可以随时通过 do_window.move 继续分享/归还

示例：
exec(command="do", title="处理告警", args={ msg: "请检查 ERROR 日志", wait: true })
exec(command="do", title="一起读 file_x", args={
  msg: "看 file_x 第 100-200 行",
  share_windows: [{ window_id: "w_file_abc", mode: "ref" }]
})

submit 后：
- 子线程创建并 running；初始消息进 child inbox
- 父线程下挂 do_window（type=do, targetThreadId=<childId>）
- 后续追加消息：exec(window_id="<do_window_id>", command="continue", args={ msg: "..." })
- 后续分享 window：exec(window_id="<do_window_id>", command="move", args={ window_id, mode })
- 关闭对话：close(window_id="<do_window_id>")（子线程会被标记 archived；borrowed owner 自动归还）
`.trim();

export enum DoCommandPath {
  Do = "do",
  Wait = "do.wait",
}

/** root level 的 do command：委托到 do_window constructor。 */
export const doCommand: CommandTableEntry = {
  paths: [DoCommandPath.Do, DoCommandPath.Wait],
  match: (args) => {
    const hit: string[] = [DoCommandPath.Do];
    if (args.wait === true) hit.push(DoCommandPath.Wait);
    return hit;
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [DO_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.msg !== "string" || args.msg.trim().length === 0) {
      entries[DO_INPUT_PATH] =
        "do 还缺以下参数: msg。\n" +
        "请用 refine(form_id, args={ msg: \"<给子线程的初始消息>\", wait: true|false }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeDoCommand(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托到 do_window constructor。
 */
export async function executeDoCommand(
  ctx: CommandExecutionContext,
): Promise<MethodOutcome | string | undefined> {
  const ctor = lookupConstructor("do");
  if (!ctor) return "[do] do_window constructor 未注册（registry 期望 kind=\"constructor\" 的 do method）。";
  return await ctor.exec(ctx);
}

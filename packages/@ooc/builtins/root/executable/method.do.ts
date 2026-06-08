/**
 * root.do method — 委托到 do_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.do 的构造逻辑已迁到 packages/@ooc/core/executable/windows/do/index.ts
 * 的 kind="constructor" do method（child thread fork + creator do_window + inbox/outbox + share_windows）。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("do") 委托。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";

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
exec(method="do", title="处理告警", args={ msg: "请检查 ERROR 日志", wait: true })
exec(method="do", title="一起读 file_x", args={
  msg: "看 file_x 第 100-200 行",
  share_windows: [{ window_id: "w_file_abc", mode: "ref" }]
})

submit 后：
- 子线程创建并 running；初始消息进 child inbox
- 父线程下挂 do_window（type=do, targetThreadId=<childId>）
- 后续追加消息：exec(window_id="<do_window_id>", method="continue", args={ msg: "..." })
- 后续分享 window：exec(window_id="<do_window_id>", method="move", args={ window_id, mode })
- 关闭对话：close(window_id="<do_window_id>")（子线程会被标记 archived；borrowed owner 自动归还）
`.trim();


export enum DoMethodPath {
  Do = "do",
  Wait = "do.wait",
}

/** root level 的 do method：委托到 do_window constructor。 */
export const doMethod: ObjectMethod = {
  paths: [DoMethodPath.Do, DoMethodPath.Wait],
  schema: {
    args: {
      msg: { type: "string", required: true, description: "写入子线程 inbox 的初始消息" },
      wait: { type: "boolean", required: false, description: "true 时父线程立刻进入 waiting，等子线程回写消息再唤醒" },
      share_windows: { type: "array", required: false, description: "要在子线程创建时一并分享的 windows 列表" },
    },
  } as MethodCallSchema,
  intent: (args): Intent[] => {
    const r: Intent[] = [];
    if (args.wait === true) r.push({ name: DoMethodPath.Wait });
    return r;
  },
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 在契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs（runtime 保证此 form 即 method_exec form）。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [DO_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    if (typeof args.msg !== "string" || args.msg.trim().length === 0) {
      entries[DO_INPUT_PATH] =
        "do 还缺以下参数: msg。\n" +
        "请用 refine(form_id, args={ msg: \"<给子线程的初始消息>\", wait: true|false }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => executeDoMethod(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托到 do_window constructor。
 */
export const executeDoMethod = makeRootDelegator({
  method: "do",
  constructorKind: "do",
  objectLabel: "do_window",
});

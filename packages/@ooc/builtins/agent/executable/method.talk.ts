/**
 * agent.talk —— agency 核心：开启一个持续会话 talk_window。
 *
 * 统一两种会话形态：
 * - target = 别的 objectId（"user" 也是）⇒ peer 跨对象会话（需 title；同一 target 复用同一窗）。
 * - target = 自己的 objectId ⇒ fork 一条同对象子线程（需 msg；wait / share_windows 可选）。
 *
 * 新契约下经 `ctx.runtime.instantiate("_builtin/agent/thread", args)` 委托 thread/talk class
 * 的 construct 造一个会话对象（thread-as-object）。会话对象在其 construct 内创建 thread +
 * 跑 thinkloop（深层 core 耦合，见 deferred_hooks：talk thread 创建 / thinkloop 编排 /
 * peer 复用同窗 仍待 core 反推阶段补 RuntimeHandle 面）。
 */

import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

const TALK_TIP = `talk 开启一个持续会话 talk_window。
- target=别的 objectId（"user" 也是）⇒ peer 跨对象会话（需 title；同一 target 复用同一窗，别每条消息重开）。
- target=自己的 objectId ⇒ fork 一条同对象子线程（需 msg；wait / share_windows 可选）。`;

export const talkMethod: ObjectMethod<Data> = {
  name: "talk",
  description:
    "Open a talk_window: target=another object ⇒ peer conversation; target=self ⇒ fork a child thread.",
  schema: {
    args: {
      target: {
        type: "string",
        required: true,
        description: '目标 objectId（别的对象 / "user" ⇒ peer；自己 ⇒ fork 子线程）',
      },
      title: { type: "string", required: false, description: "peer 会话主题（peer 形态必填）" },
      msg: { type: "string", required: false, description: "fork 子线程初始消息（fork 形态必填）" },
      wait: { type: "boolean", required: false, description: "（fork）true 时父线程等待子线程回写" },
      share_windows: {
        type: "array",
        required: false,
        description: "（fork）随子线程一并传的 windows 列表",
      },
    },
  },
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    const target = typeof args.target === "string" ? args.target.trim() : "";
    if (!target) return `[talk] ${TALK_TIP}`;
    const hasTitle = typeof args.title === "string" && args.title.trim().length > 0;
    const hasMsg = typeof args.msg === "string" && args.msg.trim().length > 0;
    if (!hasTitle && !hasMsg) {
      return `[talk] target=${target} 时需要 title（peer）或 msg（fork）之一。\n${TALK_TIP}`;
    }
    if (!ctx.runtime) return `[talk] ${TALK_TIP}\n（runtime 不可用，无法实例化会话对象）`;
    // deferred: talk 会话对象的 construct 须创建 thread + 跑 thinkloop（深层 core 耦合）；
    // peer 同窗复用 / fork 子线程内存树派送 仍待 core 反推阶段补 RuntimeHandle 面。
    const id = await ctx.runtime.instantiate("_builtin/agent/thread", args);
    return `已开启 talk 会话对象（id=${id}, target=${target}）。`;
  },
};

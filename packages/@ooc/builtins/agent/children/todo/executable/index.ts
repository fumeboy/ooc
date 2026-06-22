/**
 * todo —— executable 维度（object method）。
 *
 * todo 是待办卡片，持 open/done 业务态。唯一 object method `mark_done` 把
 * status 从 open 翻成 done——这是真实业务态迁移（改 object data），故归 executable，
 * 区别于纯生命周期 close（归 runtime 元信息管理）。构造逻辑在 ../index.ts 的 `Class.construct`。
 */

import type {
  ExecutableContext,
  ExecutableModule,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { SelfProxy } from "@ooc/core/_shared/types/self-proxy.js";
import type { Data } from "../types.js";

const markDone: ObjectMethod<Data> = {
  name: "mark_done",
  description: "Mark this todo as done.",
  exec: async (ctx: ExecutableContext, self: SelfProxy<Data>) => {
    if (self.data.status === "done") return "已是 done 状态。";
    self.data.status = "done";
    await ctx.reportDataEdit?.();
    return "已标记为 done。";
  },
};

const executable: ExecutableModule<Data> = {
  methods: [markDone],
};

export default executable;

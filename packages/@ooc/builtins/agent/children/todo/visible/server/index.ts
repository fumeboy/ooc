/**
 * todo —— visible/server 维度（人类侧服务端 API）。
 *
 * UI 在控制面（无 thinkloop thread）经 HTTP call_method 直接编辑 todo 的 object data：
 * - set_content：把 args.content 写入 self.content（人类在卡片上改正文）
 * - toggle_done：翻转 open↔done 业务态
 *
 * 与 executable 的 mark_done（LLM 在 thinkloop 行使）正交：这里是人类侧编辑入口，
 * 改入参 self（pass-by-ref）→ 经 reportDataEdit eager 落盘（persistable.save）。
 */

import type {
  VisibleServerMethod,
  VisibleServerModule,
} from "@ooc/core/types/visible-server.js";
import type { Data } from "../../types.js";

const setContent: VisibleServerMethod<Data> = {
  name: "set_content",
  description: "Set this todo's content (human edit from UI).",
  schema: { args: { content: { type: "string", required: true, description: "新正文" } } },
  exec: async (ctx, self, args) => {
    const content = typeof args.content === "string" ? args.content : "";
    if (!content.trim()) throw new Error("[todo.set_content] 缺少 content 参数。");
    self.content = content;
    await ctx.reportDataEdit?.();
    return { data: { content: self.content } };
  },
};

const toggleDone: VisibleServerMethod<Data> = {
  name: "toggle_done",
  description: "Toggle this todo between open and done (human edit from UI).",
  exec: async (ctx, self) => {
    self.status = self.status === "done" ? "open" : "done";
    await ctx.reportDataEdit?.();
    return { data: { status: self.status } };
  },
};

const visibleServer: VisibleServerModule<Data> = {
  methods: [setContent, toggleDone],
};

export default visibleServer;

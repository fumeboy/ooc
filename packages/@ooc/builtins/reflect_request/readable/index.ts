/**
 * reflect_request —— readable 维度（投影成 context window）。
 *
 * reflect_request 经 class 链继承 thread → talk（`ooc.class: "_builtin/thread"`）的会话渲染：它在
 * super flow 里取代 creator talk_window，与 talk 同形，渲染行为应**完全复用 talk 的 renderTalkWindow**，
 * 并额外 surface 两个 reflectable 沉淀 object method（new_feat_branch / create_pr_and_invite_reviewers）。
 *
 * deferred（Wave4 talk 迁移归位）：talk 的 renderTalkWindow 仍在 core 用旧渲染上下文签名（本轮
 * 未迁），无法直接以新 (ctx,self,win) 契约调用。本文件先给一个**最小占位 readable**——投影
 * class=reflect_request + 简短说明 content；待 talk 迁到新契约后复用其会话渲染（transcript viewport /
 * compressView / consumedMessageIds 等）。
 */
import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText } from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** reflect_request 的投影态（与 Data 分离）。Wave4 复用 talk 的 transcript viewport 投影态。 */
export interface ReflectRequestWin {}

const readable: ReadableModule<Data, ReflectRequestWin> = {
  readable: (_ctx: ReadableContext, _self: Data, _win: ReflectRequestWin) => ({
    class: "reflect_request",
    content: [
      xmlElement("note", {}, [
        xmlText(
          "reflect_request self-view —— 继承 talk 的会话渲染 + reflectable 沉淀方法（Wave4 talk 迁移后接回 renderTalkWindow）。",
        ),
      ]),
    ],
  }),
  window: [
    {
      class: "reflect_request",
      object_methods: ["new_feat_branch", "create_pr_and_invite_reviewers"],
      window_methods: [],
    },
  ],
};

export default readable;

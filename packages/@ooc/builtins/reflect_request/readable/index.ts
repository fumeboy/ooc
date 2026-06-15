/**
 * reflect_request —— readable 维度（投影成 context window）。
 *
 * reflect_request 经 class 链继承 thread → talk（`ooc.class: "_builtin/thread"`）的会话渲染：它在
 * super flow 里取代 creator talk_window，与 talk 同形，会话渲染由 class 链复用 talk 的 readable，
 * 并额外 surface 两个 reflectable 沉淀 object method（new_feat_branch / create_pr_and_invite_reviewers）。
 *
 * 本文件给一个**最小占位 readable**——投影 class=reflect_request + 简短说明 content。会话内容
 * （transcript viewport / 压缩视图等）由 class 链上的 talk readable 提供；本占位仅声明 reflect_request
 * 投影 class 与其专属沉淀 method 窗。
 */
import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText } from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** reflect_request 的投影态（与 Data 分离）。会话 viewport 投影态由 class 链上的 talk readable 持有。 */
export interface ReflectRequestWin {}

const readable: ReadableModule<Data, ReflectRequestWin> = {
  readable: (_ctx: ReadableContext, _self: Data, _win: ReflectRequestWin) => ({
    class: "reflect_request",
    content: [
      xmlElement("note", {}, [
        xmlText(
          "reflect_request self-view —— 继承 talk 的会话渲染 + reflectable 沉淀方法。",
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

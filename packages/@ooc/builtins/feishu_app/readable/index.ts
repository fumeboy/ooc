/**
 * feishu_app —— readable 维度（投影成接入面板 window）。
 *
 * 把 feishu_app 单例投影成一个飞书接入面板：列出经本接入点开过的 feishu_chat / feishu_doc
 * 子对象，给出可调 method（open_chat / open_doc）的提示。连接状态（event-relay WS）是进程内
 * 运行态、不在 object Data 里，故面板只陈述「凭证配在 .world.json，relay 由 server 启动期拉起」。
 *
 * 与 executable 维度（object method，在 ../executable/index.ts）物理分离。
 */

import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/types";
import type { ReadonlySelfProxy } from "@ooc/core/types";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/types/xml.js";
import type { Data } from "../types.js";

function renderFeishuApp(self: Data): XmlNode[] {
  const children: XmlNode[] = [
    xmlElement("hint", {}, [
      xmlText(
        "飞书接入点：open_chat 把群聊/单聊引入 context、open_doc 把文档引入 context。" +
          "飞书凭证配在 .world.json（LarkAppId/LarkAppSecret）；inbound 消息中继由 server 启动期拉起。",
      ),
    ]),
  ];

  const chatIds = self.openedChatObjectIds ?? [];
  const chatNodes = chatIds.map((id) => xmlElement("chat", { object_id: id }, []));
  children.push(
    xmlElement("opened_chats", { count: String(chatIds.length) }, chatNodes),
  );

  const docIds = self.openedDocObjectIds ?? [];
  const docNodes = docIds.map((id) => xmlElement("doc", { object_id: id }, []));
  children.push(
    xmlElement("opened_docs", { count: String(docIds.length) }, docNodes),
  );

  return children;
}

const readable: ReadableModule<Data> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>) => ({
    class: "feishu_app",
    content: renderFeishuApp(self.data),
  }),
  window: [
    {
      class: "feishu_app",
      object_methods: ["open_chat", "open_doc"],
      window_methods: [],
    },
  ],
};

export default readable;

/**
 * feishu_doc —— readable 维度（投影成 context window）。
 *
 * 把 Data 投影成文档 window —— doc 元信息 + content.body 渲染为 content 文本块。
 * window 声明引用 executable 的 object_methods；本类无独立投影态切片（无 window method）。
 *
 * 与 executable 维度（object method，在 ../executable/index.ts）物理分离。
 */

import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

const MAX_RENDER_BYTES = 12288;

function renderFeishuDoc(self: Data): XmlNode[] {
  const children: XmlNode[] = [
    xmlElement("doc_token", {}, [xmlText(self.docToken)]),
    xmlElement("doc_kind", {}, [xmlText(self.docKind)]),
    xmlElement("doc_title", {}, [xmlText(self.docTitle)]),
    xmlElement("mode", {}, [xmlText(self.mode)]),
    xmlElement("content_format", {}, [xmlText(self.content.format)]),
  ];
  if (self.versionId) children.push(xmlElement("version_id", {}, [xmlText(self.versionId)]));
  if (self.lastFetchedAtMs) {
    children.push(xmlElement("last_fetched", {}, [xmlText(new Date(self.lastFetchedAtMs).toISOString())]));
  }
  const body = self.content.body || "(尚未 read，content 为空)";
  children.push(xmlElement("content", {}, [xmlText(truncateBytes(body, MAX_RENDER_BYTES))]));
  return children;
}

const readable: ReadableModule<Data> = {
  readable: (_ctx: ReadableContext, self: Data) => ({
    class: "feishu_doc",
    content: renderFeishuDoc(self),
  }),
  window: [
    {
      class: "feishu_doc",
      object_methods: ["read", "search_in_doc", "append", "patch_block", "share_link", "attach_to_chat", "close"],
      window_methods: [],
    },
  ],
};

export default readable;

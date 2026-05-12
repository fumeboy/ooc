import { deriveStoneFromThread } from "../../persistable/common";
import {
  computeActivations,
  loadKnowledgeIndex,
  type ActivationResult
} from "../knowledge";
import type { ThreadContext } from "./index";
import { escapeXml } from "./render";

/** 单篇 knowledge 全文截断上限，避免 context 爆炸。 */
const MAX_KNOWLEDGE_BYTES = 8192;

function truncateKnowledgeBody(body: string): string {
  const bytes = new TextEncoder().encode(body);
  if (bytes.length <= MAX_KNOWLEDGE_BYTES) return body;
  const head = new TextDecoder().decode(bytes.slice(0, MAX_KNOWLEDGE_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

/** 根据 activator 输出渲染 <active_knowledge>，按 summary / full 两档形态。 */
function renderActiveKnowledge(activations: ActivationResult[]): string {
  if (activations.length === 0) return "";
  const items = activations
    .map((a) => {
      const desc = a.doc.frontmatter.description ?? "";
      const descXml = desc ? `<description>${escapeXml(desc)}</description>` : "";
      const contentXml =
        a.presentation === "full"
          ? `<content>${escapeXml(truncateKnowledgeBody(a.doc.body))}</content>`
          : "";
      return [
        `<knowledge path="${escapeXml(a.path)}" presentation="${a.presentation}">`,
        descXml,
        contentXml,
        "</knowledge>"
      ].join("");
    })
    .join("");
  return `<active_knowledge>${items}</active_knowledge>`;
}

/**
 * 调 loader + activator 计算本轮激活集合，渲染为 XML 段。
 * 线程没有 persistence 或加载失败时返回 ""，不污染 context。
 */
export async function computeKnowledgeXml(thread: ThreadContext): Promise<string> {
  if (!thread.persistence) return "";
  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    const index = await loadKnowledgeIndex(stoneRef);
    const activations = computeActivations(thread, index);
    return renderActiveKnowledge(activations);
  } catch {
    return "";
  }
}

import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";
import type { Viewport } from "@ooc/core/extendable/_shared/viewport.js";

/**
 * Knowledge window — 一段 knowledge 文本作为 window 出现在 context 中。
 *
 * 四种 source（spec 2026-05-14 + 后续统一 + 2026-05-18 relation）：
 * - explicit  ：LLM 通过 \`open(method="open_knowledge", path)\` 显式 pin；
 *               持久化到 thread.contextWindows；可被 LLM \`close\` 释放。
 *               render 时从 stone knowledge loader 取正文。
 * - protocol  ：按 activates_on 注入的 root builtin knowledge（builtins/root/knowledge/*.md）
 *               与 creator-reply 等协议派生条目；
 *               不持久化，每轮 buildInputItems / captureContextSnapshot 时合成；
 *               LLM 不可 close（\`close\` hook 会拒绝并写 inject）。
 * - activator ：pools/objects/{id}/knowledge/*.md 经 intentPaths 命中激活的条目；
 *               同样合成、不持久化、不可 close；额外携带 presentation=full|summary。
 * - relation  ：thread.contextWindows 中存在 talk_window(target=peerId) 时,
 *               按 peerId 派生最多 2 条:peer 的 stones/{peer}/readme.md 与
 *               自己的 pools/{self}/knowledge/relations/{peer}.md(后者缺失时
 *               合成占位 body 提示 LLM 写入)。同样不持久化、不可 close;由
 *               src/thinkable/knowledge/synthesizer.ts:deriveRelationKnowledge 派生。
 *
 * 历史：2026-05-26 移除 source="issue"（issue 看板整体下线）。
 *
 * 合成的 KnowledgeWindow 自带 \`body\`，render 层不再需要回调 loader。
 * activator 来源走总数 20 项 + 单篇 8KB 截断。
 */
export interface KnowledgeWindow extends BaseContextWindow {
  class: "knowledge";
  status: "open" | "closed";
  path: string;
  /** 四类来源；缺省视为 explicit（向后兼容旧 thread.json）。 */
  source?: "explicit" | "protocol" | "activator" | "relation";
  /** 合成 window 携带正文；explicit 来源时由 render 层从 loader 取。 */
  body?: string;
  /** activator / relation 来源时区分 full（含正文）与 summary（仅 description）。 */
  presentation?: "full" | "summary";
  /** activator 来源时记录 doc.frontmatter.description，便于 summary 渲染。 */
  description?: string;
  /**
   * @deprecated 移到 state.viewport（WindowDisplayState）；保留以兼容旧 thread.json。
   * 渲染窗口大小由 readable 维度的 window method `set_viewport`（写 state.viewport）调整。
   *
   * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
   */
  viewport?: Viewport;
}

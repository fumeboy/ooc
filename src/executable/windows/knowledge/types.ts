import type { BaseContextWindow } from "../_shared/types.js";
import type { Viewport } from "../_shared/viewport.js";

/**
 * Knowledge window — 一段 knowledge 文本作为 window 出现在 context 中。
 *
 * 四种 source（spec 2026-05-14 + 后续统一 + 2026-05-18 relation）：
 * - explicit  ：LLM 通过 \`open(method="open_knowledge", path)\` 显式 pin；
 *               持久化到 thread.contextWindows；可被 LLM \`close\` 释放。
 *               render 时从 stone knowledge loader 取正文。
 * - protocol  ：每轮自动注入的协议常量（src/executable/index.ts KNOWLEDGE）
 *               与每个 command_exec form 的 \`knowledge()\` 派生条目；
 *               不持久化，每轮 buildInputItems / captureContextSnapshot 时合成；
 *               LLM 不可 close（\`close\` hook 会拒绝并写 inject）。
 * - activator ：pools/objects/{id}/knowledge/*.md 经 commandPaths 命中激活的条目；
 *               同样合成、不持久化、不可 close；额外携带 presentation=full|summary。
 *
 * 历史：2026-05-26 移除 source="issue"（issue 看板整体下线）；
 *       2026-05-31 OOC-4 L6a 移除 source="relation"（relation_window 删除，
 *       relations 改由 <self_view><relations> 自视切片注入，不再走 KnowledgeWindow）。
 *
 * 合成的 KnowledgeWindow 自带 \`body\`，render 层不再需要回调 loader。
 * activator 来源走总数 20 项 + 单篇 8KB 截断。
 */
export interface KnowledgeWindow extends BaseContextWindow {
  type: "knowledge";
  status: "open" | "closed";
  path: string;
  /** 三类来源；缺省视为 explicit（向后兼容旧 thread.json）。 */
  source?: "explicit" | "protocol" | "activator";
  /** 合成 window 携带正文；explicit 来源时由 render 层从 loader 取。 */
  body?: string;
  /** activator 来源时区分 full（含正文）与 summary（仅 description）。 */
  presentation?: "full" | "summary";
  /** activator 来源时记录 doc.frontmatter.description，便于 summary 渲染。 */
  description?: string;
  /**
   * 渲染窗口大小 { lineStart, lineEnd, columnStart, columnEnd }；
   * open_knowledge 创建 explicit 来源时填默认 0-200 / 0-200，可通过 `set_viewport` 命令调整。
   *
   * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
   */
  viewport?: Viewport;
}

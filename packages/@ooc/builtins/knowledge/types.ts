/**
 * knowledge —— 一段 knowledge 文本作为对象出现在 context 中的 **object data**（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗信封字段（id/class/title/status/createdAt/parentWindowId，由 runtime 管理），
 * 也**不含**展示态（viewport 归 readable 的投影态 `win`，见 readable/index.ts 的 `KnowledgeWin`）。
 *
 * 四种 source：
 * - explicit  ：LLM 通过 `open_knowledge(path)` constructor 显式 pin；持久化；可被 LLM `close` 释放。
 *               render 时从 stone knowledge loader 取正文（body 通常空）。
 * - protocol  ：按 activates_on 注入的 root builtin knowledge（builtins/root/knowledge/*.md）
 *               与 creator-reply 等协议派生条目；不持久化，每轮合成；LLM 不可 close。
 * - activator ：pools/objects/{id}/knowledge/*.md 经 intentPaths 命中激活的条目；
 *               同样合成、不持久化、不可 close；额外携带 presentation=full|summary。
 * - relation  ：thread.contextWindows 中存在 talk_window(target=peerId) 时按 peerId 派生；
 *               不持久化、不可 close。
 *
 * 历史：移除 source="issue"（issue 看板整体下线）。
 * 合成的 knowledge 自带 `body`，render 层不再需要回调 loader。
 * activator 来源走总数 20 项 + 单篇 8KB 截断。
 */
export interface Data {
  /** knowledge 索引中的路径（不带 .md，如 "build-tools/file-ops"）。 */
  path: string;
  /** 四类来源；缺省视为 explicit（向后兼容旧持久化）。 */
  source?: "explicit" | "protocol" | "activator" | "relation";
  /** 合成 knowledge 携带正文；explicit 来源时由 readable 从 loader 取。 */
  body?: string;
  /** activator / relation 来源时区分 full（含正文）与 summary（仅 description）。 */
  presentation?: "full" | "summary";
  /** activator 来源时记录 doc.frontmatter.description，便于 summary 渲染。 */
  description?: string;
}

/**
 * @deprecated 过渡兼容别名（Wave3 前端迁移时删除）：visible 层仍按旧「窗对象」消费。
 * 新后端契约用 Data + runtime 信封（OocObjectInstance）——**不要在后端引用本别名**。
 */
export type KnowledgeWindow = Data & {
  id?: string;
  class?: "knowledge";
  title?: string;
  status?: string;
  createdAt?: number;
  parentWindowId?: string;
};

import type { BaseContextWindow } from "../_shared/types.js";

/**
 * @deprecated 2026-05-28 ooc-6 Phase 6: RelationWindow 已被 peer Object 自动注入机制替代。
 * peer/children Object 本身作为 custom window 自动进入 context,通过 edit_relation 命令
 * 替代原 RelationWindow.edit。本类型保留仅用于向后兼容,Phase 9 cleanup 时移除。
 *
 * Relation window — 与某个 peer flow object 的关系窗口,自带 `edit` 命令面。
 *
 * collaborable § relation_window(spec 2026-05-20, 2026-05-25 R8-5, 2026-05-27 修订):
 * - 每个 thread 中的 talk_window(target=peerId) 在 derive 时按 peerId 去重派生
 *   一条 RelationWindow,id 稳定为 `w_rel_<peerId>`;不持久化(每轮重派生)。
 * - 2026-05-27: 同级 / 一级 children Agent 也默认派生 relation_window
 *   (spec collaborable.relation_window default visibility);见 synthesizer.ts。
 * - 注册的 method:`edit`(整文件替换语义);通过 args.scope 路由:
 *   - scope="session" → 直接写 flow 层 `flows/<sid>/objects/<self>/knowledge/relations/<peer>.md`
 *   - scope="long_term" → 派一条 talk message 给 super flow,由 super 写
 *     `pools/<self>/knowledge/relations/<peer>.md`(跨 session 长期生效)
 * - super alias(target="super")的 talk_window 不派生 RelationWindow。
 *
 * **2026-05-27 撤回 R8-5 的 peerReadme 删除**:default visibility 让大量自动派生
 * 的 sibling / child relation_window 出现在 LLM 视野,但 self 大概率没写过它们的
 * relation note → window body 全空只剩 path。这违背 default visibility 的初衷
 * (让 Agent 一上场就知道身边有谁干什么)。把 peer readme(stones/<peer>/readme.md)
 * 作为只读字段挂回来:LLM 一眼看到 peer 是谁,无须再 file_window open;同时不影响
 * self-relation 的可写双层(pools/flows)。维度上 RelationWindow 现在承担"peer 身份
 * 介绍 + self-relation 双层认知"两块,文档明确。
 *
 * **R8-5(2026-05-25):API contract 显式 exists flag**。每个 self-relation 路径都暴露
 * `*Exists: boolean`, 让 frontend / 外部 caller 区分"懒创建未写入"(exists=false)
 * 与"读失败 / bug"(stat 抛 error); 之前只有 LLM render 通道能看到占位提示,
 * HTTP API JSON 无信号。
 *
 * 详见 src/executable/windows/relation/index.ts 与
 * src/thinkable/knowledge/synthesizer.ts:deriveRelationWindow。
 */
export interface RelationWindow extends BaseContextWindow {
  type: "relation";
  status: "open" | "closed";
  /** 对端 objectId(去重 key);与 talk_window.target 同源。 */
  peerId: string;

  // ── peer 身份介绍(2026-05-27 撤回 R8-5 删除决定;详见上方 JSDoc)
  /** peer stone readme 路径:`stones/<branch>/objects/<peer>/readme.md`。 */
  peerReadmePath: string;
  /** peer readme 正文;文件缺失 / 读失败 → undefined。截断后 ≤ 8KB。 */
  peerReadmeBody?: string;
  /** peer readme 文件是否存在(false = peer stone 没 readme 或 lazy)。 */
  peerReadmeExists: boolean;

  // ── self-relation body(2026-05-21 把原来伴随 KnowledgeWindow 的内容内联进来,详见
  //     synthesizer.ts:deriveRelationWindow + render.ts case "relation"。
  //     2026-05-25 R8-5: 补 *Exists flag, 让 API caller 显式知道文件是否存在。)

  /** self long_term relation 路径:`pools/<self>/knowledge/relations/<peer>.md`。 */
  selfLongTermPath: string;
  /** long_term 正文;文件缺失 → undefined。 */
  selfLongTermBody?: string;
  /** R8-5: long_term 文件是否实际存在(false = 懒创建未写, 与读失败区分)。 */
  selfLongTermExists: boolean;

  /** self session relation 路径:`flows/<sid>/objects/<self>/knowledge/relations/<peer>.md`。 */
  selfSessionPath: string;
  /** session 正文;文件缺失 → undefined。 */
  selfSessionBody?: string;
  /** R8-5: session 文件是否实际存在(false = 懒创建未写, 与读失败区分)。 */
  selfSessionExists: boolean;
}

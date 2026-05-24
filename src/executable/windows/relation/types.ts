import type { BaseContextWindow } from "../_shared/types.js";

/**
 * Relation window — 与某个 peer flow object 的关系窗口,自带 `edit` 命令面。
 *
 * collaborable § relation_window(spec 2026-05-20, 2026-05-25 R8-5 修订):
 * - 每个 thread 中的 talk_window(target=peerId) 在 derive 时按 peerId 去重派生
 *   一条 RelationWindow,id 稳定为 `w_rel_<peerId>`;不持久化(每轮重派生)。
 * - 注册的 command:`edit`(整文件替换语义);通过 args.scope 路由:
 *   - scope="session" → 直接写 flow 层 `flows/<sid>/objects/<self>/knowledge/relations/<peer>.md`
 *   - scope="long_term" → 派一条 talk message 给 super flow,由 super 写
 *     `pools/<self>/knowledge/relations/<peer>.md`(跨 session 长期生效)
 * - super alias(target="super")的 talk_window 不派生 RelationWindow。
 *
 * **不含 peerReadme**(2026-05-25 删除): relation 文档在设计中只存在于 pools 与 flows
 * 目录(self 视角的 self-relation), 不包含 peer stone 中的 readme; peer readme 是
 * collaborable.talk_window 维度的"对端身份介绍", 与 self-relation 是不同维度的资源,
 * 不应当被 RelationWindow 内联。需要 peer readme 时通过 file_window 直接 open peer
 * stone 路径即可。
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

  // ── self-relation body(2026-05-21 把原来伴随 KnowledgeWindow 的内容内联进来,详见
  //     synthesizer.ts:deriveRelationWindow + render.ts case "relation"。
  //     2026-05-25 R8-5: 补 *Exists flag, 让 API caller 显式知道文件是否存在。)

  /** self long_term relation 路径:`pools/<self>/knowledge/relations/<peer>.md`。 */
  selfLongTermPath: string;
  /** long_term 正文;文件缺失 → undefined(渲染为占位提示)。 */
  selfLongTermBody?: string;
  /** R8-5: long_term 文件是否实际存在(false = 懒创建未写, 与读失败区分)。 */
  selfLongTermExists: boolean;

  /** self session relation 路径:`flows/<sid>/objects/<self>/knowledge/relations/<peer>.md`。 */
  selfSessionPath: string;
  /** session 正文;文件缺失 → undefined(渲染为占位提示)。 */
  selfSessionBody?: string;
  /** R8-5: session 文件是否实际存在(false = 懒创建未写, 与读失败区分)。 */
  selfSessionExists: boolean;
}

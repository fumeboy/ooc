import type { BaseContextWindow } from "../_shared/types.js";

/**
 * Relation window — 与某个 peer flow object 的关系窗口,自带 `edit` 命令面。
 *
 * collaborable § relation_window(spec 2026-05-20):
 * - 每个 thread 中的 talk_window(target=peerId) 在 derive 时按 peerId 去重派生
 *   一条 RelationWindow,id 稳定为 `w_rel_<peerId>`;不持久化(每轮重派生)。
 * - 注册的 command:`edit`(整文件替换语义);通过 args.scope 路由:
 *   - scope="session" → 直接写 flow 层 `flows/<sid>/objects/<self>/knowledge/relations/<peer>.md`
 *   - scope="long_term" → 派一条 talk message 给 super flow,由 super 写
 *     `pools/<self>/knowledge/relations/<peer>.md`(跨 session 长期生效)
 * - super alias(target="super")的 talk_window 不派生 RelationWindow。
 *
 * 详见 src/executable/windows/relation/index.ts 与
 * src/thinkable/knowledge/synthesizer.ts:deriveRelationWindow。
 */
export interface RelationWindow extends BaseContextWindow {
  type: "relation";
  status: "open" | "closed";
  /** 对端 objectId(去重 key);与 talk_window.target 同源。 */
  peerId: string;

  // ── relation body(2026-05-21 把原来伴随 KnowledgeWindow 的内容内联进来,详见
  //     synthesizer.ts:deriveRelationWindow + render.ts case "relation"。
  //     都 optional —— 缺失字段对应"暂无,通过 edit 写入"占位。)

  /** peer 的 stones/<peer>/readme.md 路径(始终给出,不论文件是否存在)。 */
  peerReadmePath: string;
  /** peer readme.md 正文;peer 没有 stone 目录或 readme.md 缺失/IO 失败 → undefined。 */
  peerReadme?: string;

  /** self long_term relation 路径:`pools/<self>/knowledge/relations/<peer>.md`。 */
  selfLongTermPath: string;
  /** long_term 正文;文件缺失 → undefined(渲染为占位提示)。 */
  selfLongTermBody?: string;

  /** self session relation 路径:`flows/<sid>/objects/<self>/knowledge/relations/<peer>.md`。 */
  selfSessionPath: string;
  /** session 正文;文件缺失 → undefined(渲染为占位提示)。 */
  selfSessionBody?: string;
}

/** knowledge 文档的 yaml frontmatter 形式。所有字段可选（缺失时按默认值处理）。 */
export interface KnowledgeFrontmatter {
  /** 文档化字段；以文件路径为准时仅作参考。 */
  filename?: string;
  title?: string;
  /** 一句话描述；当 knowledge "可见但未激活"时仅 description 出现在 Context。 */
  description?: string;
  /** 激活规则：根据 form 中的 command 路径决定何时进入 Context。 */
  activates_on?: {
    /** 命中时仅注入 description。 */
    show_description_when?: string[];
    /** 命中时注入完整正文。 */
    show_content_when?: string[];
  };
  /**
   * 是否允许被子 Agent 继承（B-tree 协议，2026-05-26）。
   *
   * - `true`：父 Agent 的这篇 knowledge 会被子 Agent 的 loadKnowledgeIndex 自动纳入索引；
   *   子 Agent 自己 knowledge 目录下同 idPath 的 knowledge 仍然胜出（override）。
   * - `false` / 缺省：仅父 Agent 自己可见，不下传。
   *
   * 注意：sediment（pool 侧 memory / relations）默认不下传——它们没有这个字段，
   * loader 也不会扫描祖先 pool。本字段只对 stone seed knowledge 生效。
   *
   * 详见 meta/object.doc.ts:thinkable.children.knowledge.patches.domain_axis。
   */
  inheritable?: boolean;
}

/** 解析后的单篇 knowledge 文档。 */
export interface KnowledgeDoc {
  /** 相对 knowledge/ 的 ID 路径（不含 .md），如 "build-tools/file-ops"。 */
  path: string;
  /** 物理绝对路径，用于 mtime 检查与外部定位。 */
  file: string;
  /** 解析后的 frontmatter；缺失字段保持 undefined，由消费者决定默认值。 */
  frontmatter: KnowledgeFrontmatter;
  /** markdown 正文（不含 frontmatter）。 */
  body: string;
  /** 文件 mtimeMs，用于热重载判定。 */
  mtime: number;
}

/** loader 返回的索引。 */
export interface KnowledgeIndex {
  /** path -> doc。 */
  byPath: Map<string, KnowledgeDoc>;
}

/** 激活器输出的单条结果。 */
export interface ActivationResult {
  /** 命中的 knowledge path。 */
  path: string;
  /** 渲染形态：summary 只渲 description，full 渲完整 body。 */
  presentation: "summary" | "full";
  /** 引用：渲染时直接读 doc。 */
  doc: KnowledgeDoc;
  /** 命中原因，供调试 / 后续 inject 注释；当前不暴露给 LLM。 */
  reason: "pinned" | "command_path_full" | "command_path_summary";
}

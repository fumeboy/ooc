/**
 * feishu_doc —— object data 结构（OocClass 契约的 `types.ts` = 纯业务数据）。
 *
 * 一个飞书文档在 context 中以本对象为单元：
 * - 一个 docToken 对应一个实例；docKind 区分 doc / docx / sheet / base / wiki / drive_md。
 * - 内容形态：read 模式以 markdown 拉到 content.body；写类命令严格走 dry-run gate。
 *
 * 不含窗信封字段（id/class/title/status/createdAt 由 runtime 管理）；投影态本类无独立 win。
 */
export interface FeishuDocBlock {
  blockId: string;
  blockType?: string;
  text?: string;
  parentBlockId?: string;
}

export interface Data {
  /** 飞书文档 token（doccnXXX / wikXXX / 等）。 */
  docToken: string;
  /** 文档实际类型。 */
  docKind: "doc" | "docx" | "sheet" | "base" | "wiki" | "drive_md";
  /** 文档标题（read 时填充；可能落后于飞书改名）。 */
  docTitle: string;
  /** 当前已加载的内容；format 区分 markdown 文本或结构化 block 数组。 */
  content: {
    format: "markdown" | "blocks";
    body: string;
    blocks?: FeishuDocBlock[];
  };
  /** 飞书文档 revision；patch 类命令应在 dry-run 时记录此版本，submit 时检查未飘移。 */
  versionId?: string;
  /** read=只读视图；edit=允许 patch；缺省 read。 */
  mode: "read" | "edit";
  /** 当前光标位置（block 锚点）；高级编辑场景使用，第一期可不填。 */
  selection?: { blockId?: string; range?: [number, number] };
  /** 末次拉取时间（毫秒）。 */
  lastFetchedAtMs?: number;
}

/**
 * @deprecated 过渡兼容别名（visible 层仍按旧「窗对象」消费）。
 * 新后端契约用 Data + runtime 信封（OocObjectInstance）。
 */
export type FeishuDocWindow = Data & {
  id?: string;
  class?: "feishu_doc";
  title?: string;
  status?: "open" | "closed";
};

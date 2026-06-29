/**
 * objects domain — UI 表层 displayName 派生(spec: `meta/object.doc.ts:visible.display_name_from_self_md`)。
 *
 * 不引入新的 stone/flow 数据字段:UI 端从 self.md 第一行 `# Title` 派生展示标题,
 * 失败时 fallback 回原 objectId。原 objectId 永远保留在 hover/title attr,供调试。
 */
export type DisplayNameSource = "self.md" | "fallback";

export type DisplayName = {
  objectId: string;
  displayName: string;
  source: DisplayNameSource;
};

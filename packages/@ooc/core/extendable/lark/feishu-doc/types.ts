import type { BaseContextWindow } from "../../../executable/windows/_shared/types.js";

/**
 * Feishu doc window — 在 context 中以飞书文档为对象单元的窗口。
 *
 * 说明（meta/case.feishu-integration.doc.ts）：
 * - 一个 docToken 对应一个 window 实例；docKind 区分 doc / docx / sheet / base / wiki / drive_md。
 * - 内容形态：read 模式以 markdown 拉到 content.body（lark-cli markdown +fetch 优先；不可用时回退到 docs +read）。
 * - 写类命令（append / patch_block / create / attach_to_chat）严格走 dry-run gate（supervisor 决策）。
 *
 * 字段：
 * - docToken：飞书文档 token（doccnXXXXX / wikXXXXX / 等）。
 * - docKind：文档实际类型。
 * - title：文档标题（read 时填充；可能落后于飞书改名）。
 * - content：当前已加载的内容；format 区分 markdown 文本或结构化 block 数组。
 * - versionId：飞书文档 revision；patch 类命令应在 dry-run 时记录此版本，submit 时检查未飘移。
 * - mode：read=只读视图；edit=允许 patch；缺省 read。
 * - selection：当前光标位置（block 锚点）；高级编辑场景使用，第一期可不填。
 */
export interface FeishuDocBlock {
  blockId: string;
  blockType?: string;
  text?: string;
  parentBlockId?: string;
}

export interface FeishuDocWindow extends BaseContextWindow {
  type: "feishu_doc";
  status: "open" | "closed";
  docToken: string;
  docKind: "doc" | "docx" | "sheet" | "base" | "wiki" | "drive_md";
  docTitle: string;
  content: {
    format: "markdown" | "blocks";
    body: string;
    blocks?: FeishuDocBlock[];
  };
  versionId?: string;
  mode: "read" | "edit";
  selection?: { blockId?: string; range?: [number, number] };
  lastFetchedAtMs?: number;
}

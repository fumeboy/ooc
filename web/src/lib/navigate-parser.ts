/**
 * Navigate 块解析器
 *
 * 从消息文本中提取 [navigate] 块，替换为 HTML comment 占位符。
 * 占位符能安全穿越 Markdown 解析，渲染后再替换为 React 组件。
 */

/** 解析出的导航块 */
export interface NavigateBlock {
  title: string;
  description?: string;
  url: string;
  index: number;
}

/** 解析结果 */
export interface ParseResult {
  /** [navigate] 块被替换为占位符后的文本 */
  cleanText: string;
  /** 提取出的导航块 */
  blocks: NavigateBlock[];
}

/** 匹配 [navigate title="..." description="..."]url[/navigate] */
const NAVIGATE_RE = /\[navigate\s+title="([^"]+)"(?:\s+description="([^"]*)")?\]\s*(\S+)\s*\[\/navigate\]/g;

/**
 * 解析文本中的 [navigate] 块
 *
 * 每个块替换为 `<!--ooc-nav-N-->` 占位符。
 */
export function parseNavigateBlocks(text: string): ParseResult {
  const blocks: NavigateBlock[] = [];
  let index = 0;

  const cleanText = text.replace(NAVIGATE_RE, (_match, title: string, description: string | undefined, url: string) => {
    blocks.push({
      title,
      description: description || undefined,
      url,
      index,
    });
    return `<!--ooc-nav-${index++}-->`;
  });

  return { cleanText, blocks };
}

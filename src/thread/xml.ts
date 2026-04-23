/**
 * XML 结构化序列化辅助
 *
 * engine 用这套辅助把 ThreadContext 渲染成 LLM input 的 XML 文本。
 * 独立成模块是为了：
 * - 便于单元测试（转义 / CDATA 边界行为可直接断言）
 * - 与 engine 的调度逻辑解耦
 *
 * 设计原则：
 * - 属性值强制 XML 实体转义（`&amp;` / `&lt;` / `&gt;` / `&quot;`）——属性不走 CDATA
 * - 叶子内容按需 CDATA 包装——仅当出现 `<` / `>` / `&` 时才包；否则原样输出以保留
 *   Markdown / 代码块的可读性
 * - CDATA 中的 `]]>` 需要拆分成 `]]]]><![CDATA[>` 防止提前闭合
 * - 只缩进 open/close 标签行；content 原样不动
 *
 * @ref docs/工程管理/迭代/all/20260423_bugfix_llm_input协议漂移.md
 */

/**
 * XML 节点的中间表示
 *
 * 容器节点（有 children）与叶子节点（有 content）二选一；两者都缺则按自闭合处理。
 */
export interface XmlNode {
  /** 标签名，例如 "system" / "knowledge" / "message" */
  tag: string;
  /** 属性表，顺序按插入顺序渲染（Record 本身在 JS 中保持插入顺序） */
  attrs?: Record<string, string | number>;
  /** 子节点（容器节点使用） */
  children?: XmlNode[];
  /** 原样内容字符串（叶子节点使用，不缩进） */
  content?: string;
  /** 附加注释（在 open 标签前渲染为 <!-- ... -->） */
  comment?: string;
  /** 是否自闭合（渲染为 <tag/>） */
  selfClosing?: boolean;
}

/**
 * XML 属性值转义
 *
 * 属性不能走 CDATA，必须 100% XML 合法。覆盖 `&` `<` `>` `"` 四个字符。
 * 注意：`&` 必须第一个替换，否则会二次编码后续生成的实体。
 */
export function escapeAttr(v: string | number): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 属性表序列化（保留插入顺序，属性值做 XML 实体转义）
 */
export function renderAttrs(attrs?: Record<string, string | number>): string {
  if (!attrs) return "";
  const entries = Object.entries(attrs);
  if (entries.length === 0) return "";
  const parts = entries.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`);
  return parts.join("");
}

/**
 * 判断 content 是否需要 CDATA 包装：只要出现 XML 敏感字符（`<` / `>` / `&`）就需要
 */
export function contentNeedsCdata(content: string): boolean {
  return /[<>&]/.test(content);
}

/**
 * 把 content 包进 CDATA
 *
 * 处理 `]]>` 边界：它不能原样出现在 CDATA 内部（会提前闭合）。标准做法是把 `]]>`
 * 拆成 `]]]]><![CDATA[>`——先闭合一次、再重新开 CDATA 继续。
 */
export function wrapCdata(content: string): string {
  const safe = content.replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
}

/**
 * 将 XmlNode 数组按嵌套层级缩进序列化
 *
 * @param nodes - 要序列化的节点数组（同一层级）
 * @param depth - 当前深度（用于缩进；每一级 2 空格）
 * @returns 序列化后的字符串（行之间以 \n 分隔，末尾无 \n）
 *
 * 关键约束：
 * - 只缩进 open/close 标签行
 * - 叶子 content 原样输出（不缩进、不改换行），仅在包含 `<` `>` `&` 时自动 CDATA 包装
 * - children 为空且无 content 的容器节点使用 selfClosing
 */
export function serializeXml(nodes: XmlNode[], depth = 0): string {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];

  for (const node of nodes) {
    if (node.comment) {
      lines.push(`${indent}<!-- ${node.comment} -->`);
    }

    const attrStr = renderAttrs(node.attrs);

    if (node.selfClosing || (!node.children?.length && !node.content)) {
      lines.push(`${indent}<${node.tag}${attrStr}/>`);
      continue;
    }

    if (node.children && node.children.length > 0) {
      lines.push(`${indent}<${node.tag}${attrStr}>`);
      lines.push(serializeXml(node.children, depth + 1));
      lines.push(`${indent}</${node.tag}>`);
      continue;
    }

    lines.push(`${indent}<${node.tag}${attrStr}>`);
    const raw = node.content ?? "";
    lines.push(contentNeedsCdata(raw) ? wrapCdata(raw) : raw);
    lines.push(`${indent}</${node.tag}>`);
  }

  return lines.join("\n");
}

/**
 * XML 节点的共享数据结构与工具——供 render.ts 调度器与各 window type 的 renderXml hook 共享。
 *
 * 设计：
 * - XmlNode 是渲染层的稳定中间表示；renderXml hook 应返回 `XmlNode[]`（即 window 外壳里
 *   的子节点序列），由 render.ts 拼成最终的 `<window ...>` 元素。
 * - 这里仅放纯函数与类型，不依赖 windows 模块——避免 windows ↔ render 的反向 import。
 */

const INDENT = "  ";

/** 渲染层使用的 XML AST 节点。 */
export type XmlNode =
  | {
      kind: "element";
      tag: string;
      attrs?: Record<string, string>;
      children?: XmlNode[];
    }
  | {
      kind: "text";
      value: string;
    }
  | {
      kind: "comment";
      value: string;
    };

/** 转义 XML 特殊字符，保证 context 内容不会破坏标签结构。 */
export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shouldUseCdata(text: string): boolean {
  return escapeXml(text) !== text;
}

function wrapCdata(text: string): string {
  return `<![CDATA[${text.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function renderXmlTextValue(text: string): string {
  return shouldUseCdata(text) ? wrapCdata(text) : escapeXml(text);
}

function escapeXmlComment(text: string): string {
  return text.replaceAll("--", "- -");
}

/** 构造一个 element 节点。 */
export function xmlElement(
  tag: string,
  attrs: Record<string, string> = {},
  children: XmlNode[] = [],
): XmlNode {
  return { kind: "element", tag, attrs, children };
}

/** 构造一个 text 节点。 */
export function xmlText(value: string): XmlNode {
  return { kind: "text", value };
}

/** 构造一个 comment 节点。 */
export function xmlComment(value: string): XmlNode {
  return { kind: "comment", value };
}

/** value 非空才生成一个 element 节点；否则返回 null。 */
export function optionalElement(tag: string, value: string | undefined): XmlNode | null {
  if (!value) return null;
  return xmlElement(tag, {}, [xmlText(value)]);
}

/** path 列表节点的便捷构造。 */
export function renderPathList(tag: string, paths: string[] | undefined): XmlNode | null {
  if (!paths || paths.length === 0) return null;
  return xmlElement(
    tag,
    {},
    paths.map((path) => xmlElement("path", {}, [xmlText(path)])),
  );
}

/** 把非空 child 节点 push 到 nodes 数组。 */
export function appendNode(nodes: XmlNode[], node: XmlNode | null): void {
  if (node) nodes.push(node);
}

/** 把 XmlNode 树序列化为字符串。 */
export function serializeXml(node: XmlNode, depth = 0): string {
  const indent = INDENT.repeat(depth);

  if (node.kind === "comment") {
    return `${indent}<!-- ${escapeXmlComment(node.value)} -->`;
  }

  if (node.kind === "text") {
    return `${indent}${renderXmlTextValue(node.value)}`;
  }

  const attrs = Object.entries(node.attrs ?? {})
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
  const children = node.children ?? [];

  if (children.length === 0) {
    return `${indent}<${node.tag}${attrs}></${node.tag}>`;
  }

  if (children.length === 1 && children[0]?.kind === "text") {
    return `${indent}<${node.tag}${attrs}>${renderXmlTextValue(children[0].value)}</${node.tag}>`;
  }

  const renderedChildren = children
    .map((child) => serializeXml(child, depth + 1))
    .join("\n");

  return `${indent}<${node.tag}${attrs}>\n${renderedChildren}\n${indent}</${node.tag}>`;
}

const DEFAULT_TRUNCATE_BYTES = 32768;

/** 按字节截断文本（UTF-8 安全）；超过 limit 时在末尾追加 `...[truncated, original N bytes]`。 */
export function truncateBytes(body: string, limit: number = DEFAULT_TRUNCATE_BYTES): string {
  const bytes = new TextEncoder().encode(body);
  if (bytes.length <= limit) return body;
  const head = new TextDecoder().decode(bytes.slice(0, limit));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

/**
 * XML 节点的共享数据结构与工具 —— canonical 源（batch C3 从
 * `thinkable/context/xml.ts` 迁入）。供 render 调度器与各 window type 的
 * renderXml hook 共享。
 *
 * 设计：
 * - XmlNode 是渲染层的稳定中间表示；renderXml hook 应返回 `XmlNode[]`（即 window 外壳里
 *   的子节点序列），由 render 拼成最终的 `<window ...>` 元素。
 * - 这里仅放纯函数与类型，零内部依赖（仅 stdlib `TextEncoder`/`TextDecoder`）。
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

/**
 * 渲染 text 内容：**表意为主，原样输出**——不做 XML 转义、不包 CDATA。
 * 构造给 LLM 的 system prompt 不要求严格合法 XML；转义符号（`&quot;` / `&lt;` / CDATA）
 * 反而会让 LLM 误读内容。结构靠缩进与标签名传达，内容保持人类可读的原文。
 */
function renderXmlTextValue(text: string | undefined | null): string {
  return text ?? "";
}

function escapeXmlComment(text: string | undefined | null): string {
  if (text === undefined || text === null) return "";
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

/** 构造一个 text 节点。null/undefined 转空字符串，避免下游 .replaceAll 崩溃。 */
export function xmlText(value: string | undefined | null): XmlNode {
  return { kind: "text", value: value ?? "" };
}

/** 构造一个 comment 节点。null/undefined 转空字符串。 */
export function xmlComment(value: string | undefined | null): XmlNode {
  return { kind: "comment", value: value ?? "" };
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
    .map(([key, value]) => ` ${key}="${value ?? ""}"`)
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

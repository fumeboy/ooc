/**
 * LLMInputViewer — llm.input.txt 的结构化浏览器
 *
 * 针对 `debug 模式`下 engine 写出的 llm.input.txt（XML 缩进输出，见 Phase 1）
 * 提供树形导航 + 详情面板 + 全文搜索 + token 估算。
 *
 * 布局：
 *  ┌──────────────────────────────────────────────────────┐
 *  │ Header: filename | total chars / est. tokens | search │
 *  ├───────────────┬───────────────────────────────────────┤
 *  │ Tree (30%)    │ Detail (70%)                          │
 *  │               │                                       │
 *  │ ▼ system      │ <knowledge name="self:reporter"       │
 *  │   ▶ identity  │   lifespan="pinned">                  │
 *  │   ▼ knowl..   │   ...content...                       │
 *  │     window×3  │                                       │
 *  │ ▼ user        │                                       │
 *  │   inbox (2)   │                                       │
 *  │   process     │                                       │
 *  └───────────────┴───────────────────────────────────────┘
 *
 * 依赖：
 *  - 浏览器原生 DOMParser 解析 XML
 *  - MarkdownContent 渲染 markdown content
 *  - CodeMirrorViewer 渲染 JSON / 其他
 *  - FileViewerAdapter（fallback）：非 XML 文件回退
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_llm_input_structured_view.md
 */
import { useState, useEffect, useMemo } from "react";
import { useAtomValue } from "jotai";
import { refreshKeyAtom } from "../store/session";
import { fetchFileContent } from "../api/client";
import type { ViewProps } from "../router/registry";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { CodeMirrorViewer } from "../components/ui/CodeMirrorViewer";
import { cn } from "../lib/utils";

/* ========== 数据模型 ========== */

/** 解析后的 XML 节点（前端内部表示） */
interface ParsedNode {
  /** 唯一 id（用于选中 / 展开状态） */
  id: string;
  /** 标签名 */
  tag: string;
  /** 属性键值表 */
  attrs: Record<string, string>;
  /** 子节点（容器节点） */
  children: ParsedNode[];
  /** 叶子内容（仅叶子节点，容器节点为 null） */
  content: string | null;
  /** 深度（用于缩进渲染） */
  depth: number;
  /** 消息角色分段（"system" | "user" | "other"） */
  section: "system" | "user" | "other";
  /** 原始片段字符数（含子树） */
  charCount: number;
}

/**
 * 消息块：--- role --- 开头的大段
 *
 * engine 的 writeDebugLoop 将 Message[] 以下面格式拼接：
 *   --- system ---\n<system>...\n\n--- user ---\n<user>...
 */
interface MessageBlock {
  role: "system" | "user" | "other";
  rawXml: string;
}

/* ========== 解析 ========== */

/**
 * 将 llm.input.txt 的内容切分为消息块
 *
 * 协议历史上有两种格式：
 * 1. 早期：`--- system ---\n<content>\n\n--- user ---\n<content>\n...`
 *    按 `--- <role> ---\n` 分隔。
 * 2. 当前（engine.ts::writeFileSync 实际写法）：直接多根 XML
 *    `<system>...</system>\n\n<user>...</user>`（见 engine.ts 行 1172）
 *    无 role 分隔符，依赖顶层标签名。
 *
 * 容错策略：
 * - 先按 `--- <role> ---` 切；命中 → 返回每块
 * - 未命中：正则扫顶层 `<system>`、`<user>`、`<assistant>` 标签，按位置切块
 * - 都未命中：整体作为单个 "other" 块（fallback 到 parse-error）
 */
function splitMessageBlocks(raw: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  /* 协议 1：按 "--- xxx ---\n" 切分 */
  const rx = /^--- (\w+) ---\n/gm;
  const matches: { role: string; start: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(raw)) !== null) {
    matches.push({ role: m[1]!, start: m.index, contentStart: m.index + m[0].length });
  }
  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i]!;
      const next = matches[i + 1];
      const end = next ? next.start : raw.length;
      const body = raw.slice(cur.contentStart, end).trim();
      const role = (cur.role === "system" || cur.role === "user") ? cur.role : "other";
      blocks.push({ role, rawXml: body });
    }
    return blocks;
  }

  /* 协议 2：直接多根 XML `<role>...</role>`。
   * 用简单 tag 扫描（不嵌套同名 role tag 在实际输出里不会出现）：
   * 匹配 `<(system|user|assistant)[\s>]` 作为起点，查找对应 `</role>`。 */
  const roleRx = /<(system|user|assistant)(?:\s[^>]*)?>/g;
  const starts: { role: string; start: number }[] = [];
  let rm: RegExpExecArray | null;
  while ((rm = roleRx.exec(raw)) !== null) {
    starts.push({ role: rm[1]!, start: rm.index });
  }
  if (starts.length > 0) {
    for (let i = 0; i < starts.length; i++) {
      const cur = starts[i]!;
      const closeTag = `</${cur.role}>`;
      const closeIdx = raw.indexOf(closeTag, cur.start);
      const end = closeIdx >= 0 ? closeIdx + closeTag.length : (starts[i + 1]?.start ?? raw.length);
      const body = raw.slice(cur.start, end).trim();
      const role = (cur.role === "system" || cur.role === "user") ? cur.role : "other";
      blocks.push({ role, rawXml: body });
    }
    return blocks;
  }

  /* 协议 3：无任何识别 → 整体 fallback */
  blocks.push({ role: "other", rawXml: raw });
  return blocks;
}

/** 递归将 DOM 节点转换为 ParsedNode */
function domToParsed(
  el: Element,
  depth: number,
  section: ParsedNode["section"],
  idSeed: { next: number },
): ParsedNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    attrs[a.name] = a.value;
  }

  /* 提取 Element 子节点（过滤 text/comment） */
  const childEls: Element[] = [];
  for (const c of Array.from(el.children)) {
    childEls.push(c);
  }

  const id = `n${idSeed.next++}`;

  if (childEls.length === 0) {
    /* 叶子节点：读取 textContent */
    const content = el.textContent ?? "";
    return {
      id,
      tag: el.tagName,
      attrs,
      children: [],
      content,
      depth,
      section,
      charCount: content.length,
    };
  }

  const children = childEls.map(c => domToParsed(c, depth + 1, section, idSeed));
  const charCount = children.reduce((s, c) => s + c.charCount, 0);
  return {
    id,
    tag: el.tagName,
    attrs,
    children,
    content: null,
    depth,
    section,
    charCount,
  };
}

/**
 * 解析整个 llm.input.txt
 *
 * @returns 一个“虚拟根节点”列表（每个 MessageBlock → 一个顶层节点）
 *          解析失败时返回 null，交由 fallback 渲染。
 */
function parseLLMInput(raw: string): ParsedNode[] | null {
  try {
    const blocks = splitMessageBlocks(raw);
    const parser = new DOMParser();
    const roots: ParsedNode[] = [];
    const idSeed = { next: 0 };

    /** 尝试 parse 一段 XML；失败时包一层 <ooc-root> 再 parse（覆盖多根场景） */
    const tryParse = (xml: string): Element | null => {
      const doc1 = parser.parseFromString(xml, "application/xml");
      const err1 = doc1.getElementsByTagName("parsererror")[0];
      if (!err1 && doc1.documentElement) return doc1.documentElement;
      /* 包根再试 */
      const wrapped = `<ooc-root>${xml}</ooc-root>`;
      const doc2 = parser.parseFromString(wrapped, "application/xml");
      const err2 = doc2.getElementsByTagName("parsererror")[0];
      if (!err2 && doc2.documentElement) return doc2.documentElement;
      return null;
    };

    for (const block of blocks) {
      const rootEl = tryParse(block.rawXml);
      if (!rootEl) {
        /* 本块仍失败 → 伪叶子保住整体 */
        roots.push({
          id: `n${idSeed.next++}`,
          tag: `${block.role}(parse-error)`,
          attrs: {},
          children: [],
          content: block.rawXml,
          depth: 0,
          section: block.role,
          charCount: block.rawXml.length,
        });
        continue;
      }
      /* 若根是我们包的 <ooc-root>：把其子节点各自当 root push（保留多根结构） */
      if (rootEl.tagName === "ooc-root") {
        for (const c of Array.from(rootEl.children)) {
          roots.push(domToParsed(c, 0, block.role, idSeed));
        }
        continue;
      }
      roots.push(domToParsed(rootEl, 0, block.role, idSeed));
    }

    if (roots.length === 0) return null;
    return roots;
  } catch {
    return null;
  }
}

/* ========== token 估算 ========== */

/** 粗略 token 估算：len / 4 ≈ 英文 token 数；中文字符约 1:1。取折中 len/3。 */
function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3);
}

/* ========== UI 工具 ========== */

/** 计算节点展示名（含关键属性徽标） */
function renderNodeLabel(node: ParsedNode): string {
  const { tag, attrs } = node;
  const keyAttrs: string[] = [];
  if (attrs.name) keyAttrs.push(attrs.name);
  if (attrs.id) keyAttrs.push(`id=${attrs.id.slice(0, 10)}…`);
  if (attrs.command) keyAttrs.push(`cmd=${attrs.command}`);
  if (attrs.from && !attrs.name) keyAttrs.push(`from=${attrs.from}`);
  if (attrs.status) keyAttrs.push(attrs.status);
  return keyAttrs.length > 0 ? `${tag} (${keyAttrs.join(", ")})` : tag;
}

/** 小徽标：pinned / unread / marked */
function NodeBadges({ node }: { node: ParsedNode }) {
  const badges: { label: string; cls: string }[] = [];
  if (node.attrs.lifespan === "pinned") badges.push({ label: "📌", cls: "bg-yellow-100 text-yellow-700" });
  if (node.attrs.status === "unread") badges.push({ label: "unread", cls: "bg-red-100 text-red-600" });
  if (node.attrs.status === "marked") badges.push({ label: "marked", cls: "bg-blue-100 text-blue-700" });
  if (node.attrs.unread && Number(node.attrs.unread) > 0) badges.push({ label: `${node.attrs.unread} unread`, cls: "bg-red-100 text-red-600" });
  return (
    <span className="inline-flex gap-1 ml-1">
      {badges.map((b, i) => (
        <span key={i} className={cn("text-[9px] px-1 py-px rounded", b.cls)}>{b.label}</span>
      ))}
    </span>
  );
}

/* ========== 树形组件（递归） ========== */

interface TreeNodeProps {
  node: ParsedNode;
  selectedId: string | null;
  onSelect: (node: ParsedNode) => void;
  expanded: Set<string>;
  toggleExpanded: (id: string) => void;
  searchQuery: string;
}

function TreeNode({ node, selectedId, onSelect, expanded, toggleExpanded, searchQuery }: TreeNodeProps) {
  const isExpanded = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;

  /* 搜索：当前节点匹配（标签 / 属性值 / content） */
  const matchesSearch = useMemo(() => {
    if (!searchQuery) return false;
    const q = searchQuery.toLowerCase();
    if (node.tag.toLowerCase().includes(q)) return true;
    for (const v of Object.values(node.attrs)) {
      if (v.toLowerCase().includes(q)) return true;
    }
    if (node.content && node.content.toLowerCase().includes(q)) return true;
    return false;
  }, [searchQuery, node]);

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer text-xs group",
          isSelected ? "bg-[var(--primary)]/10 text-[var(--primary)] font-medium" : "hover:bg-[var(--accent)]",
          matchesSearch && !isSelected && "bg-yellow-50",
        )}
        style={{ paddingLeft: `${node.depth * 10 + 6}px` }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggleExpanded(node.id); }}
            className="w-4 h-4 flex items-center justify-center text-[var(--muted-foreground)] shrink-0"
          >
            {isExpanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}
        <span className="font-mono truncate flex-1">{renderNodeLabel(node)}</span>
        <NodeBadges node={node} />
        <span className="text-[9px] text-[var(--muted-foreground)] opacity-60 group-hover:opacity-100 shrink-0">
          {node.charCount}
        </span>
      </div>
      {hasChildren && isExpanded && (
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
              searchQuery={searchQuery}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/* ========== 详情面板 ========== */

function DetailPanel({ node, searchQuery }: { node: ParsedNode | null; searchQuery: string }) {
  if (!node) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">在左侧选择节点查看内容</p>
      </div>
    );
  }

  /* 元数据头部 */
  const attrRows = Object.entries(node.attrs);
  const charCount = node.charCount;
  const tokens = estimateTokens(charCount);

  /* 内容：叶子节点渲染 content；容器节点渲染子节点的 XML 概览 */
  const isLeaf = node.content !== null;

  /* 判断内容类型：markdown / json / 其他 */
  const content = node.content ?? "";
  const looksLikeMarkdown = isLeaf && (
    content.includes("# ") || content.includes("## ") || content.includes("```") || content.includes("| ")
  );
  const looksLikeJson = isLeaf && (content.trim().startsWith("{") || content.trim().startsWith("["));

  /* 搜索高亮（简单替换为 <mark>） */
  const highlighted = useMemo(() => {
    if (!searchQuery || !isLeaf) return content;
    const q = searchQuery;
    const idx = content.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return content;
    return content;
    /* Markdown/CodeMirror 内部渲染不便做高亮；此处保留原文，靠视觉搜索即可 */
  }, [content, searchQuery, isLeaf]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-[var(--border)] shrink-0 bg-[var(--accent)]/30">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium">&lt;{node.tag}&gt;</span>
          <NodeBadges node={node} />
          <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">
            {charCount.toLocaleString()} chars · ~{tokens.toLocaleString()} tokens
          </span>
        </div>
        {attrRows.length > 0 && (
          <div className="mt-2 text-[11px] grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {attrRows.map(([k, v]) => (
              <span key={k} className="contents">
                <span className="font-mono text-[var(--muted-foreground)]">{k}:</span>
                <span className="font-mono truncate">{v}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {isLeaf ? (
          looksLikeMarkdown ? (
            <div className="p-4 prose prose-sm max-w-none">
              <MarkdownContent content={highlighted} />
            </div>
          ) : looksLikeJson ? (
            <CodeMirrorViewer content={highlighted} ext="json" />
          ) : (
            <pre className="p-4 text-xs whitespace-pre-wrap font-mono">{highlighted}</pre>
          )
        ) : (
          <div className="p-4 text-xs text-[var(--muted-foreground)]">
            容器节点（{node.children.length} 个子节点）。从左侧树选择子节点查看内容。
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== 主组件 ========== */

/** LLMInputViewer 适配器：由 ViewRegistry 调用 */
export function LLMInputViewerAdapter({ path }: ViewProps) {
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshKey = useAtomValue(refreshKeyAtom);

  useEffect(() => {
    setRaw(null);
    setError(null);
    fetchFileContent(path)
      .then(setRaw)
      .catch((e) => setError((e as Error).message));
  }, [path, refreshKey]);

  const parsed = useMemo(() => (raw ? parseLLMInput(raw) : null), [raw]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  /* 默认：展开所有顶层节点（<system>/<user>） */
  useEffect(() => {
    if (parsed) {
      const init = new Set<string>();
      for (const root of parsed) init.add(root.id);
      setExpanded(init);
    }
  }, [parsed]);

  /* 查找选中节点 */
  const selectedNode = useMemo(() => {
    if (!parsed || !selectedId) return null;
    const stack: ParsedNode[] = [...parsed];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.id === selectedId) return n;
      for (const c of n.children) stack.push(c);
    }
    return null;
  }, [parsed, selectedId]);

  /* 汇总统计 */
  const stats = useMemo(() => {
    if (!parsed) return { totalChars: 0, totalTokens: 0, topSections: 0 };
    const totalChars = parsed.reduce((s, r) => s + r.charCount, 0);
    return { totalChars, totalTokens: estimateTokens(totalChars), topSections: parsed.length };
  }, [parsed]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* 搜索：展开所有路径到匹配节点 */
  useEffect(() => {
    if (!searchQuery || !parsed) return;
    const q = searchQuery.toLowerCase();
    const toExpand = new Set(expanded);
    const walk = (node: ParsedNode, ancestors: string[]): boolean => {
      const matches =
        node.tag.toLowerCase().includes(q) ||
        Object.values(node.attrs).some(v => v.toLowerCase().includes(q)) ||
        (node.content?.toLowerCase().includes(q) ?? false);
      let descendantMatches = false;
      for (const c of node.children) {
        if (walk(c, [...ancestors, node.id])) descendantMatches = true;
      }
      if (descendantMatches) {
        for (const a of [...ancestors, node.id]) toExpand.add(a);
      }
      return matches || descendantMatches;
    };
    for (const root of parsed) walk(root, []);
    setExpanded(toExpand);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [searchQuery, parsed]);

  if (error) {
    return <div className="flex items-center justify-center h-full"><p className="text-sm text-red-500">{error}</p></div>;
  }
  if (raw === null) {
    return <div className="flex items-center justify-center h-full"><p className="text-sm text-[var(--muted-foreground)]">加载中...</p></div>;
  }
  if (!parsed) {
    /* 解析失败 fallback：当作普通文件渲染 */
    return (
      <div className="h-full flex flex-col">
        <div className="px-3 py-2 bg-yellow-50 border-b border-yellow-200 text-[11px] text-yellow-800">
          文件不是有效的 XML 结构，已降级为纯文本视图。
        </div>
        <div className="flex-1 min-h-0">
          <CodeMirrorViewer content={raw} ext="txt" />
        </div>
      </div>
    );
  }

  const fileName = path.split("/").pop() ?? path;

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <div className="px-4 py-2 border-b border-[var(--border)] shrink-0 bg-[var(--accent)]/20">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-xs font-medium truncate">{fileName}</span>
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {stats.totalChars.toLocaleString()} chars · ~{stats.totalTokens.toLocaleString()} tokens · {stats.topSections} blocks
          </span>
          <input
            type="search"
            placeholder="搜索（标签 / 属性 / 内容）"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ml-auto px-2 py-1 text-xs border border-[var(--border)] rounded-md bg-[var(--card)] w-48 sm:w-64 outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>
      {/* 主区：左树 + 右详情 */}
      <div className="flex-1 min-h-0 flex">
        <div className="w-[34%] min-w-[240px] max-w-[420px] border-r border-[var(--border)] overflow-auto py-2">
          <ul>
            {parsed.map((root) => (
              <TreeNode
                key={root.id}
                node={root}
                selectedId={selectedId}
                onSelect={(n) => setSelectedId(n.id)}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                searchQuery={searchQuery}
              />
            ))}
          </ul>
        </div>
        <div className="flex-1 min-w-0">
          <DetailPanel node={selectedNode} searchQuery={searchQuery} />
        </div>
      </div>
    </div>
  );
}

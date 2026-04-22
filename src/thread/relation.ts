/**
 * 关系文件读取与索引渲染（Phase 5）
 *
 * 每个对象在自己的 relations/ 目录下持有与 peer 的关系文件。
 * stone 场景：stones/{self}/relations/{peer}.md
 * flow obj 场景：flows/{sid}/objects/{self}/relations/{peer}.md（Phase 7 接入）
 *
 * 关系文件用 markdown + frontmatter：
 *
 *   ---
 *   summary: 一行式概述（显示到索引行）
 *   tags: [engineering, kernel]
 *   last_updated: 2026-04-23
 *   updated_by: supervisor
 *   ---
 *
 *   # 与 {peer} 的关系说明
 *   ## 协作规矩
 *   ...
 *
 * <relations> 索引行按如下降级链生成显示文案：
 * 1) frontmatter.summary
 * 2) 正文（剥 frontmatter）首行非空文本
 * 3) 文件名（`{peer}.md`）
 *
 * 设计：
 * - 文件不存在 → "(无关系记录)"
 * - 读取失败 → "(读取失败)"
 * - LLM 需要全文时 open(path="@relation:<peer>") 自行取
 *
 * @ref docs/superpowers/specs/2026-04-23-three-phase-trait-activation-design.md#第三部分-target终点
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

/** 一条 peer 索引行的结构化描述 */
export interface PeerRelationEntry {
  /** peer 对象名（显示在 <peer name="..."> 的属性中） */
  name: string;
  /** 索引行显示文案（降级链决定） */
  summary: string;
  /** 指示是否存在 relation 文件（用于 inject 区分"缺失"与"有但空"） */
  hasFile: boolean;
}

/** relation 目录定位上下文（与 virtual-path 保持对称） */
export interface RelationLocateContext {
  /** 项目根目录 */
  rootDir: string;
  /** 当前对象名（self） */
  selfName: string;
  /** 当前对象类型：stone（默认）或 flow_obj */
  selfKind?: "stone" | "flow_obj";
  /** selfKind="flow_obj" 时必须提供的 session ID */
  sessionId?: string;
}

/**
 * 定位 relation 文件绝对路径
 *
 * @returns 绝对路径字符串；定位条件不足时返回 null
 */
export function locateRelationFile(
  peer: string,
  ctx: RelationLocateContext,
): string | null {
  if (!peer) return null;
  const { rootDir, selfName, selfKind, sessionId } = ctx;
  if (selfKind === "flow_obj") {
    if (!sessionId) return null;
    return join(
      rootDir,
      "flows",
      sessionId,
      "objects",
      selfName,
      "relations",
      `${peer}.md`,
    );
  }
  return join(rootDir, "stones", selfName, "relations", `${peer}.md`);
}

/**
 * 读取某个 peer 的关系索引条目
 *
 * 不抛异常：读取失败 / 文件不存在 / frontmatter 解析错误都降级为合理默认。
 */
export function readPeerRelation(
  peer: string,
  ctx: RelationLocateContext,
): PeerRelationEntry {
  const path = locateRelationFile(peer, ctx);
  if (!path || !existsSync(path)) {
    return { name: peer, summary: "(无关系记录)", hasFile: false };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = matter(raw);
    const fm = parsed.data ?? {};
    const body = (parsed.content ?? "").trim();

    /* 1) frontmatter.summary */
    if (typeof fm.summary === "string" && fm.summary.trim()) {
      return { name: peer, summary: fm.summary.trim(), hasFile: true };
    }

    /* 2) 正文首行非空文本（剥 markdown heading 的 #） */
    if (body) {
      const firstLine = body.split(/\r?\n/).find((l) => l.trim().length > 0);
      if (firstLine) {
        const cleaned = firstLine.replace(/^#+\s*/, "").trim();
        if (cleaned) return { name: peer, summary: cleaned, hasFile: true };
      }
    }

    /* 3) 文件名 fallback */
    return { name: peer, summary: `${peer}.md`, hasFile: true };
  } catch {
    return { name: peer, summary: "(读取失败)", hasFile: true };
  }
}

/**
 * 批量读取 peers，用于 <relations> 索引渲染
 */
export function readPeerRelations(
  peers: string[],
  ctx: RelationLocateContext,
): PeerRelationEntry[] {
  return peers.map((p) => readPeerRelation(p, ctx));
}

/**
 * 渲染 <relations> XML 索引片段（含外层 <relations> 标签）
 *
 * 示例输出：
 *   <relations>
 *     <peer name="kernel">OOC 核心工程部，TDD 流程 + 哲学审查</peer>
 *     <peer name="sophia">哲学设计部，所有 G/E 编号变更必经</peer>
 *     <peer name="bruce">(无关系记录)</peer>
 *   </relations>
 *
 * 边界：
 * - peers 为空 → 返回空串（调用方决定是否把整个块省略）
 * - peer summary 含 XML 特殊字符：做最小转义（&amp; &lt; &gt;），不转引号（文案里不该用）
 */
export function renderRelationsIndex(
  peers: string[],
  ctx: RelationLocateContext,
): string {
  if (peers.length === 0) return "";
  const inner = renderRelationsIndexInner(peers, ctx);
  return `<relations>\n${inner}\n</relations>`;
}

/**
 * 渲染 <relations> 的内部 <peer> 行（不含外层 <relations> 标签）
 *
 * 便于 engine 的 XML 序列化器在 <relations> 容器内直接 content 注入。
 */
export function renderRelationsIndexInner(
  peers: string[],
  ctx: RelationLocateContext,
): string {
  if (peers.length === 0) return "";
  const entries = readPeerRelations(peers, ctx);
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`  <peer name="${escapeAttr(e.name)}">${escapeText(e.summary)}</peer>`);
  }
  return lines.join("\n");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

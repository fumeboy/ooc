/**
 * LLM Input Diff —— llm.input.txt 的结构化对比核心
 *
 * 核心抽象：
 * - ParsedNode：统一的 XML 节点前端模型（见 LLMInputViewer.tsx）
 * - DiffStatus：每个节点在对比视图下的状态（unchanged / added / removed / changed）
 * - computeNodeDiff(leftRoots, rightRoots)：给两侧的 ParsedNode 森林打上 diff tag
 *
 * Phase 2 设计：**Node 级 path-based diff，不做行级 diff**
 * - 按 tag + key attribute（name/id/command 优先）生成节点 key
 * - 左右两侧按 key 对齐；只在一侧存在 → added / removed；两侧都在 → 递归 diff 子节点
 * - 叶子节点比内容：完全一致 → unchanged；否则 changed（属性或 content 变更）
 * - 父节点：子节点里只要有一个不是 unchanged，父标记 changed（视觉上级联高亮）
 *
 * 独立模块的好处：
 * - 可被 bun:test 单测（无 React 依赖）
 * - LLMInputViewer.tsx 只做渲染，diff 逻辑集中
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_llm_input_viewer_phase3.md
 */

/** 前端 ParsedNode 与 LLMInputViewer 保持一致 */
export interface ParsedNode {
  id: string;
  tag: string;
  attrs: Record<string, string>;
  children: ParsedNode[];
  content: string | null;
  depth: number;
  section: "system" | "user" | "other";
  charCount: number;
}

/** 一个节点在 diff 下的状态 */
export type DiffStatus = "unchanged" | "added" | "removed" | "changed";

/** diff 结果：给每个节点 id 打 tag */
export interface DiffMap {
  /** 左侧树（base）每个 id 的 diff 状态 */
  left: Map<string, DiffStatus>;
  /** 右侧树（compare）每个 id 的 diff 状态 */
  right: Map<string, DiffStatus>;
}

/**
 * 生成节点 key：优先级 attrs.name > attrs.id > attrs.command > tag + 位置下标
 *
 * 用于同层级下两侧节点的对齐。同一父节点下同 tag+name 认为是"同一节点"。
 * 没有 key attrs 的节点使用 tag + 同 tag 内的序号（位置对齐，避免误匹配）。
 */
export function nodeKey(node: ParsedNode, indexAmongSameTag: number): string {
  const { tag, attrs } = node;
  if (attrs.name) return `${tag}#name=${attrs.name}`;
  if (attrs.id) return `${tag}#id=${attrs.id}`;
  if (attrs.command) return `${tag}#command=${attrs.command}`;
  /* 退化：tag + 位置 */
  return `${tag}#idx=${indexAmongSameTag}`;
}

/** 在同一父节点下为每个子节点生成带位置信息的 key */
function keyedChildren(children: ParsedNode[]): Map<string, ParsedNode> {
  const result = new Map<string, ParsedNode>();
  const tagCounter = new Map<string, number>();
  for (const c of children) {
    const idx = tagCounter.get(c.tag) ?? 0;
    tagCounter.set(c.tag, idx + 1);
    const k = nodeKey(c, idx);
    /* 如果 key 冲突（同 name 出现两次），附加位置 */
    if (result.has(k)) {
      result.set(`${k}@${idx}`, c);
    } else {
      result.set(k, c);
    }
  }
  return result;
}

/** 属性表浅比较 */
function attrsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/** 判断两个节点是否"本节点层"等价（不比较子节点） */
function isSelfUnchanged(a: ParsedNode, b: ParsedNode): boolean {
  if (a.tag !== b.tag) return false;
  if (!attrsEqual(a.attrs, b.attrs)) return false;
  if ((a.content ?? null) !== (b.content ?? null)) return false;
  return true;
}

/** 递归把子树所有节点标记为同一状态（add / remove 时整棵树都该是该状态） */
function markSubtree(node: ParsedNode, status: DiffStatus, sink: Map<string, DiffStatus>): void {
  sink.set(node.id, status);
  for (const c of node.children) markSubtree(c, status, sink);
}

/** 递归 diff 两侧节点（假设它们按 key 对齐）；返回是否有差异 */
function diffNode(
  left: ParsedNode,
  right: ParsedNode,
  leftMap: Map<string, DiffStatus>,
  rightMap: Map<string, DiffStatus>,
): boolean {
  const selfEqual = isSelfUnchanged(left, right);

  /* 叶子节点（两侧都是叶子） */
  if (left.children.length === 0 && right.children.length === 0) {
    const status: DiffStatus = selfEqual ? "unchanged" : "changed";
    leftMap.set(left.id, status);
    rightMap.set(right.id, status);
    return status !== "unchanged";
  }

  /* 容器节点：按 key 对齐子节点 */
  const leftKeys = keyedChildren(left.children);
  const rightKeys = keyedChildren(right.children);
  let childChanged = false;

  /* 遍历 leftKeys：左有右有 → 递归 diff；左有右无 → removed */
  for (const [k, lc] of leftKeys) {
    const rc = rightKeys.get(k);
    if (!rc) {
      markSubtree(lc, "removed", leftMap);
      childChanged = true;
    } else {
      if (diffNode(lc, rc, leftMap, rightMap)) childChanged = true;
    }
  }

  /* 遍历 rightKeys：左无右有 → added */
  for (const [k, rc] of rightKeys) {
    if (!leftKeys.has(k)) {
      markSubtree(rc, "added", rightMap);
      childChanged = true;
    }
  }

  /* 本节点：若自身属性/tag 有变，或任一子节点有变 → changed；否则 unchanged */
  const status: DiffStatus = selfEqual && !childChanged ? "unchanged" : "changed";
  leftMap.set(left.id, status);
  rightMap.set(right.id, status);
  return status !== "unchanged";
}

/**
 * 对两侧的 ParsedNode 森林做 path-based Node diff
 *
 * @param leftRoots - base 侧的顶层节点（parseLLMInput 的输出）
 * @param rightRoots - compare 侧的顶层节点
 * @returns DiffMap：左右两侧每个节点 id → DiffStatus
 */
export function computeNodeDiff(leftRoots: ParsedNode[], rightRoots: ParsedNode[]): DiffMap {
  const leftMap = new Map<string, DiffStatus>();
  const rightMap = new Map<string, DiffStatus>();

  /* 顶层节点按 key 对齐（通常 <system>/<user>/<active-forms> 等） */
  const leftKeys = keyedChildren(leftRoots);
  const rightKeys = keyedChildren(rightRoots);

  for (const [k, lc] of leftKeys) {
    const rc = rightKeys.get(k);
    if (!rc) {
      markSubtree(lc, "removed", leftMap);
    } else {
      diffNode(lc, rc, leftMap, rightMap);
    }
  }
  for (const [k, rc] of rightKeys) {
    if (!leftKeys.has(k)) {
      markSubtree(rc, "added", rightMap);
    }
  }

  return { left: leftMap, right: rightMap };
}

/** 小工具：递归 flat 所有节点（测试用） */
export function flattenNodes(roots: ParsedNode[]): ParsedNode[] {
  const result: ParsedNode[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const n = stack.pop()!;
    result.push(n);
    for (const c of n.children) stack.push(c);
  }
  return result;
}

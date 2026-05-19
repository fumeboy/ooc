/**
 * walk-concepts — 遍历 meta 树，识别"概念对象"。
 *
 * "概念对象"的判定规则：同一对象上同时存在 `name: string` + `description: string`
 * + `sources: object`（非空 Record） 这三件套即为概念。聚合层（如 executable_v...
 * 顶层、tools_v... 顶层）通常是 `{ description, concepts, tools, ... }` 形态——
 * 没有 `name` 字段 → 不是概念，但其 children 仍会被递归。
 *
 * 关键约束：meta 大量使用 `get parent() { return ... }` getter 形成反向链路，
 * 直接 BFS 会无限递归。这里用 visited Set 按 object identity 去重。
 */

export interface ConceptShape {
  name: string;
  description: string;
  sources: Record<string, unknown>;
}

export interface WalkedConcept {
  /** 在 meta 树中的访问路径，如 "executable.concepts.contextWindow"。 */
  path: string;
  /** 概念对象本身。 */
  concept: ConceptShape;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConcept(value: unknown): value is ConceptShape {
  if (!isPlainObject(value)) return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.description !== "string") return false;
  if (!isPlainObject(value.sources)) return false;
  return true;
}

const SKIP_KEYS = new Set(["parent", "sources", "refs"]);

/**
 * 递归遍历 root，收集所有概念对象。
 *
 * - 对每个 plain-object 节点：先判定是否是概念（满足 schema），是则记录
 * - 然后无条件下钻所有非 SKIP_KEYS 的 plain-object 字段
 *   （aggregator 既可以是概念也可以是子树容器，例如 tools_v...
 *    自己是概念，同时把 open/refine/submit 等暴露在子字段上）
 * - SKIP_KEYS 跳过：parent（避免反向链路）、sources（其值是 module
 *   namespace，不应被当作子概念遍历）、refs（跨概念引用，目标概念会在它自己
 *   原生路径下被发现，refs 仅作渲染层链接用——不下钻避免重复发现与精确路径
 *   断言被破坏）
 * - visited Set 按对象 identity 去重，破任何 getter 形成的循环
 */
export function walkConcepts(root: unknown, rootPath = "root"): WalkedConcept[] {
  const out: WalkedConcept[] = [];
  const visited = new WeakSet<object>();

  const visit = (value: unknown, path: string): void => {
    if (!isPlainObject(value)) return;
    if (visited.has(value)) return;
    visited.add(value);

    if (isConcept(value)) {
      out.push({ path, concept: value });
    }

    for (const [key, child] of Object.entries(value)) {
      if (SKIP_KEYS.has(key)) continue;
      visit(child, `${path}.${key}`);
    }
  };

  visit(root, rootPath);
  return out;
}

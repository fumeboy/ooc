/**
 * test-utils — Round 10 F3.
 *
 * Web 工程未装 React Testing Library / DOM env；这些 helpers 把 React element
 * 树深扫描，并把"自定义 component element"按函数 component 调用展开到 host-level
 * DOM 元素，才能 hit 到挂在最终 div/span 上的 data-* 属性。
 *
 * 仅供 *.test.ts 使用；生产代码请勿引用。
 */

export function countByStatus(node: unknown, status: string): number {
  if (!node) return 0;
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return 0;
  if (Array.isArray(node)) {
    let sum = 0;
    for (const c of node) sum += countByStatus(c, status);
    return sum;
  }
  if (typeof node !== "object") return 0;
  const el = node as Record<string, unknown>;
  let count = 0;
  if (typeof el.type === "string" && el.props && typeof el.props === "object") {
    const props = el.props as Record<string, unknown>;
    if (props["data-diff-status"] === status) count += 1;
    if (props.children !== undefined) count += countByStatus(props.children, status);
    return count;
  }
  if (typeof el.type === "function") {
    try {
      const rendered = (el.type as (p: unknown) => unknown)(el.props ?? {});
      count += countByStatus(rendered, status);
    } catch {
      // 调用 component 失败（需要 hooks / DOM ）→ 跳过
    }
    return count;
  }
  if (el.props && typeof el.props === "object") {
    const props = el.props as Record<string, unknown>;
    if (props.children !== undefined) count += countByStatus(props.children, status);
  }
  return count;
}

export function containsText(node: unknown, text: string): boolean {
  if (typeof node === "string") return node.includes(text);
  if (typeof node === "number") return String(node).includes(text);
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) {
    for (const c of node) if (containsText(c, text)) return true;
    return false;
  }
  const el = node as Record<string, unknown>;
  if (typeof el.type === "function") {
    try {
      const rendered = (el.type as (p: unknown) => unknown)(el.props ?? {});
      if (containsText(rendered, text)) return true;
    } catch {
      // 跳过
    }
  }
  if (el.props && typeof el.props === "object") {
    const props = el.props as Record<string, unknown>;
    if (props.children !== undefined && containsText(props.children, text)) return true;
  }
  return false;
}

export function findTestId(node: unknown, testId: string): boolean {
  if (!node) return false;
  if (Array.isArray(node)) {
    for (const c of node) if (findTestId(c, testId)) return true;
    return false;
  }
  if (typeof node !== "object") return false;
  const el = node as Record<string, unknown>;
  if (typeof el.type === "function") {
    try {
      const rendered = (el.type as (p: unknown) => unknown)(el.props ?? {});
      if (findTestId(rendered, testId)) return true;
    } catch {
      // 跳过
    }
  }
  if (el.props && typeof el.props === "object") {
    const props = el.props as Record<string, unknown>;
    if (props["data-testid"] === testId) return true;
    if (props.children !== undefined && findTestId(props.children, testId)) return true;
  }
  return false;
}

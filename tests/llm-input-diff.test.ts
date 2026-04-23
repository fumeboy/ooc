/**
 * LLM Input 对比视图核心单测（Phase 2 — llm_input_viewer）
 *
 * 验证 computeNodeDiff 的 path-based Node diff：
 * - 两边完全一致 → 全 unchanged
 * - 左侧多出的子节点 → 右侧没有，左侧 removed
 * - 右侧多出的子节点 → 右侧 added
 * - 属性变更 → 该节点 changed（父节点级联 changed）
 * - 内容变更 → 叶子 changed
 */
import { describe, test, expect } from "bun:test";
import { computeNodeDiff, nodeKey, type ParsedNode } from "../web/src/features/llm-input-diff.ts";

/** 构造最小 ParsedNode（测试辅助） */
function mkNode(
  id: string,
  tag: string,
  opts?: {
    attrs?: Record<string, string>;
    children?: ParsedNode[];
    content?: string | null;
  },
): ParsedNode {
  return {
    id,
    tag,
    attrs: opts?.attrs ?? {},
    children: opts?.children ?? [],
    content: opts?.content ?? (opts?.children && opts.children.length > 0 ? null : ""),
    depth: 0,
    section: "system",
    charCount: (opts?.content ?? "").length,
  };
}

describe("computeNodeDiff", () => {
  test("两棵相同树 → 全部 unchanged", () => {
    const left: ParsedNode[] = [
      mkNode("l1", "system", { children: [
        mkNode("l2", "identity", { attrs: { name: "alice" }, content: "hi" }),
      ]}),
    ];
    const right: ParsedNode[] = [
      mkNode("r1", "system", { children: [
        mkNode("r2", "identity", { attrs: { name: "alice" }, content: "hi" }),
      ]}),
    ];
    const diff = computeNodeDiff(left, right);
    expect(diff.left.get("l1")).toBe("unchanged");
    expect(diff.left.get("l2")).toBe("unchanged");
    expect(diff.right.get("r1")).toBe("unchanged");
    expect(diff.right.get("r2")).toBe("unchanged");
  });

  test("右侧新增子节点 → 右侧 added；父 changed", () => {
    const left: ParsedNode[] = [
      mkNode("l1", "user", { children: [
        mkNode("l2", "inbox", { children: [] }),
      ]}),
    ];
    const right: ParsedNode[] = [
      mkNode("r1", "user", { children: [
        mkNode("r2", "inbox", { children: [
          mkNode("r3", "message", { attrs: { id: "m1" }, content: "hello" }),
        ]}),
      ]}),
    ];
    const diff = computeNodeDiff(left, right);
    expect(diff.right.get("r3")).toBe("added");
    expect(diff.right.get("r2")).toBe("changed");
    expect(diff.right.get("r1")).toBe("changed");
    /* 左侧 inbox 容器本身没变，但子节点集合变化导致 changed */
    expect(diff.left.get("l2")).toBe("changed");
    expect(diff.left.get("l1")).toBe("changed");
  });

  test("左侧独有子节点 → 左侧 removed", () => {
    const left: ParsedNode[] = [
      mkNode("l1", "system", { children: [
        mkNode("l2", "instructions", { children: [
          mkNode("l3", "instruction", { attrs: { name: "kernel:base" }, content: "..." }),
          mkNode("l4", "instruction", { attrs: { name: "kernel:extra" }, content: "..." }),
        ]}),
      ]}),
    ];
    const right: ParsedNode[] = [
      mkNode("r1", "system", { children: [
        mkNode("r2", "instructions", { children: [
          mkNode("r3", "instruction", { attrs: { name: "kernel:base" }, content: "..." }),
        ]}),
      ]}),
    ];
    const diff = computeNodeDiff(left, right);
    expect(diff.left.get("l4")).toBe("removed");
    expect(diff.left.get("l3")).toBe("unchanged");
    expect(diff.left.get("l2")).toBe("changed");
  });

  test("叶子 content 变更 → 叶子 changed，父级联 changed", () => {
    const left: ParsedNode[] = [
      mkNode("l1", "user", { children: [
        mkNode("l2", "status", { content: "running" }),
      ]}),
    ];
    const right: ParsedNode[] = [
      mkNode("r1", "user", { children: [
        mkNode("r2", "status", { content: "done" }),
      ]}),
    ];
    const diff = computeNodeDiff(left, right);
    expect(diff.left.get("l2")).toBe("changed");
    expect(diff.right.get("r2")).toBe("changed");
    expect(diff.left.get("l1")).toBe("changed");
  });

  test("属性变更（同 tag+name，其他属性变） → changed", () => {
    /* 同 name 对齐，但 lifespan/source 变 → 属性差异 */
    const left: ParsedNode[] = [
      mkNode("l1", "knowledge", { children: [
        mkNode("l2", "window", { attrs: { name: "self:reporter", lifespan: "transient" }, content: "x" }),
      ]}),
    ];
    const right: ParsedNode[] = [
      mkNode("r1", "knowledge", { children: [
        mkNode("r2", "window", { attrs: { name: "self:reporter", lifespan: "pinned" }, content: "x" }),
      ]}),
    ];
    const diff = computeNodeDiff(left, right);
    expect(diff.left.get("l2")).toBe("changed");
    expect(diff.right.get("r2")).toBe("changed");
  });

  test("nodeKey 优先级：name > id > command > tag+idx", () => {
    const withName = mkNode("x", "window", { attrs: { name: "X" } });
    expect(nodeKey(withName, 0)).toBe("window#name=X");
    const withId = mkNode("x", "message", { attrs: { id: "m1" } });
    expect(nodeKey(withId, 3)).toBe("message#id=m1");
    const withCmd = mkNode("x", "form", { attrs: { command: "talk" } });
    expect(nodeKey(withCmd, 1)).toBe("form#command=talk");
    const plain = mkNode("x", "plan", {});
    expect(nodeKey(plain, 2)).toBe("plan#idx=2");
  });
});

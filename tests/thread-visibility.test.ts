/**
 * 线程 Context 可见性分类器测试
 *
 * 对应 `kernel/src/thread/visibility.ts`：给定一棵线程树和 focus 节点 ID，
 * 计算每个节点在 focus 线程 Context 中的呈现形态。
 *
 * 规则来源（严格对齐 `context-builder.ts` 的实现）：
 * - focus 自身：process 区段，完整 actions —— detailed
 * - 祖先链（Root → 父，不含自身）：renderAncestorSummary —— 有 summary 则 summary，否则 title_only
 * - 直接子节点：renderChildrenSummary —— 有 summary 则 summary，否则 title_only
 * - 同级兄弟（同一父节点下的其他子节点）：renderSiblingSummary —— 有 summary 则 summary，否则 title_only
 * - 其他节点（uncle / uncle 的子 / 堂兄弟的子 / 子的子 / …）：不在 Context 里 —— hidden
 *
 * 注意 context-builder 当前的 siblingSummary 只收集"父节点的其他直接子"，
 * 所以 uncle（父节点的兄弟）并不会出现在 Context，更不会出现其子孙。
 *
 * @ref kernel/src/thread/context-builder.ts
 */
import { describe, test, expect } from "bun:test";
import type { ThreadsTreeFile, ThreadsTreeNodeMeta } from "../src/thread/types.js";
import { classifyContextVisibility, type ContextVisibility } from "../src/thread/visibility.js";

/** 辅助：创建节点元数据 */
function makeNode(id: string, overrides?: Partial<ThreadsTreeNodeMeta>): ThreadsTreeNodeMeta {
  return {
    id,
    title: overrides?.title ?? id,
    status: overrides?.status ?? "running",
    childrenIds: overrides?.childrenIds ?? [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/**
 * 构造测试树：
 *
 * ```
 * root
 * ├── A1 (focus 的祖父, 有 summary)
 * │   ├── A2 (focus 的父亲, 有 summary)
 * │   │   ├── focus
 * │   │   ├── sibling1 (有 summary)
 * │   │   └── sibling2 (无 summary)
 * │   └── uncle (有 summary)
 * │       ├── cousin1 (hidden)
 * │       └── cousin2 (hidden)
 * ├── focus_child1  (有 summary, 其实挂在 focus 下——下面修正)
 * └── focus_child2  (无 summary, 其实挂在 focus 下——下面修正)
 * ```
 *
 * 实际结构（focus 的 child 挂在 focus 下，而不是 root 下）：
 *
 * ```
 * root (有 summary)
 * └── A1 (有 summary)
 *     ├── A2 (有 summary)
 *     │   ├── focus
 *     │   │   ├── fc1 (有 summary) ——> focus 的直接子
 *     │   │   └── fc2 (无 summary) ——> focus 的直接子
 *     │   ├── sibling1 (有 summary)
 *     │   └── sibling2 (无 summary)
 *     └── uncle (有 summary)
 *         ├── cousin1
 *         └── cousin2
 * ```
 */
function buildTestTree(): ThreadsTreeFile {
  return {
    rootId: "root",
    nodes: {
      root: makeNode("root", {
        summary: "root summary",
        childrenIds: ["A1"],
      }),
      A1: makeNode("A1", {
        parentId: "root",
        summary: "A1 summary",
        childrenIds: ["A2", "uncle"],
      }),
      A2: makeNode("A2", {
        parentId: "A1",
        summary: "A2 summary",
        childrenIds: ["focus", "sibling1", "sibling2"],
      }),
      focus: makeNode("focus", {
        parentId: "A2",
        childrenIds: ["fc1", "fc2"],
      }),
      fc1: makeNode("fc1", {
        parentId: "focus",
        summary: "fc1 summary",
      }),
      fc2: makeNode("fc2", {
        parentId: "focus",
        /* 无 summary */
      }),
      sibling1: makeNode("sibling1", {
        parentId: "A2",
        summary: "sibling1 summary",
      }),
      sibling2: makeNode("sibling2", {
        parentId: "A2",
        /* 无 summary */
      }),
      uncle: makeNode("uncle", {
        parentId: "A1",
        summary: "uncle summary",
        childrenIds: ["cousin1", "cousin2"],
      }),
      cousin1: makeNode("cousin1", { parentId: "uncle" }),
      cousin2: makeNode("cousin2", { parentId: "uncle" }),
    },
  };
}

describe("classifyContextVisibility — 基础分类", () => {
  const tree = buildTestTree();
  let map: Record<string, ContextVisibility>;

  test("调用不抛错", () => {
    map = classifyContextVisibility(tree, "focus");
    expect(map).toBeDefined();
  });

  test("focus 自身 = detailed（完整 actions 可见）", () => {
    map = classifyContextVisibility(tree, "focus");
    expect(map.focus).toBe("detailed");
  });

  test("祖先链（有 summary）= summary", () => {
    map = classifyContextVisibility(tree, "focus");
    expect(map.A2).toBe("summary"); /* 直接父，有 summary */
    expect(map.A1).toBe("summary"); /* 祖父，有 summary */
    expect(map.root).toBe("summary"); /* 曾祖（root），有 summary */
  });

  test("祖先链（无 summary）= title_only", () => {
    /* 构造一个祖先无 summary 的变体 */
    const noSummaryRoot: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { childrenIds: ["x"] }), /* 无 summary */
        x: makeNode("x", { parentId: "r" }),
      },
    };
    const m = classifyContextVisibility(noSummaryRoot, "x");
    expect(m.r).toBe("title_only");
    expect(m.x).toBe("detailed");
  });

  test("直接子（有 summary）= summary", () => {
    map = classifyContextVisibility(tree, "focus");
    expect(map.fc1).toBe("summary");
  });

  test("直接子（无 summary）= title_only", () => {
    map = classifyContextVisibility(tree, "focus");
    expect(map.fc2).toBe("title_only");
  });

  test("兄弟（有 summary）= summary", () => {
    map = classifyContextVisibility(tree, "focus");
    expect(map.sibling1).toBe("summary");
  });

  test("兄弟（无 summary）= title_only", () => {
    map = classifyContextVisibility(tree, "focus");
    expect(map.sibling2).toBe("title_only");
  });

  test("uncle（父节点的兄弟）= hidden（context-builder 的 siblingSummary 只看 focus 的父节点的直接子，不看 focus 的祖父的其他子）", () => {
    map = classifyContextVisibility(tree, "focus");
    /* uncle 是 A1 的子（A2 的兄弟），不是 focus 的兄弟，也不是直接子/祖先，
     * context-builder 三个 render 函数都不会收集它 —— 应为 hidden。
     */
    expect(map.uncle).toBe("hidden");
  });

  test("cousin（uncle 的子）= hidden", () => {
    map = classifyContextVisibility(tree, "focus");
    expect(map.cousin1).toBe("hidden");
    expect(map.cousin2).toBe("hidden");
  });

  test("返回 map 覆盖所有节点", () => {
    map = classifyContextVisibility(tree, "focus");
    const keys = new Set(Object.keys(map));
    const expected = new Set(Object.keys(tree.nodes));
    expect(keys).toEqual(expected);
  });
});

describe("classifyContextVisibility — 边界 case", () => {
  test("Root 作为 focus：整棵树只有 root 的直接子展示（summary 或 title_only）", () => {
    const tree = buildTestTree();
    const map = classifyContextVisibility(tree, "root");
    expect(map.root).toBe("detailed");
    expect(map.A1).toBe("summary"); /* 有 summary */
    /* A2、focus、uncle 等都是 root 的孙子/曾孙，不在 Context 里 */
    expect(map.A2).toBe("hidden");
    expect(map.uncle).toBe("hidden");
    expect(map.focus).toBe("hidden");
  });

  test("叶节点作为 focus（父无 summary）：父是 title_only，祖父是 summary", () => {
    const tree = buildTestTree();
    const map = classifyContextVisibility(tree, "fc1");
    expect(map.fc1).toBe("detailed");
    expect(map.focus).toBe("title_only"); /* focus 无 summary */
    expect(map.A2).toBe("summary"); /* 有 summary */
    expect(map.A1).toBe("summary");
    expect(map.root).toBe("summary");
    expect(map.fc2).toBe("title_only"); /* fc1 的兄弟，无 summary */
    /* 其他（sibling1, sibling2, uncle, cousin1, cousin2）都不在 fc1 的视野里 */
    expect(map.sibling1).toBe("hidden");
    expect(map.sibling2).toBe("hidden");
    expect(map.uncle).toBe("hidden");
    expect(map.cousin1).toBe("hidden");
    expect(map.cousin2).toBe("hidden");
  });

  test("focusId 不存在：返回空 map，不抛错", () => {
    const tree = buildTestTree();
    const map = classifyContextVisibility(tree, "does-not-exist");
    expect(map).toEqual({});
  });

  test("孤立节点（孤儿，无 parentId 且不是 root）：被视作 hidden", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r"),
        orphan: makeNode("orphan"), /* 没有 parentId，也不在 r.childrenIds 里 */
      },
    };
    const map = classifyContextVisibility(tree, "r");
    expect(map.r).toBe("detailed");
    expect(map.orphan).toBe("hidden");
  });
});

describe("classifyContextVisibility — 与 context-builder 的一致性", () => {
  /**
   * 关键铁律：
   * 可见性分类器声明"出现在 Context 里的节点集合"
   * 必须等于
   * context-builder 的三个 render 函数实际产出文本里提到的节点集合。
   *
   * 这里做简化断言：detailed + summary + title_only 的节点
   * 一定包含 focus 自身、全部祖先、全部直接子、全部同级兄弟。
   */
  test("detailed + summary + title_only 的集合 = focus + 祖先 + 直接子 + 兄弟", () => {
    const tree = buildTestTree();
    const map = classifyContextVisibility(tree, "focus");

    const visible = Object.entries(map)
      .filter(([, v]) => v !== "hidden")
      .map(([k]) => k)
      .sort();

    const expected = [
      "focus",     /* 自身 */
      "A2", "A1", "root", /* 祖先 */
      "fc1", "fc2",       /* 直接子 */
      "sibling1", "sibling2", /* 兄弟 */
    ].sort();

    expect(visible).toEqual(expected);
  });
});

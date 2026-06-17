/**
 * plan_window 数据层渲染单测。
 *
 * 不依赖 ContextSnapshotViewer.tsx（其依赖 MarkdownContent → rehype-raw，
 * 当前环境网络受限缺包；纯数据层独立可测）：
 *
 * - context-snapshot.ts 已为 plan window 加 variant + windowBadge / Summary /
 *   CharCount / WINDOW_TYPE_ORDER 分支；buildContextTree 输出的 ContextNode
 *   字段即是右侧详情/左侧树渲染所依赖的数据契约。
 * - 因此对 buildContextTree(snapshot) 验证 node.badge / summary / charCount /
 *   data.window 字段保留即等价于验证 ContextSnapshotViewer 能正确渲染。
 *
 * 窗形态对齐 Wave-4 OocObjectInstance 信封：业务字段（plan 的 title / status /
 * description / steps / parentPlanWindowId / parentStepId）下沉 `.data`，前端按
 * `.class` narrow 后读 `.data.xxx`。
 *
 * 共 3 用例：
 *   1. plan_window with steps → 树/详情数据正确
 *   2. plan_window with subPlanWindowId → sub plan 反向链字段保留
 *   3. plan_window with empty steps + archived → fallback render 不崩
 */
import { describe, expect, it } from "bun:test";
import { buildContextTree, type ContextSnapshot } from "./context-snapshot";

function findWindowNode(root: ReturnType<typeof buildContextTree>, windowId: string) {
  const stack = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.data.kind === "window" && n.data.window.id === windowId) return n;
    for (const c of n.children) stack.push(c);
  }
  return null;
}

describe("context-snapshot · plan window", () => {
  it("plan_window with steps → badge 含 done/total + summary/charCount/window 数据正确", () => {
    const snapshot: ContextSnapshot = {
      id: "thr_test",
      status: "running",
      contextWindows: [
        { id: "root", class: "root", title: "root", data: {} },
        {
          id: "plan_1",
          class: "plan",
          title: "Implement feature X",
          status: "active",
          data: {
            title: "Implement feature X",
            status: "active",
            description: "我们要做的事",
            steps: [
              { id: "s1", text: "First step text", status: "done" },
              { id: "s2", text: "Second step", status: "in-progress" },
              { id: "s3", text: "Third pending", status: "pending" },
              { id: "s4", text: "Fourth blocked", status: "blocked" },
              { id: "s5", text: "Fifth pending", status: "pending" },
            ],
          },
        },
      ],
    };

    const tree = buildContextTree(snapshot);
    const node = findWindowNode(tree, "plan_1");
    expect(node).not.toBeNull();
    // badge: "PLAN 1/5"
    expect(node!.badge).toBe("PLAN 1/5");
    // summary: plan title
    expect(node!.summary).toBe("Implement feature X");
    // charCount 至少包含 title + description + 所有 step text
    const expectedMin =
      "Implement feature X".length +
      "我们要做的事".length +
      ["First step text", "Second step", "Third pending", "Fourth blocked", "Fifth pending"]
        .reduce((sum, s) => sum + s.length, 0);
    expect(node!.charCount).toBeGreaterThanOrEqual(expectedMin);
    // data 应保留完整 window，详情面板才能渲染各 step
    expect(node!.data.kind).toBe("window");
    if (node!.data.kind === "window" && node!.data.window.class === "plan") {
      expect(node!.data.window.data.steps).toHaveLength(5);
      expect(node!.data.window.data.steps[0]!.status).toBe("done");
      expect(node!.data.window.data.steps[1]!.status).toBe("in-progress");
      expect(node!.data.window.data.steps[2]!.status).toBe("pending");
      expect(node!.data.window.data.steps[3]!.status).toBe("blocked");
    } else {
      throw new Error("expected plan window data");
    }
  });

  it("plan_window with subPlanWindowId → sub plan 反向链字段保留供 PlanWindowDetail 渲染链接", () => {
    const snapshot: ContextSnapshot = {
      id: "thr_test",
      contextWindows: [
        { id: "root", class: "root", title: "root", data: {} },
        {
          id: "plan_parent",
          class: "plan",
          title: "Parent plan",
          status: "active",
          data: {
            title: "Parent plan",
            status: "active",
            steps: [
              { id: "s1", text: "Expand me", status: "in-progress", subPlanWindowId: "plan_child" },
              { id: "s2", text: "Regular", status: "pending" },
            ],
          },
        },
        {
          id: "plan_child",
          class: "plan",
          title: "Child plan",
          status: "active",
          data: {
            title: "Child plan",
            status: "active",
            steps: [{ id: "c1", text: "Child step", status: "pending" }],
            parentPlanWindowId: "plan_parent",
            parentStepId: "s1",
          },
        },
      ],
    };

    const tree = buildContextTree(snapshot);
    const parent = findWindowNode(tree, "plan_parent");
    const child = findWindowNode(tree, "plan_child");
    expect(parent).not.toBeNull();
    expect(child).not.toBeNull();

    // 父 step.subPlanWindowId 必须保留：PlanWindowDetail 会用它渲染 [sub plan: <id>] 链接
    if (parent!.data.kind === "window" && parent!.data.window.class === "plan") {
      expect(parent!.data.window.data.steps[0]!.subPlanWindowId).toBe("plan_child");
    } else {
      throw new Error("expected plan parent window data");
    }
    // 子 plan parentPlanWindowId/parentStepId 必须保留供"Parent: <link>"渲染
    if (child!.data.kind === "window" && child!.data.window.class === "plan") {
      expect(child!.data.window.data.parentPlanWindowId).toBe("plan_parent");
      expect(child!.data.window.data.parentStepId).toBe("s1");
    } else {
      throw new Error("expected plan child window data");
    }
  });

  it("plan_window with empty steps + status archived → fallback render 不崩，badge 为 PLAN 0/0", () => {
    const snapshot: ContextSnapshot = {
      id: "thr_test",
      contextWindows: [
        { id: "root", class: "root", title: "root", data: {} },
        {
          id: "plan_archived",
          class: "plan",
          title: "Old plan",
          status: "archived",
          data: {
            title: "Old plan",
            status: "archived",
            steps: [],
          },
        },
      ],
    };

    // buildContextTree 不应抛
    expect(() => buildContextTree(snapshot)).not.toThrow();
    const tree = buildContextTree(snapshot);
    const node = findWindowNode(tree, "plan_archived");
    expect(node).not.toBeNull();
    expect(node!.badge).toBe("PLAN 0/0");
    expect(node!.summary).toBe("Old plan");
    if (node!.data.kind === "window" && node!.data.window.class === "plan") {
      expect(node!.data.window.data.status).toBe("archived");
      expect(node!.data.window.data.steps).toHaveLength(0);
    }
  });
});

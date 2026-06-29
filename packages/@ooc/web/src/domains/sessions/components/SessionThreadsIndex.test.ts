/**
 * Session Threads Index 单测。
 *
 * 测试范围（与 LoopTimeline.test.ts 同款约束: 不引入 React Testing Library,
 * 只对纯函数 + 数据契约做断言）:
 *   1. groupByObject:  user 列在最左; 其它按 thread 数降序
 *   2. groupByObject:  无 user 时退化到 thread 数降序
 *   3. buildThreadTree: parent/child 缩进正确（root level=0, child level=1）
 *   4. buildThreadTree: 无 parent 信息时全部 level=0
 *   5. buildThreadTree: parent 不在本 object 视作 root (level=0)
 *   6. deriveThreadTitle: item.title 优先, 否则 humanizeThreadId
 *   7. computeEdges:    creator/talk/lent/holding 关系全部产出, 缺字段时不崩
 *   8. computeEdges:    选中 item 不存在时返回 []
 *   9. computeEdges:    parent 与 creator 是同一对 (objectId+threadId) 时不重复
 *  10. computeEdges:    talkPeer 缺 targetThreadId 时跳过该 edge
 */

import { describe, expect, it } from "bun:test";
import { groupByObject } from "./session-threads-index.helpers";
import { buildThreadTree } from "./ObjectColumn";
import { deriveThreadTitle } from "./ThreadNode";
import { computeEdges } from "./RelationOverlay";
import type { ListThreadsItem } from "../types";

function it_(
  objectId: string,
  threadId: string,
  rest: Partial<ListThreadsItem> = {},
): ListThreadsItem {
  return { objectId, threadId, ...rest };
}

describe("groupByObject", () => {
  it("user 列总是第一; 其它按 thread 数降序", () => {
    const items = [
      it_("supervisor", "root"),
      it_("supervisor", "t_a"),
      it_("supervisor", "t_b"),
      it_("user", "root"),
      it_("fb", "root"),
    ];
    const groups = groupByObject(items);
    expect(groups[0]!.objectId).toBe("user");
    expect(groups[1]!.objectId).toBe("supervisor");
    expect(groups[2]!.objectId).toBe("fb");
    expect(groups[1]!.items.length).toBe(3);
  });

  it("无 user 时按 thread 数降序, tied 时字典序", () => {
    const items = [
      it_("zeta", "root"),
      it_("alpha", "root"),
      it_("alpha", "t1"),
    ];
    const groups = groupByObject(items);
    expect(groups[0]!.objectId).toBe("alpha");
    expect(groups[1]!.objectId).toBe("zeta");
  });

  it("空数组 → []", () => {
    expect(groupByObject([])).toEqual([]);
  });
});

describe("buildThreadTree", () => {
  it("parent/child 缩进: root level=0, child level=1", () => {
    const items = [
      it_("sup", "root", { createdAt: 1 }),
      it_("sup", "t_child", { parentThreadId: "root", createdAt: 2 }),
      it_("sup", "t_grand", { parentThreadId: "t_child", createdAt: 3 }),
    ];
    const tree = buildThreadTree(items);
    expect(tree.length).toBe(3);
    expect(tree[0]!.item.threadId).toBe("root");
    expect(tree[0]!.level).toBe(0);
    expect(tree[1]!.item.threadId).toBe("t_child");
    expect(tree[1]!.level).toBe(1);
    expect(tree[2]!.item.threadId).toBe("t_grand");
    expect(tree[2]!.level).toBe(2);
  });

  it("无 parent 信息时全部 level=0 (退化场景)", () => {
    const items = [it_("sup", "t1"), it_("sup", "t2"), it_("sup", "t3")];
    const tree = buildThreadTree(items);
    expect(tree.length).toBe(3);
    expect(tree.every((n) => n.level === 0)).toBe(true);
  });

  it("parent 不在本 object 视作 root (level=0)", () => {
    const items = [
      // parentThreadId='external' 不在 items 里 → 视作 root
      it_("sup", "t_orphan", { parentThreadId: "external" }),
    ];
    const tree = buildThreadTree(items);
    expect(tree.length).toBe(1);
    expect(tree[0]!.level).toBe(0);
  });

  it("空 items → []", () => {
    expect(buildThreadTree([])).toEqual([]);
  });
});

describe("deriveThreadTitle", () => {
  it("item.title 优先", () => {
    expect(deriveThreadTitle(it_("sup", "t_abc", { title: "Reflect Cycle 7" }))).toBe(
      "Reflect Cycle 7",
    );
  });

  it("无 title 时走 humanizeThreadId — root 原样", () => {
    expect(deriveThreadTitle(it_("user", "root"))).toBe("root");
  });

  it("无 title 时走 humanizeThreadId — t_user_* 折成 user-talk", () => {
    expect(deriveThreadTitle(it_("sup", "t_user_abc_def"))).toBe("user-talk");
  });

  it("无 title 时长 id 折后 6 字符前加 …", () => {
    expect(deriveThreadTitle(it_("sup", "t_abcdefghijkl"))).toBe("…ghijkl");
  });
});

describe("computeEdges", () => {
  it("创建出 parent + talk + lent + holding 四类关系", () => {
    const items: ListThreadsItem[] = [
      it_("sup", "root", { status: "running" }),
      it_("sup", "t_plan", {
        status: "running",
        parentThreadId: "root",
        talkPeers: [{ targetObjectId: "user", targetThreadId: "root", windowId: "w_t1" }],
        shares: {
          holding: [
            { windowId: "w_ref1", kind: "ref", ownerObjectId: "fb", ownerThreadId: "t_x" },
          ],
          lentOut: [
            { windowId: "w_lent1", borrowerObjectId: "fb", borrowerThreadId: "t_y" },
          ],
        },
      }),
      it_("user", "root"),
      it_("fb", "t_x"),
      it_("fb", "t_y"),
    ];
    const edges = computeEdges(items, { objectId: "sup", threadId: "t_plan" });
    const kinds = edges.map((e) => e.kind).sort();
    expect(kinds).toEqual(["holding", "lent", "parent", "talk"]);
    const talk = edges.find((e) => e.kind === "talk")!;
    expect(talk.toObjectId).toBe("user");
    expect(talk.toThreadId).toBe("root");
    const lent = edges.find((e) => e.kind === "lent")!;
    expect(lent.toObjectId).toBe("fb");
    expect(lent.toThreadId).toBe("t_y");
    const holding = edges.find((e) => e.kind === "holding")!;
    // holding 方向: owner → 本
    expect(holding.fromObjectId).toBe("fb");
    expect(holding.fromThreadId).toBe("t_x");
    expect(holding.toObjectId).toBe("sup");
    expect(holding.toThreadId).toBe("t_plan");
  });

  it("选中 item 不存在 → []", () => {
    const items: ListThreadsItem[] = [it_("sup", "root")];
    expect(computeEdges(items, { objectId: "sup", threadId: "missing" })).toEqual([]);
  });

  it("parent 与 creator 同一对时不产生重复 parent edge", () => {
    const items: ListThreadsItem[] = [
      it_("sup", "root"),
      it_("sup", "t_a", {
        parentThreadId: "root",
        creatorObjectId: "sup",
        creatorThreadId: "root",
      }),
    ];
    const edges = computeEdges(items, { objectId: "sup", threadId: "t_a" });
    expect(edges.filter((e) => e.kind === "parent").length).toBe(1);
  });

  it("talkPeer 缺 targetThreadId → 跳过该 edge (尚未派送过的新 talk_window)", () => {
    const items: ListThreadsItem[] = [
      it_("user", "root", {
        talkPeers: [{ targetObjectId: "sup", windowId: "w_t1" }],
      }),
    ];
    const edges = computeEdges(items, { objectId: "user", threadId: "root" });
    expect(edges).toEqual([]);
  });

  it("退化场景 — items 无任何关系字段 → []", () => {
    const items: ListThreadsItem[] = [it_("sup", "root"), it_("user", "root")];
    expect(computeEdges(items, { objectId: "sup", threadId: "root" })).toEqual([]);
  });
});

/**
 * 路由层兼容性 smoke test: selected 联合类型在两种 variant 间切换不应误判,
 * SessionThreadsIndex 内 SelectionDetail 的 dispatch 逻辑依赖 `selected.kind`,
 * 这里固化 routing 层契约本身（实际 DOM dispatch 由 build/视觉冒烟覆盖）。
 */
describe("SelectionDetail dispatch contract (chat vs thread)", () => {
  // 模拟 SelectionDetail dispatch 决策的纯函数版本; 与组件内分支同 shape
  function dispatch(
    selected:
      | { kind: "chat"; windowId: string }
      | { kind: "thread"; objectId: string; threadId: string }
      | undefined,
  ): "empty" | "chat" | "thread" {
    if (!selected) return "empty";
    if (selected.kind === "chat") return "chat";
    return "thread";
  }

  it("undefined → empty (引导面板)", () => {
    expect(dispatch(undefined)).toBe("empty");
  });
  it("chat variant → chat (ChatPanel 路径保留)", () => {
    expect(dispatch({ kind: "chat", windowId: "w1" })).toBe("chat");
  });
  it("thread variant → thread (新 ThreadInspectDetail 路径)", () => {
    expect(dispatch({ kind: "thread", objectId: "sup", threadId: "t1" })).toBe("thread");
  });
});

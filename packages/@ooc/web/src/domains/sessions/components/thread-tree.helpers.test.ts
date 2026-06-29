/**
 * Session Thread Tree 纯函数单测 —— 跨 object 森林构建 + filter 裁剪。
 *
 * 与 LoopTimeline.test.ts 同款约束：只对纯函数 + 数据契约断言，不引 React。
 */

import { describe, expect, it } from "bun:test";
import {
  buildSessionThreadTree,
  pruneTree,
  collectMatchedKeys,
  listObjectIds,
  itemKey,
  type ThreadTreeNode,
} from "./thread-tree.helpers";
import type { ListThreadsItem } from "../types";

function it_(
  objectId: string,
  threadId: string,
  rest: Partial<ListThreadsItem> = {},
): ListThreadsItem {
  return { objectId, threadId, ...rest };
}

/** 把森林拍平成 "object/thread@level" 序列，便于断言结构与顺序。 */
function flatten(roots: ThreadTreeNode[], level = 0): string[] {
  const out: string[] = [];
  for (const n of roots) {
    out.push(`${itemKey(n.item)}@${level}`);
    out.push(...flatten(n.children, level + 1));
  }
  return out;
}

describe("buildSessionThreadTree — 同 object 纵向 parent", () => {
  it("parentThreadId 链成嵌套树", () => {
    const tree = buildSessionThreadTree([
      it_("sup", "root", { createdAt: 1 }),
      it_("sup", "t_child", { parentThreadId: "root", createdAt: 2 }),
      it_("sup", "t_grand", { parentThreadId: "t_child", createdAt: 3 }),
    ]);
    expect(flatten(tree)).toEqual([
      "sup/root@0",
      "sup/t_child@1",
      "sup/t_grand@2",
    ]);
  });

  it("无 parent 信息时全部 root", () => {
    const tree = buildSessionThreadTree([
      it_("sup", "t1"),
      it_("sup", "t2"),
      it_("sup", "t3"),
    ]);
    expect(tree.length).toBe(3);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("parent 不在 items 里 → 视作 root", () => {
    const tree = buildSessionThreadTree([
      it_("sup", "t_orphan", { parentThreadId: "external" }),
    ]);
    expect(tree.length).toBe(1);
    expect(tree[0]!.children.length).toBe(0);
  });
});

describe("buildSessionThreadTree — 跨 object creator 链", () => {
  it("creator 把子 object thread 挂到创建它的 thread 下", () => {
    const tree = buildSessionThreadTree([
      it_("user", "root", { createdAt: 1 }),
      it_("supervisor", "t_a", {
        createdAt: 2,
        creatorObjectId: "user",
        creatorThreadId: "root",
      }),
    ]);
    expect(flatten(tree)).toEqual(["user/root@0", "supervisor/t_a@1"]);
  });

  it("parentThreadId 优先于 creator（两者都在时走同 object parent）", () => {
    const tree = buildSessionThreadTree([
      it_("sup", "root", { createdAt: 1 }),
      it_("user", "root", { createdAt: 0 }),
      it_("sup", "t_a", {
        createdAt: 2,
        parentThreadId: "root",
        creatorObjectId: "user",
        creatorThreadId: "root",
      }),
    ]);
    // t_a 挂在 sup/root 下，而非 user/root 下
    const sup = tree.find((n) => itemKey(n.item) === "sup/root")!;
    expect(sup.children.map((c) => itemKey(c.item))).toEqual(["sup/t_a"]);
    const user = tree.find((n) => itemKey(n.item) === "user/root")!;
    expect(user.children.length).toBe(0);
  });

  it("creator 不在 items 里 → 退化为 root", () => {
    const tree = buildSessionThreadTree([
      it_("sup", "t_a", { creatorObjectId: "ghost", creatorThreadId: "x" }),
    ]);
    expect(tree.length).toBe(1);
  });
});

describe("buildSessionThreadTree — 防环 & 排序", () => {
  it("parent 成环时降级为 root，不无限递归", () => {
    const tree = buildSessionThreadTree([
      it_("o", "a", { parentThreadId: "b" }),
      it_("o", "b", { parentThreadId: "a" }),
    ]);
    // 不崩；两个节点都出现
    const flat = flatten(tree);
    expect(flat.length).toBe(2);
    expect(flat).toContain("o/a@0");
  });

  it("children 按 createdAt 升序", () => {
    const tree = buildSessionThreadTree([
      it_("o", "root", { createdAt: 1 }),
      it_("o", "late", { parentThreadId: "root", createdAt: 30 }),
      it_("o", "early", { parentThreadId: "root", createdAt: 10 }),
    ]);
    expect(tree[0]!.children.map((c) => c.item.threadId)).toEqual(["early", "late"]);
  });

  it("空数组 → []", () => {
    expect(buildSessionThreadTree([])).toEqual([]);
  });
});

describe("pruneTree — object 过滤保祖先", () => {
  const items = [
    it_("user", "root", { createdAt: 1 }),
    it_("supervisor", "t_a", {
      createdAt: 2,
      creatorObjectId: "user",
      creatorThreadId: "root",
    }),
    it_("worker", "t_b", {
      createdAt: 3,
      creatorObjectId: "supervisor",
      creatorThreadId: "t_a",
    }),
    it_("user", "t_side", { parentThreadId: "root", createdAt: 4 }),
  ];

  it("按 objectId 过滤：命中节点 + 祖先链保留，无关分支裁掉", () => {
    const tree = buildSessionThreadTree(items);
    const pruned = pruneTree(tree, { objectId: "worker" });
    // 保留 user/root → supervisor/t_a → worker/t_b 这条链；user/t_side 被裁
    expect(flatten(pruned)).toEqual([
      "user/root@0",
      "supervisor/t_a@1",
      "worker/t_b@2",
    ]);
  });

  it("无 filter → 原样返回", () => {
    const tree = buildSessionThreadTree(items);
    expect(pruneTree(tree, {})).toBe(tree);
  });

  it("query 文本过滤命中 thread id", () => {
    const tree = buildSessionThreadTree(items);
    const pruned = pruneTree(tree, { query: "side" });
    expect(flatten(pruned)).toEqual(["user/root@0", "user/t_side@1"]);
  });
});

describe("collectMatchedKeys & listObjectIds", () => {
  const items = [
    it_("user", "root"),
    it_("supervisor", "t_a"),
    it_("supervisor", "t_b"),
  ];

  it("collectMatchedKeys 只收自身命中的 key（祖先不计）", () => {
    const matched = collectMatchedKeys(items, { objectId: "supervisor" });
    expect(matched.has("supervisor/t_a")).toBe(true);
    expect(matched.has("supervisor/t_b")).toBe(true);
    expect(matched.has("user/root")).toBe(false);
  });

  it("无 filter → 空集合", () => {
    expect(collectMatchedKeys(items, {}).size).toBe(0);
  });

  it("listObjectIds：user 优先，其余按 thread 数降序", () => {
    expect(listObjectIds(items)).toEqual(["user", "supervisor"]);
  });
});

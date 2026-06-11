/**
 * computeReviewerSet —— scope 冒泡算 reviewer 集（决策 A：逐路径拥有者）。
 *
 * reviewer 集 = {落在 author 子树 objects/<author>/**（含 children）之外的、每个被触及
 * 路径的拥有对象} ∪ {supervisor}。author 自己不作 reviewer。
 *
 * 纯函数，充分单测：纯 author 子树 / 触及别人 / 触及别人的 child / 混合 / nested author。
 */
import { describe, expect, test } from "bun:test";
import { computeReviewerSet, SUPERVISOR_OBJECT_ID } from "../stone-feat-branch";

describe("computeReviewerSet (决策A：逐路径拥有者冒泡)", () => {
  test("全部落在 flat author 子树内 → reviewer = {supervisor}", () => {
    const r = computeReviewerSet(
      ["objects/foo/self.md", "objects/foo/executable/index.ts"],
      "foo",
    );
    expect(r).toEqual([SUPERVISOR_OBJECT_ID]);
  });

  test("author 子树含 children 也算自治区 → reviewer = {supervisor}", () => {
    const r = computeReviewerSet(
      ["objects/foo/self.md", "objects/foo/children/bar/self.md"],
      "foo",
    );
    expect(r).toEqual([SUPERVISOR_OBJECT_ID]);
  });

  test("触及别人 Y → reviewer = {Y, supervisor}（author 不作 reviewer）", () => {
    const r = computeReviewerSet(
      ["objects/foo/self.md", "objects/bob/self.md"],
      "foo",
    );
    expect(r.sort()).toEqual(["bob", SUPERVISOR_OBJECT_ID].sort());
  });

  test("触及别人的 child（objects/Y/children/Z/...）→ reviewer 是最近 parent 对象 Y", () => {
    const r = computeReviewerSet(
      ["objects/bob/children/baz/self.md"],
      "foo",
    );
    expect(r.sort()).toEqual(["bob", SUPERVISOR_OBJECT_ID].sort());
  });

  test("混合：foo 子树 + 别人 Y + 别人的 child（顶层领地 owner W）→ {Y, W, supervisor} 去重", () => {
    const r = computeReviewerSet(
      [
        "objects/foo/self.md",
        "objects/foo/children/inner/self.md",
        "objects/bob/self.md",
        "objects/carol/children/deep/knowledge/x.md", // 顶层领地 owner = carol（非 carol/deep）
        "objects/bob/readable.md", // 同一拥有者 bob 去重
      ],
      "foo",
    );
    expect(r.sort()).toEqual(["bob", "carol", SUPERVISOR_OBJECT_ID].sort());
  });

  test("nested author（foo/sub）：改自己物理子树 objects/foo/children/sub/** → {supervisor}", () => {
    const r = computeReviewerSet(
      ["objects/foo/children/sub/self.md", "objects/foo/children/sub/executable/index.ts"],
      "foo/sub",
    );
    expect(r).toEqual([SUPERVISOR_OBJECT_ID]);
  });

  test("nested author 改 parent（objects/foo/self.md，越出自己子树）→ reviewer 是 parent foo", () => {
    const r = computeReviewerSet(
      ["objects/foo/self.md"],
      "foo/sub",
    );
    expect(r.sort()).toEqual(["foo", SUPERVISOR_OBJECT_ID].sort());
  });

  test("nested author 改别人 → reviewer 是别人 + supervisor", () => {
    const r = computeReviewerSet(
      ["objects/bob/self.md"],
      "foo/sub",
    );
    expect(r.sort()).toEqual(["bob", SUPERVISOR_OBJECT_ID].sort());
  });

  test("非 objects/ 路径（运行时产物等）被忽略，不产生 reviewer", () => {
    const r = computeReviewerSet(
      ["objects/foo/self.md", "flows/super/issues/index.json", ".world.json"],
      "foo",
    );
    expect(r).toEqual([SUPERVISOR_OBJECT_ID]);
  });

  test("空 diff → reviewer = {supervisor}（supervisor 始终参与）", () => {
    expect(computeReviewerSet([], "foo")).toEqual([SUPERVISOR_OBJECT_ID]);
  });

  test("supervisor 始终在集合内且仅出现一次（即便变更触及 supervisor 自治区）", () => {
    const r = computeReviewerSet(
      ["objects/supervisor/self.md", "objects/foo/self.md"],
      "foo",
    );
    // supervisor 是被触及的越界对象，也是固定 reviewer → 去重后仅一个 supervisor
    expect(r.filter((x) => x === SUPERVISOR_OBJECT_ID)).toHaveLength(1);
    expect(r).toEqual([SUPERVISOR_OBJECT_ID]);
  });

  test("author == supervisor 改自己子树 → reviewer 仍是 {supervisor}（自审合法）", () => {
    const r = computeReviewerSet(["objects/supervisor/self.md"], "supervisor");
    expect(r).toEqual([SUPERVISOR_OBJECT_ID]);
  });

  test("结果稳定排序（supervisor 末位，其余字典序）便于断言", () => {
    const r = computeReviewerSet(
      ["objects/zed/self.md", "objects/alice/self.md", "objects/foo/self.md"],
      "foo",
    );
    expect(r).toEqual(["alice", "zed", SUPERVISOR_OBJECT_ID]);
  });
});

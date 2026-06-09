/**
 * L6 — Reflectable（super flow / evolve_self / memory）。
 * 自我迭代：业务 session 试验 → super flow evolve_self 合入 main。
 * evolve 合入 / PR-Issue / memory 由 super flow 编排，需 worker → skip 归 Tier B；
 * 但「业务 session worktree 隔离」可经 ensureSessionWorktree 确定性单测。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { postJson } from "../_harness/control-plane";
import { story, check, skip, type Story } from "../_harness/story";

export const L6_STORIES: Story[] = [
  story({
    id: "L6-WORKTREE-WRITE",
    layer: "reflectable",
    expectation: "业务 session 内改自身 self 落 worktree，stones/main canonical 不变",
    design: "reflectable：业务 session 是试验层（worktree），main 是 canonical。stone-worktree.ts:ensureSessionWorktree",
    run: async ({ app, baseDir }) => {
      const id = "ego";
      await postJson(app, "/api/stones", { objectId: id, self: "# ego v1" });
      const { ensureSessionWorktree } = await import("@ooc/core/persistable");
      const sid = "sb-r-wt";
      await ensureSessionWorktree(baseDir, sid);
      const wtSelf = join(baseDir, "flows", sid, "objects", id, "self.md");
      check(existsSync(wtSelf), `worktree 未 checkout 出 ${id}/self.md`);
      writeFileSync(wtSelf, "# ego v2（worktree 试验）", "utf8");
      const mainSelf = readFileSync(join(baseDir, "stones", "main", "objects", id, "self.md"), "utf8");
      check(mainSelf.includes("v1") && !mainSelf.includes("v2"), `main canonical 被污染：${mainSelf.slice(0, 40)}`);
    },
  }),

  story({
    id: "L6-EVOLVE-FFMERGE",
    layer: "reflectable",
    expectation: "evolve_self self-scope → ff-merge 回 main，留署名 commit",
    design: "reflectable：evolve_self 把 worktree 改动合入 main。programmable/evolve-self.ts:tryMergeSelf。需 worker",
    run: async () => skip("evolve_self 由 super flow 编排（end→evolve），需 worker（Tier B/e2e）"),
  }),

  story({
    id: "L6-EVOLVE-CROSS-PR",
    layer: "reflectable",
    expectation: "evolve_self cross-scope（改/建别人对象）→ 开 PR-Issue 待评审",
    design: "reflectable：越自治区改动不直接合入，转 PR-Issue。evolve-self.ts cross-scope",
    run: async () => skip("cross-scope evolve 需 super flow 编排，控制面无 worker（Tier B/e2e）"),
  }),

  story({
    id: "L6-MEMORY-POOL",
    layer: "reflectable",
    expectation: "long memory 落 pools/<id>/knowledge/memory/<slug>.md",
    design: "reflectable：super flow 沉淀 memory 到 pool。reflectable memory merge。需 worker",
    run: async () => skip("memory 沉淀由 super flow 触发，需 worker（Tier B）"),
  }),

  story({
    id: "L6-CREATE-OBJECT-WORKTREE",
    layer: "reflectable",
    expectation: "create_object 在业务 session 落 session worktree objects/<newId>/（未即合入 main）",
    design: "reflectable：建新对象先落试验层，end→evolve 合入。persistable/stone-create-object.ts。需 worker",
    run: async () => skip("create_object 是 root method，需 agent 在 worker thinkloop 调（Tier B）"),
  }),
];

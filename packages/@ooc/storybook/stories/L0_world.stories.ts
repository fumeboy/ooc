/**
 * L0 — World 子树 / Persistable 落点。
 *
 * 每条只断一个预期：身份/事实/产物落到 stone(持久+git) / pool(持久+不git) / flow(运行层) 三子树。
 * 事实来源：persistable/*（方案 A）、modules/stones/api.*.ts。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { postJson, putJson, stoneCommits } from "../_harness/control-plane";
import { story, check, type Story } from "../_harness/story";

const mainObjects = (baseDir: string, id: string, f: string) =>
  join(baseDir, "stones", "main", "objects", id, f);

export const L0_STORIES: Story[] = [
  story({
    id: "L0-STONE-REPO",
    layer: "persistable",
    expectation: "ensureStoneRepo 后 stones/main/ 是 git 工作区（.git 存在）",
    design: "persistable：stones/main 是 versioning canonical（方案 A worktree）。persistable/bootstrap.ts",
    run: async ({ baseDir }) => {
      check(existsSync(join(baseDir, "stones", "main")), "stones/main 目录不存在");
      check(existsSync(join(baseDir, "stones", "main", ".git")), "stones/main/.git 不存在（非 git 工作区）");
    },
  }),

  story({
    id: "L0-CREATE-STONE",
    layer: "persistable",
    expectation: "建对象后 stones/main/objects/<id>/ 出现 package.json + self.md",
    design: "persistable：stone identity 落 stones/main/objects/<id>/。modules/stones/api.create-stone.ts",
    run: async ({ app, baseDir }) => {
      const id = "keeper";
      // 仅 agent（class=_builtin/agent）有 self.md；建 agent 才能断言 self.md 落盘。
      const r = await postJson(app, "/api/stones", { objectId: id, class: "_builtin/agent", self: "# Keeper" });
      check(r.status === 200, `createStone status=${r.status}`);
      check(existsSync(mainObjects(baseDir, id, "package.json")), "package.json 未落盘");
      check(existsSync(mainObjects(baseDir, id, "self.md")), "self.md 未落盘");
    },
  }),

  story({
    id: "L0-STONE-GIT",
    layer: "persistable",
    expectation: "建对象的 self.md 进 git（至少 1 个 commit，可审计）",
    design: "persistable：stone identity 进 git tracked、可回溯。versioning.ts",
    run: async ({ app, baseDir }) => {
      const id = "keeper";
      // self.md 仅 agent 落盘，故建 agent 才有 self.md commit 可审计。
      await postJson(app, "/api/stones", { objectId: id, class: "_builtin/agent", self: "# Keeper" });
      const commits = stoneCommits(baseDir, join("objects", id, "self.md"));
      check(commits.length >= 1, `self.md commit 数=${commits.length}`);
    },
  }),

  story({
    id: "L0-SELF-COMMIT",
    layer: "persistable",
    expectation: "经 HTTP PUT 改 self 在 stones/main 多出一个 commit",
    design: "persistable：身份演化经 worktree commit 版本化、可审计可回滚。modules/stones/api.put-file.ts",
    run: async ({ app, baseDir }) => {
      const id = "keeper";
      await postJson(app, "/api/stones", { objectId: id, self: "# v1" });
      const before = stoneCommits(baseDir, join("objects", id, "self.md")).length;
      await putJson(app, `/api/stones/${id}/file`, { path: "self.md", content: "# v2\n演化了。" }, { "X-Overwrite-Confirm": "true" });
      const after = stoneCommits(baseDir, join("objects", id, "self.md")).length;
      check(after > before, `commit 数未增长：${before} → ${after}`);
    },
  }),

  story({
    id: "L0-POOL-NOGIT",
    layer: "persistable",
    expectation: "建对象同时建 pools/<id>/ 骨架，且 pool 是独立于 stones 的子树",
    design: "persistable：pool = 持久但不进 git 的事实子树，与 stone(git) 分离。persistable/pool-object.ts",
    run: async ({ app, baseDir }) => {
      const id = "keeper";
      await postJson(app, "/api/stones", { objectId: id, self: "# Keeper" });
      check(existsSync(join(baseDir, "pools", id)), "pools/<id> 未建");
      // pool 落在 stones 之外的顶层子树（不属于 stones/main 这个 git 仓库）。
      check(!existsSync(join(baseDir, "stones", "main", "objects", id, "pool")), "pool 误落进 stone 子树");
    },
  }),

  story({
    id: "L0-THREE-SUBTREES",
    layer: "persistable",
    expectation: "一次会话后 stone(git)/pool(持久)/flow(运行) 三子树各就位",
    design: "persistable：三子树分离——stone 持久+git / pool 持久不git / flow 运行层。persistable 顶层布局",
    run: async ({ app, baseDir }) => {
      const id = "keeper";
      await postJson(app, "/api/stones", { objectId: id, self: "# Keeper" });
      const sid = "sb-three";
      await postJson(app, "/api/sessions", { sessionId: sid, targetObjectId: id, initialMessage: "hi" });
      check(existsSync(join(baseDir, "stones", "main", "objects", id)), "stone 子树缺位");
      check(existsSync(join(baseDir, "pools", id)), "pool 子树缺位");
      check(existsSync(join(baseDir, "flows", sid)), "flow 子树缺位");
    },
  }),

  story({
    id: "L0-GITIGNORE",
    layer: "persistable",
    expectation: "stones/main/.gitignore 白名单 objects/、黑名单运行时（threads/）",
    design: "persistable：身份进 git、运行时产物（threads/state.json/.flow.json）不进 git。persistable/bootstrap.ts",
    run: async ({ baseDir }) => {
      const p = join(baseDir, "stones", "main", ".gitignore");
      check(existsSync(p), ".gitignore 不存在");
      const gi = readFileSync(p, "utf8");
      check(/objects\//.test(gi), ".gitignore 未白名单 objects/");
      check(/threads\//.test(gi), ".gitignore 未黑名单 threads/");
    },
  }),
];

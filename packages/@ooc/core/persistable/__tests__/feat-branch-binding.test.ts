/**
 * feat-branch 绑定 + resolveStoneIdentityRef 覆盖优先 —— 集成测试（2026-06-11 改写）。
 *
 * 用户拍板：不再封装 edits 参数。super(foo) ①new_feat_branch 开 feat 分支并把绑定
 * 落 thread.persistence.stonesBranch ②用普通 write_file / file_window.edit 直接编辑 feat
 * worktree 下的文件 ③evolve_self 作 finalizer：commit + 开 PR + 清绑定。
 *
 * 本测试覆盖两层：
 *  1. **核心机制**：resolveStoneIdentityRef 携 stonesBranch → 路由 feat worktree（建之、
 *     返回 `_stonesBranch=feat/<slug>`），优先于 sessionUsesWorktree。
 *  2. **回归护栏（关键）**：无 stonesBranch 绑定时 resolveStoneIdentityRef 对
 *     business session / super / main 的解析逐字节不变。
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ensureStoneRepo,
  ensureSessionWorktree,
  resolveStoneIdentityRef,
  createFeatBranchWorktree,
  __resetSerialQueueForTests,
} from "@ooc/core/persistable";

let tempRoots: string[] = [];

beforeEach(() => __resetSerialQueueForTests());
afterEach(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
  tempRoots = [];
});

async function newWorld(agents: string[]): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "_test_feat_binding_"));
  tempRoots.push(baseDir);
  for (const id of [...agents, "supervisor"]) {
    await mkdir(join(baseDir, "stones", id), { recursive: true });
    await writeFile(join(baseDir, "stones", id, "self.md"), `${id} v1\n`);
    await writeFile(
      join(baseDir, "stones", id, "package.json"),
      JSON.stringify({
        name: `@ooc-obj/${id.replace(/\//g, "-")}`,
        version: "0.1.0",
        private: true,
        type: "module",
        ooc: { objectId: id, kind: "object", type: "agent" },
      }),
      "utf8",
    );
  }
  await ensureStoneRepo({ baseDir });
  return baseDir;
}

describe("resolveStoneIdentityRef —— feat-branch 绑定覆盖优先 + 回归护栏", () => {
  // ── 回归护栏：无绑定时行为逐字节不变 ──
  test("回归：无 stonesBranch 绑定时，main / super / business session 解析与改前一致", async () => {
    const baseDir = await newWorld(["foo"]);

    // main：无 session → 裸 main ref（无 _stonesBranch）
    expect(await resolveStoneIdentityRef({ baseDir, objectId: "foo" }, "read")).toEqual({
      baseDir,
      objectId: "foo",
    });
    // super：super flow 直接 main（不建 worktree）
    expect(
      await resolveStoneIdentityRef({ baseDir, sessionId: "super", objectId: "foo" }, "write"),
    ).toEqual({ baseDir, objectId: "foo" });
    // business session read 未建 worktree → 透传 main
    expect(
      await resolveStoneIdentityRef({ baseDir, sessionId: "s1", objectId: "foo" }, "read"),
    ).toEqual({ baseDir, objectId: "foo" });
    // business session write → lazy 建 session worktree，带 session-<sid> 分支
    const bizWrite = await resolveStoneIdentityRef(
      { baseDir, sessionId: "s1", objectId: "foo" },
      "write",
    );
    expect(bizWrite._stonesBranch).toBe("session-s1");
    // 已建后 business session read → 命中 session worktree
    const bizRead = await resolveStoneIdentityRef(
      { baseDir, sessionId: "s1", objectId: "foo" },
      "read",
    );
    expect(bizRead._stonesBranch).toBe("session-s1");
  });

  // ── 核心机制：绑定覆盖优先 ──
  test("绑定优先：带 stonesBranch 时返回 feat 分支 ref（即便在 business session 下）", async () => {
    const baseDir = await newWorld(["foo"]);
    const branch = await createFeatBranchWorktree({
      baseDir,
      intent: "tighten foo identity",
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) return;
    expect(branch.branch).toBe("feat/tighten-foo-identity");

    // feat 绑定存在 → 覆盖优先返回 feat 分支 ref（无视 session）
    const featRef = await resolveStoneIdentityRef(
      { baseDir, sessionId: "s1", objectId: "foo", stonesBranch: branch.branch },
      "write",
    );
    expect(featRef._stonesBranch).toBe(branch.branch);
    // 同一绑定在 super flow 下也优先 feat（super 不建 session worktree，但 feat 绑定生效）
    const featRefSuper = await resolveStoneIdentityRef(
      { baseDir, sessionId: "super", objectId: "foo", stonesBranch: branch.branch },
      "write",
    );
    expect(featRefSuper._stonesBranch).toBe(branch.branch);

    // feat worktree 物理落 stones/feat/<slug>/，从 main 派生 → self.md=v1
    const featSelf = join(baseDir, "stones", branch.branch, "objects", "foo", "self.md");
    expect((await stat(featSelf)).isFile()).toBe(true);
    expect(await readFile(featSelf, "utf8")).toBe("foo v1\n");
  });

  test("绑定与 session worktree 互不污染：business session 写不落 feat、feat 绑定写不落 session", async () => {
    const baseDir = await newWorld(["foo"]);
    // 先建一个 business session worktree
    await ensureSessionWorktree(baseDir, "s1");
    const branch = await createFeatBranchWorktree({ baseDir, intent: "land foo v2" });
    expect(branch.ok).toBe(true);
    if (!branch.ok) return;

    // 无绑定的 s1 write → session 分支
    const sessRef = await resolveStoneIdentityRef(
      { baseDir, sessionId: "s1", objectId: "foo" },
      "write",
    );
    expect(sessRef._stonesBranch).toBe("session-s1");

    // 带 feat 绑定的 s1 write → feat 分支（绑定优先，未污染 session 解析）
    const featRef = await resolveStoneIdentityRef(
      { baseDir, sessionId: "s1", objectId: "foo", stonesBranch: branch.branch },
      "write",
    );
    expect(featRef._stonesBranch).toBe(branch.branch);
  });
});

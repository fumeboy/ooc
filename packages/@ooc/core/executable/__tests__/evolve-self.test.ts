/**
 * P3 super-flow evolve_self —— 身份合入闸门端到端验证（worktree 统一模型，design §4）。
 *
 * 场景：
 *  1. 业务 session 改 self.md → 该 session 的 worktree（P2）。
 *  2. super flow（带 creatorSessionId=业务 session）调 evolve_self diff → 列出改动文件。
 *  3. evolve_self merge → commit session 分支 + ff-merge main（署名 = objectId，非 bootstrap），
 *     worktree GC（移除目录 + 删分支）。
 *  4. 新 session 读到新身份（canonical main）。
 *  5. 错误路径：非 super flow / 无改动 → fail-loud，main 不变。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, __resetSerialQueueForTests, readSelf } from "@ooc/core/persistable";
import { executeWriteFileMethod } from "@ooc/builtins/root/executable/method.write-file";
import { executeEvolveSelf } from "@ooc/builtins/root/executable/method.evolve-self";
import type { MethodExecutionContext } from "@ooc/core/extendable/_shared/method-types";

let tempRoots: string[] = [];

beforeEach(() => __resetSerialQueueForTests());
afterEach(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
  tempRoots = [];
});

async function newWorld(agents: string[]): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-evolve-self-"));
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

function mainSelf(baseDir: string, id: string): string {
  return join(baseDir, "stones", "main", "objects", id, "self.md");
}

/** 业务 session ctx（write_file 走 worktree）。 */
function bizCtx(baseDir: string, objectId: string, sessionId: string, args: Record<string, unknown>) {
  return {
    thread: {
      persistence: { baseDir, objectId, sessionId, threadId: "t" },
      contextWindows: [],
      events: [],
    },
    args,
  } as unknown as MethodExecutionContext;
}

/** super flow ctx（带 creatorSessionId）。 */
function superCtx(
  baseDir: string,
  objectId: string,
  creatorSessionId: string | undefined,
  args: Record<string, unknown>,
) {
  return {
    thread: {
      persistence: { baseDir, objectId, sessionId: "super", threadId: "tS" },
      creatorSessionId,
      contextWindows: [],
      events: [],
    },
    args,
  } as unknown as MethodExecutionContext;
}

function gitLastAuthor(baseDir: string): string {
  const log = Bun.spawnSync(["git", "log", "-1", "--pretty=%an"], {
    cwd: join(baseDir, "stones", "main"),
    stdout: "pipe",
  });
  return new TextDecoder().decode(log.stdout).trim();
}

describe("evolve_self (P3)", () => {
  test("diff mode lists worktree files; merge mode commits to main (author=objectId); new session sees it", async () => {
    const baseDir = await newWorld(["alice"]);

    // 1. 业务 session s1 改 self.md → worktree
    await executeWriteFileMethod(
      bizCtx(baseDir, "alice", "s1", { path: "stones/alice/self.md", content: "alice v2 (evolved)\n" }),
    );
    // main 未变
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v1\n");

    // 2. super flow diff（无 message）
    const diffOut = await executeEvolveSelf(superCtx(baseDir, "alice", "s1", {}));
    expect(typeof diffOut).toBe("string");
    const diff = JSON.parse(diffOut as string);
    expect(diff.kind).toBe("diff");
    // 去 metaprog 后 evolve_self 列全部 objects/ 改动，files 带 owner 段前缀（区分 cross-object）。
    expect(diff.files).toEqual(["alice/self.md"]);

    // 3. super flow merge
    const mergeOut = await executeEvolveSelf(
      superCtx(baseDir, "alice", "s1", { message: "evolve: tighten self-identity" }),
    );
    const merge = JSON.parse(mergeOut as string);
    expect(merge.ok).toBe(true);
    expect(merge.kind).toBe("merged");
    expect(typeof merge.commitSha).toBe("string");
    expect(merge.files).toEqual(["alice/self.md"]);

    // main 已更新
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v2 (evolved)\n");
    // git commit 署名 = alice（非 bootstrap/supervisor）
    expect(gitLastAuthor(baseDir)).toBe("alice");

    // worktree 身份解除（.git link 删），flows/s1 运行时目录保留——方案 A 物理合一，对话不丢
    expect((await stat(join(baseDir, "flows", "s1"))).isDirectory()).toBe(true);
    await expect(
      stat(join(baseDir, "flows", "s1", ".git")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    // 4. 新 session（s2，无 worktree）读 canonical main → 新身份
    const got = await readSelf({ baseDir, objectId: "alice" });
    expect(got).toBe("alice v2 (evolved)\n");
  });

  test("merge 合入整个 session 的多文件改动（session 分支即演化单元）", async () => {
    const baseDir = await newWorld(["alice"]);
    await executeWriteFileMethod(
      bizCtx(baseDir, "alice", "s1", { path: "stones/alice/self.md", content: "self v2\n" }),
    );
    await executeWriteFileMethod(
      bizCtx(baseDir, "alice", "s1", {
        path: "stones/alice/executable/index.ts",
        content: "export const methods = {};\n",
      }),
    );

    // diff sees both（files 带 owner 段前缀）
    const diff = JSON.parse((await executeEvolveSelf(superCtx(baseDir, "alice", "s1", {}))) as string);
    expect(diff.files.sort()).toEqual(["alice/executable/index.ts", "alice/self.md"]);

    // merge 整个 session（不再支持挑文件子集）→ 两个文件都合入 main
    const merge = JSON.parse(
      (await executeEvolveSelf(
        superCtx(baseDir, "alice", "s1", { message: "evolve both" }),
      )) as string,
    );
    expect(merge.files.sort()).toEqual(["alice/executable/index.ts", "alice/self.md"]);
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("self v2\n");
    // executable 也已合入 main
    expect(
      await readFile(join(baseDir, "stones", "main", "objects", "alice", "executable", "index.ts"), "utf8"),
    ).toBe("export const methods = {};\n");
  });

  test("cross-scope: 业务 session 改别人 stone → evolve_self 整体走 PR-Issue，main 不变", async () => {
    // 去 metaprog（2026-06-09）：业务 session 的 write_file 对**任何** stone（含别人）的写
    // 都落同一 session worktree；evolve_self 列全部 objects/ 改动，tryMergeSelf 把含 cross-object
    // 的 session 整体判 must-pr-issue → requestPrIssueReview。
    const baseDir = await newWorld(["alice", "bob"]);

    // 1. 业务 session s1（caller=alice）改 alice 自己 + bob（cross-object）→ 同一 worktree
    await executeWriteFileMethod(
      bizCtx(baseDir, "alice", "s1", { path: "stones/alice/self.md", content: "alice v2\n" }),
    );
    await executeWriteFileMethod(
      bizCtx(baseDir, "alice", "s1", { path: "stones/bob/self.md", content: "bob edited by alice\n" }),
    );

    // 2. diff 列出全部改动（含 cross-object bob/self.md，前缀含 owner 段）
    const diff = JSON.parse((await executeEvolveSelf(superCtx(baseDir, "alice", "s1", {}))) as string);
    expect(diff.files.sort()).toEqual(["alice/self.md", "bob/self.md"]);

    // 3. merge → cross-scope 整体走 PR-Issue（merged=false + prIssueId），main 不变
    const merge = JSON.parse(
      (await executeEvolveSelf(
        superCtx(baseDir, "alice", "s1", { message: "evolve crossing into bob" }),
      )) as string,
    );
    expect(merge.ok).toBe(true);
    expect(merge.kind).toBe("pr-issue");
    expect(typeof merge.prIssueId).toBe("number");
    expect(merge.prIssueId).toBeGreaterThan(0);

    // main 两边都未变（cross-scope 不直接合入）
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v1\n");
    expect(await readFile(mainSelf(baseDir, "bob"), "utf8")).toBe("bob v1\n");
  });

  test("fail-loud: not in super flow → error, main unchanged", async () => {
    const baseDir = await newWorld(["alice"]);
    await executeWriteFileMethod(
      bizCtx(baseDir, "alice", "s1", { path: "stones/alice/self.md", content: "v2\n" }),
    );
    const out = await executeEvolveSelf(bizCtx(baseDir, "alice", "s1", { message: "x" }));
    expect(out).toContain("仅 super flow");
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v1\n");
  });

  test("fail-loud: missing creatorSessionId → error", async () => {
    const baseDir = await newWorld(["alice"]);
    const out = await executeEvolveSelf(superCtx(baseDir, "alice", undefined, { message: "x" }));
    expect(out).toContain("creatorSessionId");
  });

  test("no worktree changes to merge → NO_CHANGES error, main unchanged", async () => {
    const baseDir = await newWorld(["alice"]);
    const out = await executeEvolveSelf(superCtx(baseDir, "alice", "s1", { message: "x" }));
    expect(out).toContain("[evolve_self:NO_CHANGES]");
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v1\n");
  });
});

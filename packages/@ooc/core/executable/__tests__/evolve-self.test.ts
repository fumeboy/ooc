/**
 * P3 super-flow evolve_self —— 身份合入闸门端到端验证（design §4）。
 *
 * 场景：
 *  1. 业务 session 改 self.md → overlay（P2）。
 *  2. super flow（带 creatorSessionId=业务 session）调 evolve_self diff → 列出改动文件。
 *  3. evolve_self merge → main self.md 更新 + git commit（署名 = objectId，非 bootstrap）。
 *  4. 新 session 读到新身份（canonical main）。
 *  5. 错误路径：非 super flow / 无 overlay → fail-loud，main 不变。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, __resetSerialQueueForTests, readStoneFileWithOverlay, readSelf } from "@ooc/core/persistable";
import { executeWriteFileCommand } from "@ooc/builtins/root/executable/method.write-file";
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

/** 业务 session ctx（write_file 走 overlay）。 */
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
  test("diff mode lists overlay files; merge mode commits to main (author=objectId); new session sees it", async () => {
    const baseDir = await newWorld(["alice"]);

    // 1. 业务 session s1 改 self.md → overlay
    await executeWriteFileCommand(
      bizCtx(baseDir, "alice", "s1", { path: "stones/alice/self.md", content: "alice v2 (evolved)\n" }),
    );
    // main 未变
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v1\n");

    // 2. super flow diff（无 message）
    const diffOut = await executeEvolveSelf(superCtx(baseDir, "alice", "s1", {}));
    expect(typeof diffOut).toBe("string");
    const diff = JSON.parse(diffOut as string);
    expect(diff.kind).toBe("diff");
    expect(diff.files).toEqual(["self.md"]);

    // 3. super flow merge
    const mergeOut = await executeEvolveSelf(
      superCtx(baseDir, "alice", "s1", { message: "evolve: tighten self-identity" }),
    );
    const merge = JSON.parse(mergeOut as string);
    expect(merge.ok).toBe(true);
    expect(merge.kind).toBe("merged");
    expect(typeof merge.commitSha).toBe("string");
    expect(merge.files).toEqual(["self.md"]);

    // main 已更新
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v2 (evolved)\n");
    // git commit 署名 = alice（非 bootstrap/supervisor）
    expect(gitLastAuthor(baseDir)).toBe("alice");

    // 4. 新 session（s2，无 overlay）读 canonical main → 新身份
    const got = await readStoneFileWithOverlay(baseDir, "s2", "alice", "self.md", () =>
      readSelf({ baseDir, objectId: "alice" }),
    );
    expect(got).toBe("alice v2 (evolved)\n");
  });

  test("merge supports multiple files + files subset selection", async () => {
    const baseDir = await newWorld(["alice"]);
    await executeWriteFileCommand(
      bizCtx(baseDir, "alice", "s1", { path: "stones/alice/self.md", content: "self v2\n" }),
    );
    await executeWriteFileCommand(
      bizCtx(baseDir, "alice", "s1", {
        path: "stones/alice/executable/index.ts",
        content: "export const methods = {};\n",
      }),
    );

    // diff sees both
    const diff = JSON.parse((await executeEvolveSelf(superCtx(baseDir, "alice", "s1", {}))) as string);
    expect(diff.files.sort()).toEqual(["executable/index.ts", "self.md"]);

    // merge only self.md
    const merge = JSON.parse(
      (await executeEvolveSelf(
        superCtx(baseDir, "alice", "s1", { message: "only self", files: ["self.md"] }),
      )) as string,
    );
    expect(merge.files).toEqual(["self.md"]);
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("self v2\n");
    // executable 未合入 main
    await expect(
      readFile(join(baseDir, "stones", "main", "objects", "alice", "executable", "index.ts"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("fail-loud: not in super flow → error, main unchanged", async () => {
    const baseDir = await newWorld(["alice"]);
    await executeWriteFileCommand(
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

  test("no overlay to merge → NO_OVERLAY error, main unchanged", async () => {
    const baseDir = await newWorld(["alice"]);
    const out = await executeEvolveSelf(superCtx(baseDir, "alice", "s1", { message: "x" }));
    expect(out).toContain("[evolve_self:NO_OVERLAY]");
    expect(await readFile(mainSelf(baseDir, "alice"), "utf8")).toBe("alice v1\n");
  });
});

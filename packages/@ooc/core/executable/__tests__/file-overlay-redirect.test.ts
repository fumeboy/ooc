/**
 * worktree 重定向——file builtin 路径（write_file / open_file / edit）的端到端验证。
 *
 * 验证 worktree 统一模型：
 * - 业务 session 对自己 stone identity 文件的 write_file → 落该 session 的 worktree（main 不变）。
 * - open_file 自己 stone 文件时：已建 worktree（改过）读 worktree，未建读 main canonical。
 * - file_window.edit 对自己 stone 文件 → 改动落 worktree（worktree 是 main 完整副本，读写同一路径）。
 * - 别 session / super flow 不受影响（读写 canonical main）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, __resetSerialQueueForTests } from "@ooc/core/persistable";
import { executeWriteFileMethod } from "@ooc/builtins/root/executable/method.write-file";
import { executeOpenFileMethod } from "@ooc/builtins/root/executable/method.open-file";
import { executeFileWindowEdit } from "@ooc/builtins/file/executable/index";
import type { MethodExecutionContext } from "@ooc/core/extendable/_shared/method-types";
import type { FileWindow } from "@ooc/builtins/file/types";

let tempRoots: string[] = [];

beforeEach(() => __resetSerialQueueForTests());

afterEach(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
  tempRoots = [];
});

async function newWorld(agents: string[]): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-file-worktree-"));
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
  // ensureStoneRepo migrate flat → main 并 commit（worktree 从 main HEAD checkout 须先 commit）。
  await ensureStoneRepo({ baseDir });
  return baseDir;
}

function ctxFor(
  baseDir: string,
  objectId: string,
  sessionId: string,
  args: Record<string, unknown>,
  self?: unknown,
): MethodExecutionContext {
  const thread = {
    persistence: { baseDir, objectId, sessionId, threadId: "t" },
    contextWindows: [] as unknown[],
    events: [] as unknown[],
  };
  return { thread, args, self } as unknown as MethodExecutionContext;
}

function mainObjectsDir(baseDir: string): string {
  return join(baseDir, "stones", "main", "objects");
}

/** session worktree 内某 object 的目录：`stones/session-<sid>/objects/<id>`。 */
function worktreeObjDir(baseDir: string, sessionId: string, objectId: string): string {
  return join(baseDir, "stones", `session-${sessionId}`, "objects", objectId);
}

function asFileWindow(out: unknown): FileWindow {
  if (typeof out === "object" && out && (out as { ok?: boolean }).ok === true && "object" in (out as object)) {
    return (out as { object: FileWindow }).object;
  }
  throw new Error(`expected success constructor outcome, got ${JSON.stringify(out)}`);
}

describe("file worktree redirect (P2)", () => {
  test("write_file own stone → worktree; main unchanged", async () => {
    const baseDir = await newWorld(["alice"]);
    const out = await executeWriteFileMethod(
      ctxFor(baseDir, "alice", "s1", {
        path: "stones/alice/self.md",
        content: "alice v2 (worktree)\n",
      }),
    );
    const win = asFileWindow(out);
    expect(win.path).toBe(join(worktreeObjDir(baseDir, "s1", "alice"), "self.md"));

    expect(await readFile(join(worktreeObjDir(baseDir, "s1", "alice"), "self.md"), "utf8")).toBe(
      "alice v2 (worktree)\n",
    );
    expect(await readFile(join(mainObjectsDir(baseDir), "alice", "self.md"), "utf8")).toBe(
      "alice v1\n",
    );
  });

  test("open_file own stone with prior worktree write → window points at worktree", async () => {
    const baseDir = await newWorld(["alice"]);
    // 先在 s1 写 → lazy 建 worktree
    await executeWriteFileMethod(
      ctxFor(baseDir, "alice", "s1", { path: "stones/alice/self.md", content: "WORKTREE\n" }),
    );
    // open_file 同 session → 命中 worktree
    const opened = asFileWindow(
      await executeOpenFileMethod(ctxFor(baseDir, "alice", "s1", { path: "stones/alice/self.md" })),
    );
    expect(opened.path).toBe(join(worktreeObjDir(baseDir, "s1", "alice"), "self.md"));
    expect(await readFile(opened.path, "utf8")).toBe("WORKTREE\n");
  });

  test("open_file own stone WITHOUT prior write → canonical main（read 不主动建 worktree）", async () => {
    const baseDir = await newWorld(["alice"]);
    const opened = asFileWindow(
      await executeOpenFileMethod(ctxFor(baseDir, "alice", "s2", { path: "stones/alice/self.md" })),
    );
    expect(opened.path).toBe(join(mainObjectsDir(baseDir), "alice", "self.md"));
    expect(await readFile(opened.path, "utf8")).toBe("alice v1\n");
  });

  test("edit own stone from a canonical-pointing window → write lands in worktree, main unchanged", async () => {
    const baseDir = await newWorld(["alice"]);
    // window 指向 canonical main（模拟 open_file 在无 worktree 时拿到的 window）
    const window: FileWindow = {
      id: "w_file_x",
      type: "file",
      parentWindowId: "root",
      title: "self.md",
      status: "open",
      createdAt: Date.now(),
      path: join(mainObjectsDir(baseDir), "alice", "self.md"),
    };
    const err = await executeFileWindowEdit(
      ctxFor(baseDir, "alice", "s1", { old: "alice v1", new: "alice v2-edited" }, window),
    );
    expect(err).toBeUndefined();

    // worktree 收到改动（首次以 main checkout 为底 = "alice v1"）
    expect(await readFile(join(worktreeObjDir(baseDir, "s1", "alice"), "self.md"), "utf8")).toBe(
      "alice v2-edited\n",
    );
    // main 未变
    expect(await readFile(join(mainObjectsDir(baseDir), "alice", "self.md"), "utf8")).toBe(
      "alice v1\n",
    );
  });

  test("second edit uses worktree as base (not stale canonical)", async () => {
    const baseDir = await newWorld(["alice"]);
    const window: FileWindow = {
      id: "w_file_x",
      type: "file",
      parentWindowId: "root",
      title: "self.md",
      status: "open",
      createdAt: Date.now(),
      path: join(mainObjectsDir(baseDir), "alice", "self.md"),
    };
    await executeFileWindowEdit(
      ctxFor(baseDir, "alice", "s1", { old: "alice v1", new: "line-A" }, window),
    );
    // 第二次 edit：old 应在 worktree 当前内容里（line-A），不是 main（alice v1）
    const err = await executeFileWindowEdit(
      ctxFor(baseDir, "alice", "s1", { old: "line-A", new: "line-B" }, window),
    );
    expect(err).toBeUndefined();
    expect(await readFile(join(worktreeObjDir(baseDir, "s1", "alice"), "self.md"), "utf8")).toBe(
      "line-B\n",
    );
  });

  test("super flow edit own stone → writes canonical directly (no worktree)", async () => {
    const baseDir = await newWorld(["alice"]);
    const window: FileWindow = {
      id: "w_file_x",
      type: "file",
      parentWindowId: "root",
      title: "self.md",
      status: "open",
      createdAt: Date.now(),
      path: join(mainObjectsDir(baseDir), "alice", "self.md"),
    };
    await executeFileWindowEdit(
      ctxFor(baseDir, "alice", "super", { old: "alice v1", new: "alice super-edit" }, window),
    );
    expect(await readFile(join(mainObjectsDir(baseDir), "alice", "self.md"), "utf8")).toBe(
      "alice super-edit\n",
    );
    // 无 session worktree 副本
    await expect(
      readFile(join(worktreeObjDir(baseDir, "super", "alice"), "self.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

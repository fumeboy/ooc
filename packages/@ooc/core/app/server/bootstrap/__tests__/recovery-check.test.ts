import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ensureStoneRepo,
  __resetSerialQueueForTests,
  readPrIssueIndex,
  createRecoveryIssue,
  nestedObjectPath,
} from "@ooc/core/persistable";
import { runRecoveryCheck } from "../recovery-check";
import { clearServerLoaderCache } from "@ooc/core/runtime/server-loader";

let tempRoot: string | undefined;

beforeEach(() => {
  __resetSerialQueueForTests();
  clearServerLoaderCache();
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

/**
 * 在 canonical 布局 `stones/main/objects/<nestedId>/` 下落一个 stone。
 * recovery-check 经 StoneRegistry 扫的就是这里（不再是 deprecated packages/）。
 *
 * Wave4：load-detection 的入口是 `index.ts`（`export const Class` 装配口），不再是旧
 * barrel `executable/index.ts`。recovery-check 仍用 readExecutableSource 作「该 stone 有后端
 * 程序」的门控（读 executable/index.ts），再 loadStoneClass(index.ts) 试加载。故模拟「broken
 * stone」要：(a) 给个 executable/index.ts 通过门控，(b) 给个**坏 index.ts** 让加载抛错。
 */
async function seedStone(
  baseDir: string,
  objectId: string,
  opts: { self?: string; executable?: string; index?: string } = {},
): Promise<void> {
  const dir = join(baseDir, "stones", "main", "objects", ...nestedObjectPath(objectId));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "self.md"), opts.self ?? `${objectId} v1\n`);
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: `@ooc-obj/${objectId.replace(/\//g, "-")}`,
      version: "0.1.0",
      private: true,
      type: "module",
      ooc: { objectId, kind: "object", type: "agent" },
    }),
    "utf8",
  );
  if (opts.executable !== undefined) {
    await mkdir(join(dir, "executable"), { recursive: true });
    await writeFile(join(dir, "executable", "index.ts"), opts.executable, "utf8");
  }
  if (opts.index !== undefined) {
    await writeFile(join(dir, "index.ts"), opts.index, "utf8");
  }
}

async function newWorld(): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), "ooc-recovery-"));
  await ensureStoneRepo({ baseDir: tempRoot });
  // supervisor 是 recovery issue 的 createdByObjectId
  await seedStone(tempRoot, "supervisor", { self: "supervisor v1\n" });
  return tempRoot;
}

describe("runRecoveryCheck", () => {
  test("scans clean repo without creating any issue", async () => {
    const baseDir = await newWorld();
    await seedStone(baseDir, "agent_of_x", { self: "agent_of_x v1\n" });

    const r = await runRecoveryCheck({ baseDir });
    expect(r.scanned).toBeGreaterThanOrEqual(2);
    expect(r.broken).toEqual([]);
    expect(r.newIssues).toEqual([]);
  });

  test("creates [recovery-needed] issue when index.ts has syntax error", async () => {
    const baseDir = await newWorld();
    await seedStone(baseDir, "agent_of_x", {
      self: "agent_of_x v1\n",
      // executable/index.ts 通过「有后端程序」门控；坏 index.ts 让 loadStoneClass 抛错。
      executable: "export default { methods: [] }\n",
      index: "this is not valid typescript &^$@!\n",
    });

    const r = await runRecoveryCheck({ baseDir });
    expect(r.broken.length).toBe(1);
    expect(r.broken[0].objectId).toBe("agent_of_x");
    expect(r.newIssues.length).toBe(1);

    const index = await readPrIssueIndex(baseDir);
    expect(index.issues[0].title.startsWith("[recovery-needed]")).toBe(true);
  });

  test("idempotent: pre-existing recovery-needed issue is not duplicated", async () => {
    const baseDir = await newWorld();
    await seedStone(baseDir, "agent_of_y", {
      self: "agent_of_y v1\n",
      executable: "export default { methods: [] }\n",
      index: "still broken &^&^!\n",
    });

    // 预置一条同 title 的 issue 模拟"上一次启动已经报过"
    await createRecoveryIssue({
      baseDir,
      title: "[recovery-needed] agent_of_y stone unloadable",
      createdByObjectId: "supervisor",
    });

    const r = await runRecoveryCheck({ baseDir });
    expect(r.broken.length).toBe(1);
    // 已存在同 title open issue → 不开新的
    expect(r.newIssues.length).toBe(0);

    const index = await readPrIssueIndex(baseDir);
    const recoveryIssues = index.issues.filter((i) => i.title.startsWith("[recovery-needed]"));
    expect(recoveryIssues.length).toBe(1);
  });

  test("ignores Object without executable/index.ts", async () => {
    const baseDir = await newWorld();
    await seedStone(baseDir, "passive_agent", { self: "no executable methods\n" });

    const r = await runRecoveryCheck({ baseDir });
    expect(r.broken).toEqual([]);
    expect(r.newIssues).toEqual([]);
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ensureStoneRepo,
  __resetSerialQueueForTests,
  readPrIssueIndex,
  createRecoveryIssue,
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

async function newWorld(): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), "ooc-recovery-"));
  // pre-create supervisor stone (createdByObjectId for recovery issues)
  await mkdir(join(tempRoot, "stones", "supervisor"), { recursive: true });
  await writeFile(join(tempRoot, "stones", "supervisor", "self.md"), "supervisor v1\n");
  await writeFile(
    join(tempRoot, "stones", "supervisor", "package.json"),
    JSON.stringify({
      name: "@ooc-obj/supervisor",
      version: "0.1.0",
      private: true,
      type: "module",
      ooc: { objectId: "supervisor", kind: "object", type: "agent" },
    }),
    "utf8",
  );
  return tempRoot;
}

/** Sync stones/main/objects/ to packages/ so runtime scans can find them. */
async function syncStonesToPackages(baseDir: string, objectIds: string[]): Promise<void> {
  const { cp } = await import("node:fs/promises");
  for (const id of objectIds) {
    const segs = id.split("/");
    const pathSegs = segs.flatMap((seg) => ["children", seg]).slice(1);
    const source = join(baseDir, "stones", "main", "objects", ...pathSegs);
    const target = join(baseDir, "packages", ...pathSegs);
    try {
      await cp(source, target, { recursive: true, force: true });
    } catch { /* source might not exist */ }
  }
}

describe("runRecoveryCheck", () => {
  test("scans clean repo without creating any issue", async () => {
    const baseDir = await newWorld();
    // 用真实 stone 内容（git 不跟踪空目录；bare bootstrap 后空 dir 会丢失）
    await mkdir(join(baseDir, "stones", "agent_of_x"), { recursive: true });
    await writeFile(join(baseDir, "stones", "agent_of_x", "self.md"), "agent_of_x v1\n");
    await writeFile(
      join(baseDir, "stones", "agent_of_x", "package.json"),
      JSON.stringify({
        name: "@ooc-obj/agent-of-x",
        version: "0.1.0",
        private: true,
        type: "module",
        ooc: { objectId: "agent_of_x", kind: "object", type: "agent" },
      }),
      "utf8",
    );
    await ensureStoneRepo({ baseDir });
    await syncStonesToPackages(baseDir, ["supervisor", "agent_of_x"]);

    const r = await runRecoveryCheck({ baseDir });
    expect(r.scanned).toBeGreaterThanOrEqual(2);
    expect(r.broken).toEqual([]);
    expect(r.newIssues).toEqual([]);
  });

  test("creates [recovery-needed] issue when server/index.ts has syntax error", async () => {
    const baseDir = await newWorld();
    await mkdir(join(baseDir, "stones", "agent_of_x", "server"), { recursive: true });
    await writeFile(
      join(baseDir, "stones", "agent_of_x", "server", "index.ts"),
      "this is not valid typescript &^$@!\n",
    );
    await writeFile(join(baseDir, "stones", "agent_of_x", "self.md"), "agent_of_x v1\n");
    await writeFile(
      join(baseDir, "stones", "agent_of_x", "package.json"),
      JSON.stringify({
        name: "@ooc-obj/agent-of-x",
        version: "0.1.0",
        private: true,
        type: "module",
        ooc: { objectId: "agent_of_x", kind: "object", type: "agent" },
      }),
      "utf8",
    );
    await ensureStoneRepo({ baseDir });
    await syncStonesToPackages(baseDir, ["supervisor", "agent_of_x"]);

    const r = await runRecoveryCheck({ baseDir });
    expect(r.broken.length).toBe(1);
    expect(r.broken[0].objectId).toBe("agent_of_x");
    expect(r.newIssues.length).toBe(1);

    const index = await readPrIssueIndex(baseDir);
    expect(index.issues[0].title.startsWith("[recovery-needed]")).toBe(true);
  });

  test("idempotent: pre-existing recovery-needed issue is not duplicated", async () => {
    const baseDir = await newWorld();
    await mkdir(join(baseDir, "stones", "agent_of_y", "server"), { recursive: true });
    await writeFile(
      join(baseDir, "stones", "agent_of_y", "server", "index.ts"),
      "still broken &^&^!\n",
    );
    await writeFile(join(baseDir, "stones", "agent_of_y", "self.md"), "agent_of_y v1\n");
    await writeFile(
      join(baseDir, "stones", "agent_of_y", "package.json"),
      JSON.stringify({
        name: "@ooc-obj/agent-of-y",
        version: "0.1.0",
        private: true,
        type: "module",
        ooc: { objectId: "agent_of_y", kind: "object", type: "agent" },
      }),
      "utf8",
    );
    await ensureStoneRepo({ baseDir });
    await syncStonesToPackages(baseDir, ["supervisor", "agent_of_y"]);

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

  test("ignores Object without server/index.ts", async () => {
    const baseDir = await newWorld();
    await mkdir(join(baseDir, "stones", "passive_agent"), { recursive: true });
    await writeFile(join(baseDir, "stones", "passive_agent", "self.md"), "no server methods\n");
    await writeFile(
      join(baseDir, "stones", "passive_agent", "package.json"),
      JSON.stringify({
        name: "@ooc-obj/passive-agent",
        version: "0.1.0",
        private: true,
        type: "module",
        ooc: { objectId: "passive_agent", kind: "object", type: "agent" },
      }),
      "utf8",
    );
    await ensureStoneRepo({ baseDir });
    await syncStonesToPackages(baseDir, ["supervisor", "passive_agent"]);

    const r = await runRecoveryCheck({ baseDir });
    expect(r.broken).toEqual([]);
    expect(r.newIssues).toEqual([]);
  });
});

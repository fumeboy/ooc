import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, __resetSerialQueueForTests, readIssueIndex, PR_ISSUE_SESSION_ID } from "@src/persistable";
import { runRecoveryCheck } from "../recovery-check";
import { clearServerLoaderCache } from "@src/executable/server/loader";

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
  return tempRoot;
}

describe("runRecoveryCheck", () => {
  test("scans clean repo without creating any issue", async () => {
    const baseDir = await newWorld();
    // 用真实 stone 内容（git 不跟踪空目录；bare bootstrap 后空 dir 会丢失）
    await mkdir(join(baseDir, "stones", "agent_of_x"), { recursive: true });
    await writeFile(join(baseDir, "stones", "agent_of_x", "self.md"), "agent_of_x v1\n");
    await ensureStoneRepo({ baseDir });

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
    await ensureStoneRepo({ baseDir });

    const r = await runRecoveryCheck({ baseDir });
    expect(r.broken.length).toBe(1);
    expect(r.broken[0].objectId).toBe("agent_of_x");
    expect(r.newIssues.length).toBe(1);

    const index = await readIssueIndex(baseDir, PR_ISSUE_SESSION_ID);
    expect(index.issues[0].title.startsWith("[recovery-needed]")).toBe(true);
  });

  test("idempotent: pre-existing recovery-needed issue is not duplicated", async () => {
    const baseDir = await newWorld();
    await mkdir(join(baseDir, "stones", "agent_of_y", "server"), { recursive: true });
    await writeFile(
      join(baseDir, "stones", "agent_of_y", "server", "index.ts"),
      "still broken &^&^!\n",
    );
    await ensureStoneRepo({ baseDir });

    // 预置一条同 title 的 issue 模拟"上一次启动已经报过"
    const { issuesService } = await import("@src/persistable");
    await issuesService.createIssue({
      baseDir,
      sessionId: PR_ISSUE_SESSION_ID,
      title: "[recovery-needed] agent_of_y stone unloadable",
      createdByObjectId: "supervisor",
    });

    const r = await runRecoveryCheck({ baseDir });
    expect(r.broken.length).toBe(1);
    // 已存在同 title open issue → 不开新的
    expect(r.newIssues.length).toBe(0);

    const index = await readIssueIndex(baseDir, PR_ISSUE_SESSION_ID);
    const recoveryIssues = index.issues.filter((i) => i.title.startsWith("[recovery-needed]"));
    expect(recoveryIssues.length).toBe(1);
  });

  test("ignores Object without server/index.ts", async () => {
    const baseDir = await newWorld();
    await mkdir(join(baseDir, "stones", "passive_agent"), { recursive: true });
    await writeFile(join(baseDir, "stones", "passive_agent", "self.md"), "no server methods\n");
    await ensureStoneRepo({ baseDir });

    const r = await runRecoveryCheck({ baseDir });
    expect(r.broken).toEqual([]);
    expect(r.newIssues).toEqual([]);
  });
});

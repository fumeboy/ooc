import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetSerialQueueForTests } from "@ooc/core/runtime/serial-queue";
import {
  createPrIssue,
  createRecoveryIssue,
  readPrIssue,
  readPrIssueIndex,
  PR_ISSUE_SESSION_ID,
} from "../persistable/pr-issue";

let tempRoot: string | undefined;

beforeEach(() => __resetSerialQueueForTests());

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

async function newWorld(): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), "ooc-pr-issue-"));
  // pre-create stones/main/objects/agent_of_x to satisfy ensureAuthorExists
  await mkdir(join(tempRoot, "stones", "main", "objects", "agent_of_x"), { recursive: true });
  return tempRoot;
}

const samplePayload = {
  intent: "更新自己的 self.md 加入新角色描述",
  branch: "metaprog/agent_of_x/abc123",
  diff: "diff --git a/agent_of_x/self.md ...",
  paths: ["agent_of_x/self.md"],
  baseSha: "0123456789abcdef",
};

describe("createPrIssue", () => {
  test("writes to flows/super/issues/ regardless of caller's session", async () => {
    const baseDir = await newWorld();
    const issue = await createPrIssue({
      baseDir,
      title: "update agent_of_x self",
      createdByObjectId: "agent_of_x",
      prPayload: samplePayload,
    });

    expect(issue.id).toBe(1);
    expect(issue.title).toBe("[PR] update agent_of_x self");
    expect(issue.prPayload).toEqual(samplePayload);

    const round = await readPrIssue(baseDir, issue.id);
    expect(round?.prPayload).toEqual(samplePayload);

    // index in super session
    const index = await readPrIssueIndex(baseDir);
    expect(index.nextId).toBe(2);
    expect(index.issues[0].title).toBe("[PR] update agent_of_x self");
  });

  test("does not double-prefix [PR] when title already has it", async () => {
    const baseDir = await newWorld();
    const issue = await createPrIssue({
      baseDir,
      title: "[PR] explicit",
      createdByObjectId: "agent_of_x",
      prPayload: samplePayload,
    });
    expect(issue.title).toBe("[PR] explicit");
  });

  test("rejects invalid payloads", async () => {
    const baseDir = await newWorld();
    const base = {
      baseDir,
      title: "x",
      createdByObjectId: "agent_of_x",
    };
    await expect(
      createPrIssue({ ...base, prPayload: { ...samplePayload, intent: "" } }),
    ).rejects.toThrow(/intent required/);
    await expect(
      createPrIssue({ ...base, prPayload: { ...samplePayload, branch: "" } }),
    ).rejects.toThrow(/branch required/);
    await expect(
      createPrIssue({ ...base, prPayload: { ...samplePayload, branch: "evil/.." } }),
    ).rejects.toThrow(/branch unsafe/);
    await expect(
      createPrIssue({ ...base, prPayload: { ...samplePayload, baseSha: "" } }),
    ).rejects.toThrow(/baseSha required/);
    await expect(
      createPrIssue({
        ...base,
        prPayload: { ...samplePayload, paths: Array.from({ length: 201 }, (_, i) => `p${i}`) },
      }),
    ).rejects.toThrow(/too many/);
    await expect(
      createPrIssue({
        ...base,
        prPayload: { ...samplePayload, diff: "x".repeat(70_000) },
      }),
    ).rejects.toThrow(/diff too long/);
  });

  test("rejects unknown createdByObjectId (no stones/main/<id>/)", async () => {
    const baseDir = await newWorld();
    await expect(
      createPrIssue({
        baseDir,
        title: "x",
        createdByObjectId: "ghost",
        prPayload: samplePayload,
      }),
    ).rejects.toThrow(/does not exist in stones/);
  });
});

describe("createRecoveryIssue (diagnostic, no prPayload)", () => {
  test("creates issue without prPayload in same super session", async () => {
    const baseDir = await newWorld();
    const issue = await createRecoveryIssue({
      baseDir,
      title: "[recovery-needed] agent_of_x stone unloadable",
      createdByObjectId: "agent_of_x",
    });
    expect(issue.prPayload).toBeUndefined();
    expect(issue.title).toBe("[recovery-needed] agent_of_x stone unloadable");

    const round = await readPrIssue(baseDir, issue.id);
    expect(round?.prPayload).toBeUndefined();
  });

  test("rejects unknown createdByObjectId", async () => {
    const baseDir = await newWorld();
    await expect(
      createRecoveryIssue({
        baseDir,
        title: "x",
        createdByObjectId: "ghost",
      }),
    ).rejects.toThrow(/does not exist in stones/);
  });
});

describe("PR_ISSUE_SESSION_ID constant", () => {
  test('equals "super"', () => {
    expect(PR_ISSUE_SESSION_ID).toBe("super");
  });
});

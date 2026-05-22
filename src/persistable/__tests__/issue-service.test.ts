import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetSerialQueueForTests } from "../serial-queue";
import { createStoneObject } from "../stone-object";
import { findIssueSubscribers, issuesService } from "../issue-service";
import type { ThreadContext } from "../../thinkable/context";
import type { IssueWindow } from "../../executable/windows/_shared/types";

let tempBase: string | undefined;

beforeEach(() => {
  __resetSerialQueueForTests();
});

afterEach(async () => {
  if (tempBase) {
    await rm(tempBase, { recursive: true, force: true });
    tempBase = undefined;
  }
});

async function newBase(): Promise<string> {
  tempBase = await mkdtemp(join(tmpdir(), "ooc-issuesvc-"));
  return tempBase;
}

async function seedStone(baseDir: string, objectId: string) {
  await createStoneObject({ baseDir, objectId });
}

describe("issuesService.createIssue", () => {
  test("creates Issue with id=1, status=open, returns full record", async () => {
    const base = await newBase();
    await seedStone(base, "alice");

    const issue = await issuesService.createIssue({
      baseDir: base,
      sessionId: "s1",
      title: "rename X",
      description: "desc",
      createdByObjectId: "alice",
    });
    expect(issue.id).toBe(1);
    expect(issue.status).toBe("open");
    expect(issue.title).toBe("rename X");
    expect(issue.comments).toEqual([]);

    const got = await issuesService.getIssue({ baseDir: base, sessionId: "s1", issueId: 1 });
    expect(got).toEqual(issue);

    const list = await issuesService.listIssues({ baseDir: base, sessionId: "s1" });
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(1);
    expect(list[0]?.commentCount).toBe(0);
  });

  test("monotonic id allocation across two createIssue calls", async () => {
    const base = await newBase();
    await seedStone(base, "alice");

    const i1 = await issuesService.createIssue({
      baseDir: base,
      sessionId: "s1",
      title: "first",
      createdByObjectId: "alice",
    });
    const i2 = await issuesService.createIssue({
      baseDir: base,
      sessionId: "s1",
      title: "second",
      createdByObjectId: "alice",
    });
    expect(i1.id).toBe(1);
    expect(i2.id).toBe(2);
  });

  test("rejects empty title", async () => {
    const base = await newBase();
    await seedStone(base, "alice");
    await expect(
      issuesService.createIssue({
        baseDir: base,
        sessionId: "s1",
        title: "  ",
        createdByObjectId: "alice",
      }),
    ).rejects.toThrow(/title is required/);
  });

  test("rejects createdByObjectId that does not exist in stones/ (S3)", async () => {
    const base = await newBase();
    // No stone for "ghost"
    await expect(
      issuesService.createIssue({
        baseDir: base,
        sessionId: "s1",
        title: "x",
        createdByObjectId: "ghost",
      }),
    ).rejects.toThrow(/does not exist/);
  });
});

describe("issuesService.appendComment", () => {
  test("appends comment, increments commentId, updates index", async () => {
    const base = await newBase();
    await seedStone(base, "alice");
    const issue = await issuesService.createIssue({
      baseDir: base,
      sessionId: "s1",
      title: "x",
      createdByObjectId: "alice",
    });

    const r1 = await issuesService.appendComment({
      baseDir: base,
      sessionId: "s1",
      issueId: issue.id,
      text: "first",
      authorObjectId: "alice",
      authorKind: "llm",
    });
    expect(r1.commentId).toBe(1);

    const got = await issuesService.getIssue({ baseDir: base, sessionId: "s1", issueId: issue.id });
    expect(got?.comments).toHaveLength(1);
    expect(got?.comments[0]?.text).toBe("first");
    expect(got?.comments[0]?.authorKind).toBe("llm");

    const list = await issuesService.listIssues({ baseDir: base, sessionId: "s1" });
    expect(list[0]?.commentCount).toBe(1);
  });

  test("rejects text > 4096 chars (S2)", async () => {
    const base = await newBase();
    await seedStone(base, "alice");
    const issue = await issuesService.createIssue({
      baseDir: base,
      sessionId: "s1",
      title: "x",
      createdByObjectId: "alice",
    });
    await expect(
      issuesService.appendComment({
        baseDir: base,
        sessionId: "s1",
        issueId: issue.id,
        text: "x".repeat(4097),
        authorObjectId: "alice",
        authorKind: "llm",
      }),
    ).rejects.toThrow(/too long/);
  });

  test("rejects unknown author (S3)", async () => {
    const base = await newBase();
    await seedStone(base, "alice");
    const issue = await issuesService.createIssue({
      baseDir: base,
      sessionId: "s1",
      title: "x",
      createdByObjectId: "alice",
    });
    await expect(
      issuesService.appendComment({
        baseDir: base,
        sessionId: "s1",
        issueId: issue.id,
        text: "hi",
        authorObjectId: "ghost",
        authorKind: "user",
      }),
    ).rejects.toThrow(/does not exist/);
  });

  test("mentions: structured + text regex union deduped (P1)", async () => {
    const base = await newBase();
    await seedStone(base, "alice");
    const issue = await issuesService.createIssue({
      baseDir: base,
      sessionId: "s1",
      title: "x",
      createdByObjectId: "alice",
    });
    const r = await issuesService.appendComment({
      baseDir: base,
      sessionId: "s1",
      issueId: issue.id,
      text: "ping @bob",
      authorObjectId: "alice",
      authorKind: "llm",
      mentions: ["alice", "alice"], // dup will collapse
    });
    expect(r.resolved_mentions).toEqual(["alice", "bob"]);

    const got = await issuesService.getIssue({ baseDir: base, sessionId: "s1", issueId: issue.id });
    expect(got?.comments[0]?.mentions).toEqual(["alice", "bob"]);
  });

  test("rejects appending to closed issue", async () => {
    const base = await newBase();
    await seedStone(base, "alice");
    const issue = await issuesService.createIssue({
      baseDir: base,
      sessionId: "s1",
      title: "x",
      createdByObjectId: "alice",
    });
    await issuesService.closeIssue({ baseDir: base, sessionId: "s1", issueId: issue.id });
    await expect(
      issuesService.appendComment({
        baseDir: base,
        sessionId: "s1",
        issueId: issue.id,
        text: "late",
        authorObjectId: "alice",
        authorKind: "llm",
      }),
    ).rejects.toThrow(/closed/);
  });

  test("rejects nonexistent issueId", async () => {
    const base = await newBase();
    await seedStone(base, "alice");
    await expect(
      issuesService.appendComment({
        baseDir: base,
        sessionId: "s1",
        issueId: 999,
        text: "hi",
        authorObjectId: "alice",
        authorKind: "user",
      }),
    ).rejects.toThrow(/not found/);
  });

  test("concurrent appendComment retains monotonic commentId via SerialQueue", async () => {
    const base = await newBase();
    await seedStone(base, "alice");
    const issue = await issuesService.createIssue({
      baseDir: base,
      sessionId: "s1",
      title: "x",
      createdByObjectId: "alice",
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        issuesService.appendComment({
          baseDir: base,
          sessionId: "s1",
          issueId: issue.id,
          text: `c${i}`,
          authorObjectId: "alice",
          authorKind: "llm",
        }),
      ),
    );
    const ids = results.map((r) => r.commentId);
    expect(ids).toEqual([1, 2, 3, 4, 5]);

    const got = await issuesService.getIssue({ baseDir: base, sessionId: "s1", issueId: issue.id });
    expect(got?.comments).toHaveLength(5);
    const list = await issuesService.listIssues({ baseDir: base, sessionId: "s1" });
    expect(list[0]?.commentCount).toBe(5);
  });
});

describe("issuesService.closeIssue", () => {
  test("closes issue and updates index entry status", async () => {
    const base = await newBase();
    await seedStone(base, "alice");
    const issue = await issuesService.createIssue({
      baseDir: base,
      sessionId: "s1",
      title: "x",
      createdByObjectId: "alice",
    });
    const closed = await issuesService.closeIssue({
      baseDir: base,
      sessionId: "s1",
      issueId: issue.id,
    });
    expect(closed.status).toBe("closed");

    const list = await issuesService.listIssues({ baseDir: base, sessionId: "s1" });
    expect(list[0]?.status).toBe("closed");
  });

  test("closing twice is idempotent", async () => {
    const base = await newBase();
    await seedStone(base, "alice");
    const issue = await issuesService.createIssue({
      baseDir: base,
      sessionId: "s1",
      title: "x",
      createdByObjectId: "alice",
    });
    await issuesService.closeIssue({ baseDir: base, sessionId: "s1", issueId: issue.id });
    const again = await issuesService.closeIssue({
      baseDir: base,
      sessionId: "s1",
      issueId: issue.id,
    });
    expect(again.status).toBe("closed");
  });
});

describe("findIssueSubscribers (F4 push path scan)", () => {
  test("returns empty when no thread exists", async () => {
    const base = await newBase();
    const subs = await findIssueSubscribers(base, "s1", 1);
    expect(subs).toEqual([]);
  });

  test("finds threads with matching IssueWindow", async () => {
    const base = await newBase();

    // Manually create two threads:
    // - alice/t1 has IssueWindow #5 → match
    // - bob/t2 has IssueWindow #99 → no match
    // - carol/t3 has no IssueWindow → no match
    async function writeThreadFile(objectId: string, threadId: string, windows: object[]) {
      const dir = join(base, "flows", "s1", "objects", objectId, "threads", threadId);
      await mkdir(dir, { recursive: true });
      const thread: ThreadContext = {
        id: threadId,
        status: "running",
        events: [],
        contextWindows: windows as never,
      };
      await writeFile(join(dir, "thread.json"), JSON.stringify(thread), "utf8");
    }

    const aliceWindow: IssueWindow = {
      id: "w_issue_1",
      type: "issue",
      parentWindowId: "root",
      title: "Issue 5",
      status: "open",
      createdAt: 1,
      issueId: 5,
    };
    const bobWindow: IssueWindow = {
      id: "w_issue_2",
      type: "issue",
      parentWindowId: "root",
      title: "Issue 99",
      status: "open",
      createdAt: 1,
      issueId: 99,
    };
    await writeThreadFile("alice", "t1", [aliceWindow]);
    await writeThreadFile("bob", "t2", [bobWindow]);
    await writeThreadFile("carol", "t3", []);

    const subs = await findIssueSubscribers(base, "s1", 5);
    expect(subs).toHaveLength(1);
    expect(subs[0]?.objectId).toBe("alice");
    expect(subs[0]?.threadId).toBe("t1");
  });

  test("exceptThreadId / exceptObjectId excludes self-subscriber", async () => {
    const base = await newBase();
    async function writeThreadFile(objectId: string, threadId: string, windows: object[]) {
      const dir = join(base, "flows", "s1", "objects", objectId, "threads", threadId);
      await mkdir(dir, { recursive: true });
      const thread: ThreadContext = {
        id: threadId,
        status: "running",
        events: [],
        contextWindows: windows as never,
      };
      await writeFile(join(dir, "thread.json"), JSON.stringify(thread), "utf8");
    }
    const w: IssueWindow = {
      id: "w_issue_x",
      type: "issue",
      parentWindowId: "root",
      title: "Issue 5",
      status: "open",
      createdAt: 1,
      issueId: 5,
    };
    await writeThreadFile("alice", "t1", [w]);
    await writeThreadFile("bob", "t2", [w]);

    const subs = await findIssueSubscribers(base, "s1", 5, {
      exceptObjectId: "alice",
      exceptThreadId: "t1",
    });
    expect(subs).toHaveLength(1);
    expect(subs[0]?.objectId).toBe("bob");
  });

  test("returns empty when flows/{sid}/objects/ does not exist", async () => {
    const base = await newBase();
    // No flows directory created
    const subs = await findIssueSubscribers(base, "ghost-session", 1);
    expect(subs).toEqual([]);
  });
});

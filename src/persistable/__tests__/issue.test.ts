import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  issueFile,
  issueIndexFile,
  readIssue,
  readIssueIndex,
  writeIssue,
  writeIssueIndex,
  type Issue,
} from "../issue";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

async function newRoot(): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), "ooc-issue-"));
  return tempRoot;
}

function sampleIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    title: "rename function X",
    description: "需要改名以与新约定一致",
    status: "open",
    createdByObjectId: "alice",
    createdAt: 1000,
    lastUpdatedAt: 1000,
    comments: [],
    ...overrides,
  };
}

describe("issue path helpers", () => {
  test("issueFile composes expected absolute path", () => {
    const path = issueFile("/tmp/base", "sess1", 7);
    expect(path).toBe("/tmp/base/flows/sess1/issues/issue-7.json");
  });

  test("issueIndexFile composes expected absolute path", () => {
    const path = issueIndexFile("/tmp/base", "sess1");
    expect(path).toBe("/tmp/base/flows/sess1/issues/index.json");
  });

  test("issueFile rejects sessionId with path-traversal segments (S1)", () => {
    expect(() => issueFile("/tmp/base", "../etc", 1)).toThrow(/invalid sessionId/);
    expect(() => issueFile("/tmp/base", "good/bad", 1)).toThrow(/invalid sessionId/);
    expect(() => issueFile("/tmp/base", "..", 1)).toThrow(/invalid sessionId/);
    expect(() => issueFile("/tmp/base", "", 1)).toThrow(/invalid sessionId/);
  });

  test("issueFile rejects non-integer or negative issueId", () => {
    expect(() => issueFile("/tmp/base", "good", 1.5)).toThrow(/invalid issueId/);
    expect(() => issueFile("/tmp/base", "good", 0)).toThrow(/invalid issueId/);
    expect(() => issueFile("/tmp/base", "good", -3)).toThrow(/invalid issueId/);
  });

  test("issueIndexFile validates sessionId", () => {
    expect(() => issueIndexFile("/tmp/base", "..")).toThrow(/invalid sessionId/);
  });

  test("issueFile accepts legal sessionId variants", () => {
    expect(() => issueFile("/tmp/base", "sess-123", 1)).not.toThrow();
    expect(() => issueFile("/tmp/base", "A_b-2", 1)).not.toThrow();
    expect(() => issueFile("/tmp/base", "x".repeat(64), 1)).not.toThrow();
    expect(() => issueFile("/tmp/base", "x".repeat(65), 1)).toThrow();
  });
});

describe("writeIssue / readIssue", () => {
  test("write then read returns identical issue", async () => {
    const root = await newRoot();
    const original = sampleIssue({ id: 3, title: "tweak parser" });
    await writeIssue(root, "sess1", original);

    const got = await readIssue(root, "sess1", 3);
    expect(got).toEqual(original);
  });

  test("readIssue returns undefined for missing issue (ENOENT silent)", async () => {
    const root = await newRoot();
    const got = await readIssue(root, "sess1", 42);
    expect(got).toBeUndefined();
  });

  test("readIssue throws on malformed JSON (caller decides)", async () => {
    const root = await newRoot();
    // Manually create dir + bad file
    const { mkdir } = await import("node:fs/promises");
    const dir = join(root, "flows", "sess1", "issues");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "issue-9.json"), "{not valid json", "utf8");

    await expect(readIssue(root, "sess1", 9)).rejects.toThrow();
  });

  test("writeIssue mkdir recursive creates issues/ subdirectory", async () => {
    const root = await newRoot();
    // No prior flows/sess1/ created
    await writeIssue(root, "sess1", sampleIssue({ id: 1 }));
    const got = await readIssue(root, "sess1", 1);
    expect(got?.id).toBe(1);
  });
});

describe("writeIssueIndex / readIssueIndex", () => {
  test("readIssueIndex returns empty default when file does not exist", async () => {
    const root = await newRoot();
    const idx = await readIssueIndex(root, "sess1");
    expect(idx).toEqual({ nextId: 1, issues: [] });
  });

  test("write then read returns identical index", async () => {
    const root = await newRoot();
    const original = {
      nextId: 5,
      issues: [
        {
          id: 1,
          title: "first",
          status: "open" as const,
          commentCount: 2,
          createdByObjectId: "alice",
          createdAt: 100,
          lastUpdatedAt: 200,
        },
        {
          id: 4,
          title: "fourth",
          status: "closed" as const,
          commentCount: 0,
          createdByObjectId: "bob",
          createdAt: 300,
          lastUpdatedAt: 300,
        },
      ],
    };
    await writeIssueIndex(root, "sess1", original);

    const got = await readIssueIndex(root, "sess1");
    expect(got).toEqual(original);
  });
});

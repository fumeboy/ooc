import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import {
  readIssues, writeIssues, readTasks, writeTasks, nextId, now,
} from "../src/kanban/store";
import type { Issue, Task } from "../src/kanban/types";
import {
  createIssue, updateIssueStatus, createTask,
  createSubTask, updateSubTask, setIssueNewInfo,
} from "../src/kanban/methods";
import { commentOnIssue, listIssueComments, getIssue } from "../src/kanban/discussion";

const TEST_DIR = "/tmp/ooc-kanban-test";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("kanban store", () => {
  test("readIssues returns empty array when file missing", async () => {
    const issues = await readIssues(TEST_DIR);
    expect(issues).toEqual([]);
  });

  test("writeIssues then readIssues roundtrip", async () => {
    const issue: Issue = {
      id: "issue-001", title: "Test", status: "discussing",
      participants: [], taskRefs: [], reportPages: [],
      hasNewInfo: false, comments: [],
      createdAt: now(), updatedAt: now(),
    };
    await writeIssues(TEST_DIR, [issue]);
    const result = await readIssues(TEST_DIR);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("issue-001");
  });

  test("readTasks returns empty array when file missing", async () => {
    const tasks = await readTasks(TEST_DIR);
    expect(tasks).toEqual([]);
  });

  test("writeTasks then readTasks roundtrip", async () => {
    const task: Task = {
      id: "task-001", title: "Test", status: "running",
      issueRefs: [], reportPages: [], subtasks: [],
      hasNewInfo: false,
      createdAt: now(), updatedAt: now(),
    };
    await writeTasks(TEST_DIR, [task]);
    const result = await readTasks(TEST_DIR);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("task-001");
  });

  test("nextId generates sequential IDs", () => {
    expect(nextId("issue", [])).toBe("issue-001");
    expect(nextId("issue", [{ id: "issue-003" }])).toBe("issue-004");
    expect(nextId("task", [{ id: "task-001" }, { id: "task-002" }])).toBe("task-003");
  });
});

describe("kanban methods", () => {
  test("createIssue creates with default status", async () => {
    const issue = await createIssue(TEST_DIR, "Test Issue", "desc", ["alice"]);
    expect(issue.id).toBe("issue-001");
    expect(issue.status).toBe("discussing");
    expect(issue.participants).toEqual(["alice"]);
  });

  test("updateIssueStatus changes status", async () => {
    await createIssue(TEST_DIR, "Test");
    await updateIssueStatus(TEST_DIR, "issue-001", "executing");
    const issues = await readIssues(TEST_DIR);
    expect(issues[0]!.status).toBe("executing");
  });

  test("createTask with issueRefs", async () => {
    const task = await createTask(TEST_DIR, "Impl", "desc", ["issue-001"]);
    expect(task.id).toBe("task-001");
    expect(task.status).toBe("running");
    expect(task.issueRefs).toEqual(["issue-001"]);
  });

  test("createSubTask and updateSubTask", async () => {
    await createTask(TEST_DIR, "Parent");
    const sub = await createSubTask(TEST_DIR, "task-001", "Child", "bob");
    expect(sub.status).toBe("pending");
    expect(sub.assignee).toBe("bob");
    await updateSubTask(TEST_DIR, "task-001", sub.id, { status: "done" });
    const tasks = await readTasks(TEST_DIR);
    expect(tasks[0]!.subtasks[0]!.status).toBe("done");
  });

  test("setIssueNewInfo toggles flag", async () => {
    await createIssue(TEST_DIR, "Test");
    await setIssueNewInfo(TEST_DIR, "issue-001", true);
    let issues = await readIssues(TEST_DIR);
    expect(issues[0]!.hasNewInfo).toBe(true);
    await setIssueNewInfo(TEST_DIR, "issue-001", false);
    issues = await readIssues(TEST_DIR);
    expect(issues[0]!.hasNewInfo).toBe(false);
  });
});

describe("issue discussion", () => {
  test("commentOnIssue adds comment and returns mentionTargets", async () => {
    await createIssue(TEST_DIR, "Test");
    const { comment, mentionTargets } = await commentOnIssue(
      TEST_DIR, "issue-001", "alice", "I think...", ["bob", "alice"],
    );
    expect(comment.author).toBe("alice");
    expect(mentionTargets).toEqual(["bob"]);
    const comments = await listIssueComments(TEST_DIR, "issue-001");
    expect(comments).toHaveLength(1);
  });

  test("commentOnIssue adds author to participants", async () => {
    await createIssue(TEST_DIR, "Test");
    await commentOnIssue(TEST_DIR, "issue-001", "charlie", "Hello");
    const issue = await getIssue(TEST_DIR, "issue-001");
    expect(issue.participants).toContain("charlie");
  });

  test("getIssue throws for missing issue", async () => {
    expect(getIssue(TEST_DIR, "nope")).rejects.toThrow("not found");
  });
});

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import {
  readIssues, writeIssues, readTasks, writeTasks, nextId, now,
} from "../src/kanban/store";
import type { Issue, Task } from "../src/kanban/types";

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
    expect(result[0].id).toBe("issue-001");
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
    expect(result[0].id).toBe("task-001");
  });

  test("nextId generates sequential IDs", () => {
    expect(nextId("issue", [])).toBe("issue-001");
    expect(nextId("issue", [{ id: "issue-003" }])).toBe("issue-004");
    expect(nextId("task", [{ id: "task-001" }, { id: "task-002" }])).toBe("task-003");
  });
});

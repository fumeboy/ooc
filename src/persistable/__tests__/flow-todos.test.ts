import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  todosFile,
  readTodos,
  writeTodos,
  mutateTodos,
  __resetSerialQueueForTests,
  type Todo,
} from "..";
import type { FlowObjectRef } from "..";

let tempRoot: string | undefined;

beforeEach(() => {
  __resetSerialQueueForTests();
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("flow-todos: B 类 todo 塌缩载体（object-scoped）", () => {
  test("todosFile 计算 flows/<sid>/objects/<id>/todos.json", () => {
    const ref: FlowObjectRef = { baseDir: "/abs", sessionId: "s1", objectId: "agent" };
    expect(todosFile(ref)).toBe(join("/abs", "flows", "s1", "objects", "agent", "todos.json"));
  });

  test("readTodos 文件不存在返回空数组 []", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-todos-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    expect(await readTodos(ref)).toEqual([]);
  });

  test("writeTodos / readTodos round trip + 自动 mkdir", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-todos-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    const todos: Todo[] = [
      { id: "t1", content: "补单测", done: false },
      { id: "t2", content: "改 doc", done: true, onCommandPath: ["program.shell"] },
    ];
    await writeTodos(ref, todos);
    expect(await readTodos(ref)).toEqual(todos);
  });

  test("mutateTodos append（read-modify-write）", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-todos-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    await mutateTodos(ref, (ts) => [...ts, { id: "t1", content: "a", done: false }]);
    const after = await mutateTodos(ref, (ts) => [...ts, { id: "t2", content: "b", done: false }]);
    expect(after.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(await readTodos(ref)).toHaveLength(2);
  });

  test("mutateTodos check（set done）", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-todos-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    await writeTodos(ref, [{ id: "t1", content: "a", done: false }]);
    await mutateTodos(ref, (ts) =>
      ts.map((t) => (t.id === "t1" ? { ...t, done: true } : t)),
    );
    expect((await readTodos(ref))[0]?.done).toBe(true);
  });

  test("mutateTodos remove", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-todos-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    await writeTodos(ref, [
      { id: "t1", content: "a", done: false },
      { id: "t2", content: "b", done: false },
    ]);
    await mutateTodos(ref, (ts) => ts.filter((t) => t.id !== "t1"));
    expect((await readTodos(ref)).map((t) => t.id)).toEqual(["t2"]);
  });

  test("readTodos 抛清晰错误于损坏 JSON", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-todos-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    await writeTodos(ref, []);
    await Bun.write(todosFile(ref), "not json [");
    await expect(readTodos(ref)).rejects.toThrow(/解析 flow todos\.json 失败/);
  });

  test("并发 mutateTodos 串行化保证不丢条目", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-todos-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    await Promise.all([
      mutateTodos(ref, (ts) => [...ts, { id: "a", content: "a", done: false }]),
      mutateTodos(ref, (ts) => [...ts, { id: "b", content: "b", done: false }]),
      mutateTodos(ref, (ts) => [...ts, { id: "c", content: "c", done: false }]),
    ]);
    const final = JSON.parse(await readFile(todosFile(ref), "utf8")) as Todo[];
    expect(final.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
  });
});

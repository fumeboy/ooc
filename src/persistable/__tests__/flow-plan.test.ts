import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  planFile,
  readPlan,
  writePlan,
  __resetSerialQueueForTests,
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

describe("flow-plan: B 类 plan 塌缩载体（object-scoped markdown）", () => {
  test("planFile 计算 flows/<sid>/objects/<id>/plan.md", () => {
    const ref: FlowObjectRef = { baseDir: "/abs", sessionId: "s1", objectId: "agent" };
    expect(planFile(ref)).toBe(join("/abs", "flows", "s1", "objects", "agent", "plan.md"));
  });

  test("readPlan 文件不存在返回空字符串 \"\"", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-plan-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    expect(await readPlan(ref)).toBe("");
  });

  test("writePlan / readPlan round trip + 自动 mkdir", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-plan-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    const md = "# 重构 thinkable\n\n- [ ] 拆解 thinkloop\n- [x] 梳理 context\n";
    await writePlan(ref, md);
    expect(await readPlan(ref)).toBe(md);
  });

  test("writePlan 覆盖写（plan_set 全量 / plan_clear 清空语义）", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-plan-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    await writePlan(ref, "old plan");
    await writePlan(ref, "- [ ] new step");
    expect(await readPlan(ref)).toBe("- [ ] new step");
    // plan_clear 等价于写空串
    await writePlan(ref, "");
    expect(await readPlan(ref)).toBe("");
  });

  test("并发 writePlan 串行化（同对象队列；最后入队的胜出，不交叉损坏）", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-flow-plan-"));
    const ref: FlowObjectRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent" };
    await Promise.all([
      writePlan(ref, "a"),
      writePlan(ref, "b"),
      writePlan(ref, "c"),
    ]);
    const final = await readPlan(ref);
    expect(["a", "b", "c"]).toContain(final);
  });
});

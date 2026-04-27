/**
 * Edit Plan 事务 单元测试
 *
 * 覆盖：
 * - 单文件 edit 成功应用
 * - 多文件混合 edit/write 原子成功
 * - 部分失败（匹配不到文本）自动回滚
 * - 写盘过程失败回滚（用只读目录模拟）
 * - 状态机：pending → applied / failed / cancelled
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtemp, rm, readFile, mkdir, writeFile, chmod, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  createEditPlan,
  readEditPlan,
  previewEditPlan,
  applyEditPlan,
  cancelEditPlan,
} from "../src/storable/edit-plans/edit-plans";

let workDir: string;
let flowsRoot: string;
const sessionId = "test-session-1";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "ooc-edit-plans-"));
  flowsRoot = join(workDir, "flows");
  await mkdir(flowsRoot, { recursive: true });
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // 每个测试都从干净目录开始
  await rm(join(workDir, "src"), { recursive: true, force: true });
  await mkdir(join(workDir, "src"), { recursive: true });
});

async function setupFixture() {
  await writeFile(join(workDir, "src", "a.ts"), "export const A = 1;\nexport const B = 2;\n");
  await writeFile(join(workDir, "src", "b.ts"), "export const C = 3;\n");
}

describe("createEditPlan / readEditPlan", () => {
  test("创建 plan 并读回", async () => {
    await setupFixture();
    const plan = await createEditPlan({
      rootDir: workDir,
      sessionId,
      flowsRoot,
      changes: [{ kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 100" }],
    });
    expect(plan.planId).toMatch(/^ep_/);
    expect(plan.status).toBe("pending");
    expect(plan.changes.length).toBe(1);

    const read = await readEditPlan(plan.planId, { sessionId, flowsRoot });
    expect(read).not.toBeNull();
    expect(read!.planId).toBe(plan.planId);
  });

  test("空 changes 抛错", async () => {
    await expect(
      createEditPlan({ rootDir: workDir, sessionId, flowsRoot, changes: [] }),
    ).rejects.toThrow();
  });

  test("未知 kind 抛错", async () => {
    await expect(
      createEditPlan({
        rootDir: workDir,
        sessionId,
        flowsRoot,
        changes: [{ kind: "unknown", path: "x" } as any],
      }),
    ).rejects.toThrow();
  });

  test("edit change 的 oldText 不能为空", async () => {
    await expect(
      createEditPlan({
        rootDir: workDir,
        sessionId,
        flowsRoot,
        changes: [{ kind: "edit", path: "src/a.ts", oldText: "", newText: "x" }],
      }),
    ).rejects.toThrow("oldText 不能为空");
  });
});

describe("previewEditPlan", () => {
  test("生成 unified diff 形态", async () => {
    await setupFixture();
    const plan = await createEditPlan({
      rootDir: workDir,
      sessionId,
      flowsRoot,
      changes: [
        { kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 100" },
        { kind: "write", path: "src/new.ts", newContent: "export const N = 9;\n" },
      ],
    });
    const preview = await previewEditPlan(plan);
    expect(preview).toContain("--- a/src/a.ts");
    expect(preview).toContain("- A = 1");
    expect(preview).toContain("+ A = 100");
    expect(preview).toContain("--- a/src/new.ts");
    expect(preview).toContain("+++ b/src/new.ts");
    expect(preview).toContain("<file did not exist>");
    expect(preview).toContain("+ export const N = 9;");
  });
});

describe("applyEditPlan", () => {
  test("单文件 edit 成功应用", async () => {
    await setupFixture();
    const plan = await createEditPlan({
      rootDir: workDir,
      sessionId,
      flowsRoot,
      changes: [{ kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 100" }],
    });
    const result = await applyEditPlan(plan, { sessionId, flowsRoot });
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    const content = await readFile(join(workDir, "src", "a.ts"), "utf-8");
    expect(content).toContain("A = 100");
    expect(content).toContain("B = 2");
  });

  test("多文件混合 edit+write 原子成功", async () => {
    await setupFixture();
    const plan = await createEditPlan({
      rootDir: workDir,
      sessionId,
      flowsRoot,
      changes: [
        { kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 10" },
        { kind: "edit", path: "src/b.ts", oldText: "C = 3", newText: "C = 30" },
        { kind: "write", path: "src/new.ts", newContent: "export const N = 9;\n" },
      ],
    });
    const result = await applyEditPlan(plan, { sessionId, flowsRoot });
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(3);

    expect(await readFile(join(workDir, "src", "a.ts"), "utf-8")).toContain("A = 10");
    expect(await readFile(join(workDir, "src", "b.ts"), "utf-8")).toContain("C = 30");
    expect(await readFile(join(workDir, "src", "new.ts"), "utf-8")).toContain("N = 9");

    // plan 状态应更新为 applied
    const reread = await readEditPlan(plan.planId, { sessionId, flowsRoot });
    expect(reread!.status).toBe("applied");
  });

  test("部分失败（oldText 匹配不到）：所有文件不动", async () => {
    await setupFixture();
    const plan = await createEditPlan({
      rootDir: workDir,
      sessionId,
      flowsRoot,
      changes: [
        { kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 10" },
        { kind: "edit", path: "src/b.ts", oldText: "NOT_FOUND_XXX", newText: "X = 1" },
      ],
    });
    const result = await applyEditPlan(plan, { sessionId, flowsRoot });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("未找到匹配文本");
    // a.ts 应保持原样（计算阶段失败，未写盘）
    expect(await readFile(join(workDir, "src", "a.ts"), "utf-8")).toContain("A = 1");
    expect(await readFile(join(workDir, "src", "a.ts"), "utf-8")).not.toContain("A = 10");

    const reread = await readEditPlan(plan.planId, { sessionId, flowsRoot });
    expect(reread!.status).toBe("failed");
  });

  test("多处匹配但未 replaceAll：报错不写", async () => {
    await writeFile(join(workDir, "src", "x.ts"), "const X = 1;\nconst Y = X + X;\n");
    const plan = await createEditPlan({
      rootDir: workDir,
      sessionId,
      flowsRoot,
      changes: [{ kind: "edit", path: "src/x.ts", oldText: "X", newText: "Z" }],
    });
    const result = await applyEditPlan(plan, { sessionId, flowsRoot });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("处匹配");
    const orig = await readFile(join(workDir, "src", "x.ts"), "utf-8");
    expect(orig).toContain("X = 1");
  });

  test("replaceAll 成功替换全部", async () => {
    await writeFile(join(workDir, "src", "x.ts"), "const X = 1;\nconst Y = X + X;\n");
    const plan = await createEditPlan({
      rootDir: workDir,
      sessionId,
      flowsRoot,
      changes: [{ kind: "edit", path: "src/x.ts", oldText: "X", newText: "Z", replaceAll: true }],
    });
    const result = await applyEditPlan(plan, { sessionId, flowsRoot });
    expect(result.ok).toBe(true);
    const content = await readFile(join(workDir, "src", "x.ts"), "utf-8");
    expect(content).not.toContain(" X ");
    expect(content).toContain("Z = 1");
    expect(content).toContain("Z + Z");
  });

  test("写盘阶段失败回滚已写文件", async () => {
    await setupFixture();
    // 制造一个目录同名的文件路径让 write 失败
    await mkdir(join(workDir, "src", "blocked"), { recursive: true });
    const plan = await createEditPlan({
      rootDir: workDir,
      sessionId,
      flowsRoot,
      changes: [
        { kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 99" },
        // 目录作为文件写入会失败
        { kind: "write", path: "src/blocked", newContent: "content" },
      ],
    });
    const result = await applyEditPlan(plan, { sessionId, flowsRoot });
    expect(result.ok).toBe(false);
    // a.ts 应被回滚到原内容
    const content = await readFile(join(workDir, "src", "a.ts"), "utf-8");
    expect(content).toContain("A = 1");
    expect(content).not.toContain("A = 99");
  });

  test("二次应用已 applied plan 报错", async () => {
    await setupFixture();
    const plan = await createEditPlan({
      rootDir: workDir,
      sessionId,
      flowsRoot,
      changes: [{ kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 2" }],
    });
    const r1 = await applyEditPlan(plan, { sessionId, flowsRoot });
    expect(r1.ok).toBe(true);
    // 重读 plan（status 已变）
    const reread = await readEditPlan(plan.planId, { sessionId, flowsRoot });
    const r2 = await applyEditPlan(reread!, { sessionId, flowsRoot });
    expect(r2.ok).toBe(false);
  });
});

describe("cancelEditPlan", () => {
  test("取消 pending plan", async () => {
    await setupFixture();
    const plan = await createEditPlan({
      rootDir: workDir,
      sessionId,
      flowsRoot,
      changes: [{ kind: "edit", path: "src/a.ts", oldText: "A", newText: "Z" }],
    });
    const cancelled = await cancelEditPlan(plan, { sessionId, flowsRoot });
    expect(cancelled.status).toBe("cancelled");
    const reread = await readEditPlan(plan.planId, { sessionId, flowsRoot });
    expect(reread!.status).toBe("cancelled");
  });

  test("已 applied plan 取消无效（保持 applied）", async () => {
    await setupFixture();
    const plan = await createEditPlan({
      rootDir: workDir,
      sessionId,
      flowsRoot,
      changes: [{ kind: "edit", path: "src/a.ts", oldText: "A = 1", newText: "A = 2" }],
    });
    await applyEditPlan(plan, { sessionId, flowsRoot });
    const reread = await readEditPlan(plan.planId, { sessionId, flowsRoot });
    const cancelled = await cancelEditPlan(reread!, { sessionId, flowsRoot });
    expect(cancelled.status).toBe("applied");
  });
});

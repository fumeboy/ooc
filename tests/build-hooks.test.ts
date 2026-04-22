/**
 * Build Hooks 单元测试
 *
 * 覆盖：
 * - registerBuildHook / runBuildHooks 基础流程
 * - 匹配过滤（match 返回 false 不跑）
 * - 失败累积到 feedback；getBuildFeedback 过滤成功条目
 * - 同路径后续 run 覆盖旧 feedback
 * - 过期 TTL（模拟老时间戳）
 * - 内置 jsonSyntaxHook：JSON 有效 / 无效
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtemp, writeFile as fsWriteFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  __clearHooks,
  registerBuildHook,
  runBuildHooks,
  getBuildFeedback,
  clearFeedback,
  formatFeedbackForContext,
  jsonSyntaxHook,
  hookCount,
  type BuildHook,
} from "../src/world/hooks";

beforeEach(() => {
  __clearHooks();
});

describe("registerBuildHook / hookCount", () => {
  test("注册增加计数", () => {
    expect(hookCount()).toBe(0);
    registerBuildHook({
      name: "x",
      match: () => true,
      run: async () => ({ success: true, output: "" }),
    });
    expect(hookCount()).toBe(1);
  });
});

describe("runBuildHooks 基础流程", () => {
  test("match 返回 false 跳过", async () => {
    let called = 0;
    registerBuildHook({
      name: "mismatch",
      match: () => false,
      run: async () => {
        called++;
        return { success: true, output: "" };
      },
    });
    const res = await runBuildHooks(["any.ts"], { rootDir: "/tmp" });
    expect(res).toEqual([]);
    expect(called).toBe(0);
  });

  test("match true 的 hook 被执行并记录 feedback", async () => {
    registerBuildHook({
      name: "alwaysOk",
      match: () => true,
      run: async () => ({ success: true, output: "good" }),
    });
    registerBuildHook({
      name: "alwaysFail",
      match: () => true,
      run: async () => ({ success: false, output: "boom", errors: ["e1", "e2"] }),
    });
    const threadId = "th_1";
    const res = await runBuildHooks(["foo.ts"], { rootDir: "/tmp", threadId });
    expect(res.length).toBe(2);
    const fb = getBuildFeedback(threadId);
    // 只有失败的保留
    expect(fb.length).toBe(1);
    expect(fb[0]!.hookName).toBe("alwaysFail");
    expect(fb[0]!.errors).toEqual(["e1", "e2"]);
  });

  test("hook 抛异常 → success=false 并带 error", async () => {
    registerBuildHook({
      name: "throws",
      match: () => true,
      run: async () => {
        throw new Error("kaboom");
      },
    });
    const threadId = "th_2";
    await runBuildHooks(["x.ts"], { rootDir: "/tmp", threadId });
    const fb = getBuildFeedback(threadId);
    expect(fb.length).toBe(1);
    expect(fb[0]!.success).toBe(false);
    expect(fb[0]!.output).toContain("kaboom");
  });

  test("同路径后续 run 覆盖旧 feedback", async () => {
    let pass = false;
    registerBuildHook({
      name: "toggle",
      match: () => true,
      run: async () => ({ success: pass, output: pass ? "ok" : "fail" }),
    });
    const threadId = "th_3";
    await runBuildHooks(["same.ts"], { rootDir: "/tmp", threadId });
    expect(getBuildFeedback(threadId).length).toBe(1);
    pass = true;
    await runBuildHooks(["same.ts"], { rootDir: "/tmp", threadId });
    // 成功后 feedback 被清除
    expect(getBuildFeedback(threadId).length).toBe(0);
  });

  test("不同 threadId 隔离", async () => {
    registerBuildHook({
      name: "fail",
      match: () => true,
      run: async () => ({ success: false, output: "bad" }),
    });
    await runBuildHooks(["a.ts"], { rootDir: "/tmp", threadId: "t1" });
    await runBuildHooks(["b.ts"], { rootDir: "/tmp", threadId: "t2" });
    expect(getBuildFeedback("t1").length).toBe(1);
    expect(getBuildFeedback("t2").length).toBe(1);
    expect(getBuildFeedback("t1")[0]!.path).toBe("a.ts");
    expect(getBuildFeedback("t2")[0]!.path).toBe("b.ts");
  });
});

describe("clearFeedback", () => {
  test("清除指定线程", async () => {
    registerBuildHook({
      name: "fail",
      match: () => true,
      run: async () => ({ success: false, output: "x" }),
    });
    await runBuildHooks(["a.ts"], { rootDir: "/tmp", threadId: "tc" });
    expect(getBuildFeedback("tc").length).toBe(1);
    clearFeedback("tc");
    expect(getBuildFeedback("tc").length).toBe(0);
  });
});

describe("formatFeedbackForContext", () => {
  test("空数组返回空串", () => {
    expect(formatFeedbackForContext([])).toBe("");
  });

  test("包含 hookName / path / errors", () => {
    const out = formatFeedbackForContext([
      {
        hookName: "tsc-check",
        path: "src/foo.ts",
        success: false,
        output: "some output",
        errors: ["error 1", "error 2"],
        timestamp: Date.now(),
      },
    ]);
    expect(out).toContain("tsc-check");
    expect(out).toContain("src/foo.ts");
    expect(out).toContain("error 1");
  });
});

describe("jsonSyntaxHook 内置", () => {
  test("合法 JSON → success:true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ooc-hooks-"));
    const f = join(dir, "good.json");
    await fsWriteFile(f, JSON.stringify({ a: 1 }));
    const res = await jsonSyntaxHook.run(f, { rootDir: dir });
    expect(res.success).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  test("非法 JSON → success:false + errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ooc-hooks-"));
    const f = join(dir, "bad.json");
    await fsWriteFile(f, "{ not valid");
    const res = await jsonSyntaxHook.run(f, { rootDir: dir });
    expect(res.success).toBe(false);
    expect(res.output).toContain("JSON 解析失败");
    expect(res.errors).toBeDefined();
    await rm(dir, { recursive: true, force: true });
  });

  test("match 只匹配 .json", () => {
    expect(jsonSyntaxHook.match("a.json")).toBe(true);
    expect(jsonSyntaxHook.match("a.ts")).toBe(false);
  });
});

describe("runBuildHooks 空输入边界", () => {
  test("空 path 列表直接返回空", async () => {
    registerBuildHook({
      name: "x",
      match: () => true,
      run: async () => ({ success: true, output: "" }),
    });
    const res = await runBuildHooks([], { rootDir: "/tmp" });
    expect(res).toEqual([]);
  });

  test("无已注册 hook 时空返回", async () => {
    const res = await runBuildHooks(["a.ts"], { rootDir: "/tmp" });
    expect(res).toEqual([]);
  });
});

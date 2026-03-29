/**
 * shell_exec trait 单元测试
 *
 * 测试 exec 方法的基本功能：简单命令、自定义工作目录、
 * 非零退出码、超时处理。
 */

import { describe, test, expect } from "bun:test";
import { exec } from "../traits/shell_exec/index";

/** 模拟上下文，rootDir 指向 /tmp */
const mockCtx = { rootDir: "/tmp" } as any;

describe("shell_exec: exec", () => {
  test("执行简单命令", async () => {
    const result = await exec(mockCtx, "echo hello");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.stdout.trim()).toBe("hello");
      expect(result.data.exitCode).toBe(0);
      expect(result.data.timedOut).toBe(false);
    }
  });

  test("自定义工作目录", async () => {
    const result = await exec(mockCtx, "pwd", { cwd: "/tmp" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // /tmp 在 macOS 上可能解析为 /private/tmp
      expect(result.data.stdout.trim()).toMatch(/\/tmp$/);
    }
  });

  test("命令失败返回非零 exitCode", async () => {
    const result = await exec(mockCtx, "exit 42");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.exitCode).toBe(42);
    }
  });

  test("命令超时", async () => {
    const result = await exec(mockCtx, "sleep 10", { timeout: 500 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.timedOut).toBe(true);
    }
  });
});

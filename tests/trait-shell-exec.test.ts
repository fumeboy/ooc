/**
 * shell_exec trait 单元测试
 *
 * 测试 exec 方法的基本功能：简单命令、自定义工作目录、
 * 非零退出码、超时处理。
 */

import { describe, test, expect } from "bun:test";
import { exec, ExecError } from "../traits/shell_exec/index";

/** 模拟上下文，rootDir 指向 /tmp */
const mockCtx = { rootDir: "/tmp" } as any;

describe("shell_exec: exec", () => {
  test("执行简单命令返回 stdout 字符串", async () => {
    const result = await exec(mockCtx, "echo hello");
    expect(typeof result).toBe("string");
    expect(result.trim()).toBe("hello");
  });

  test("自定义工作目录", async () => {
    const result = await exec(mockCtx, "pwd", { cwd: "/tmp" });
    // /tmp 在 macOS 上可能解析为 /private/tmp
    expect(result.trim()).toMatch(/\/tmp$/);
  });

  test("命令失败抛出 ExecError", async () => {
    let caughtError: ExecError | null = null;
    try {
      await exec(mockCtx, "exit 42");
    } catch (e) {
      caughtError = e as ExecError;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError).toBeInstanceOf(ExecError);
    expect(caughtError!.exitCode).toBe(42);
    expect(caughtError!.message).toContain("exit code");
  });

  test("ExecError 包含 stdout 和 stderr", async () => {
    let caughtError: ExecError | null = null;
    try {
      // 向 stderr 输出
      await exec(mockCtx, "echo 'error msg' >&2 && exit 1");
    } catch (e) {
      caughtError = e as ExecError;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.stderr).toContain("error msg");
  });

  test("命令超时", async () => {
    let caughtError: ExecError | null = null;
    try {
      await exec(mockCtx, "sleep 10", { timeout: 500 });
    } catch (e) {
      caughtError = e as ExecError;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError).toBeInstanceOf(ExecError);
    expect(caughtError!.timedOut).toBe(true);
  });
});

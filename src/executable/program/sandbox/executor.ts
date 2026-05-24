import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCapturingConsole } from "./console";
import { wrapUserCode } from "./wrap";
import type { ProgramExecutionResult } from "../types";

let counter = 0;

/**
 * 执行一段 ts/js 用户代码（in-process 动态 import）。
 * - self 注入到包装函数的第二个入参；为 null 时用户代码访问 self.* 会抛 NPE
 * - console.log/warn/error 进 stdout
 * - _result_ 进 returnValue
 * - 异常进 error，附带原始堆栈中能解析到的行号
 */
export async function executeUserCode(
  code: string,
  self: unknown
): Promise<ProgramExecutionResult> {
  const dir = join(tmpdir(), "ooc", "exec");
  await mkdir(dir, { recursive: true });
  counter += 1;
  const id = `${Date.now()}_${counter}`;
  const file = join(dir, `exec_${id}.mjs`);

  const moduleSource = wrapUserCode(code);
  const cap = createCapturingConsole();

  try {
    await writeFile(file, moduleSource, "utf8");
    const mod = await import(`${file}?t=${id}`);
    const fn = mod.default as (console: unknown, self: unknown) => Promise<unknown>;
    const returnValue = await fn(cap.console, self);
    return {
      success: true,
      returnValue: returnValue ?? undefined,
      stdout: cap.drain()
    };
  } catch (error) {
    const err = error as Error;
    let detail = err.message ?? String(err);
    const stackMatch = err.stack?.match(/exec_\d+_\d+\.mjs:(\d+):(\d+)/);
    if (stackMatch) {
      detail = `${detail}\n[at module line ${stackMatch[1]}:${stackMatch[2]}]`;
    }
    return {
      success: false,
      returnValue: undefined,
      stdout: cap.drain(),
      error: detail
    };
  } finally {
    try {
      await unlink(file);
    } catch {
      // intentional: sandbox tmp cleanup 失败不应破坏主流程——已经在 finally 里，
      // exec 结果对 caller 仍然有效；tmp 文件由 OS 周期清理。
      // 属 meta/observable.silent_swallow_ban 的 sandbox 例外白名单（tmp cleanup）。
    }
  }
}

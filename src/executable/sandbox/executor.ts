import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCapturingConsole } from "./console";
import { wrapUserCode } from "./wrap";

/** 用户代码执行结果。 */
export interface ProgramExecutionResult {
  /** 是否成功完成（无异常）。 */
  success: boolean;
  /** 用户代码 _result_ 的值；undefined 时表示用户没显式赋值。 */
  returnValue: unknown;
  /** 累积的 console 输出。 */
  stdout: string;
  /** 失败时的错误描述（含粗略行号定位）。 */
  error?: string;
}

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
      // 忽略清理失败
    }
  }
}

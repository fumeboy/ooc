import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCapturingConsole } from "./console";
import { wrapUserCode } from "./wrap";
import type { InterpreterExecutionResult } from "../exec-record.js";

let counter = 0;

/**
 * 执行一段 ts/js 用户代码（in-process 动态 import）。
 *
 * 注入与标准 object method 同构的 `(ctx, self)`——用户脚本即一段即席 object method body：
 * - self：object method 的 self-proxy（`self.data` 读写本对象业务数据、`self.methods.x()` 自调）
 * - ctx：object method 的 ExecutableContext（`ctx.runtime.callMethod(id, method, args)` 跨窗调别的对象）
 * - console.log/warn/error 进 stdout；`_result_` 进 returnValue
 * - 异常进 error，附带原始堆栈中能解析到的行号
 */
export async function executeUserCode(
  code: string,
  self: unknown,
  ctx: unknown
): Promise<InterpreterExecutionResult> {
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
    const fn = mod.default as (console: unknown, self: unknown, ctx: unknown) => Promise<unknown>;
    const returnValue = await fn(cap.console, self, ctx);
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
      // intentional: sandbox tmp cleanup 失败不应破坏主流程——exec 结果对 caller 仍然有效；
      // tmp 文件由 OS 周期清理。属 sandbox 例外白名单（tmp cleanup）。
    }
  }
}

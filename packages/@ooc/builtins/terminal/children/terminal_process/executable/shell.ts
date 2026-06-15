import { resolveStoneIdentityDir } from "@ooc/core/persistable/index.js";
import type { FlowObjectRef } from "@ooc/core/persistable/index.js";
import { formatShellResult } from "@ooc/builtins/_shared/executable/process-record.js";

/**
 * 跑一段 bash 脚本（独立子进程）。
 *
 * 历史：原 program 包的 shell 路径，拆到 terminal_process 后归此。
 */
export async function runBashScript(code: string, env: Record<string, string>): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["bash", "-c", code], {
      cwd: process.cwd(),
      env: { ...process.env, ...env } as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    });
  } catch (error) {
    return `[terminal_process] 启动失败: ${(error as Error).message}`;
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
  ]);
  const exitCode = await proc.exited;
  return formatShellResult(code, stdout, stderr, exitCode);
}

/**
 * 派生额外环境变量。当前只透出 `OOC_SELF_DIR`，让命令可稳定定位 stone 目录。
 *
 * 依赖边界：只需要 session 工作区引用（FlowObjectRef = baseDir/sessionId/objectId），
 * 不依赖调用现场 thread——object method 的执行环境是 session（object 的工作区）。
 *
 * 路径经 `resolveStoneIdentityDir(ref, "write")` 解析（worktree 统一模型）：
 * - business session → 该 session 的 worktree object 目录（方案 A：`flows/<sid>/objects/<id>/`）。
 * - super / 控制面 → main canonical（`stones/main/objects/<id>/`）。
 */
export async function buildBashEnv(
  session: FlowObjectRef | undefined,
): Promise<Record<string, string>> {
  if (!session) {
    return {};
  }
  const selfDir = await resolveStoneIdentityDir(
    { baseDir: session.baseDir, sessionId: session.sessionId, objectId: session.objectId },
    "write",
  );
  return {
    OOC_SELF_DIR: selfDir,
  };
}

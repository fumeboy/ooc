import { formatShellResult } from "./exec-record.js";

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

export async function buildBashEnv(
  selfDir: string,
): Promise<Record<string, string>> {
  return {
    OOC_SELF_DIR: selfDir,
  };
}

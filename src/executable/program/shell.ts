import { formatShellResult } from "./format.js";

export async function runShellProgram(code: string, env: Record<string, string>): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["sh", "-c", code], {
      cwd: process.cwd(),
      env: { ...process.env, ...env } as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    });
  } catch (error) {
    return `[program.shell] 启动失败: ${(error as Error).message}`;
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
  ]);
  const exitCode = await proc.exited;
  return formatShellResult(code, stdout, stderr, exitCode);
}

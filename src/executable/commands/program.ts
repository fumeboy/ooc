import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

/** program command 暴露给 LLM 的知识说明。 */
export const KNOWLEDGE = `
program 用于执行一段代码，或调用对象 server 暴露的方法。

参数说明：
- code: 模式 A，待执行的代码字符串
- language: 可选，ts / js / shell
- function: 模式 B，目标函数名
- args: 模式 B，函数调用参数对象

调用示例：
open(type="command", command="program", description="读取文件")
refine(form_id, { language: "ts", code: "const data = await readFile('foo.txt'); print(data);" })
submit(form_id)
`;

/** program command 的可匹配路径集合。 */
export enum ProgramCommandPath {
  /** 基础 program 指令：执行代码或调用 server 导出函数。 */
  Program = "program",
  /** shell 程序路径：以 shell 方式执行代码。 */
  Shell = "program.shell",
  /** TypeScript 程序路径：以内置执行器运行代码。 */
  TypeScript = "program.typescript",
  /** JavaScript 程序路径：以内置执行器运行代码。 */
  JavaScript = "program.javascript",
  /** 对象函数调用路径：调用 server 模块暴露的方法。 */
  Function = "program.function",
}

/** program command 表项：根据 language/function 参数派生路径。 */
export const programCommand: CommandTableEntry = {
  paths: [
    ProgramCommandPath.Program,
    ProgramCommandPath.Shell,
    ProgramCommandPath.TypeScript,
    ProgramCommandPath.JavaScript,
    ProgramCommandPath.Function,
  ],
  match: (args) => {
    const hit: string[] = [ProgramCommandPath.Program];
    const lang = (args.language ?? args.lang) as string | undefined;
    if (lang === "shell") hit.push(ProgramCommandPath.Shell);
    if (lang === "ts" || lang === "typescript") hit.push(ProgramCommandPath.TypeScript);
    if (lang === "js" || lang === "javascript") hit.push(ProgramCommandPath.JavaScript);
    if (typeof args.function === "string") hit.push(ProgramCommandPath.Function);
    return hit;
  },
  // 暂不实现具体执行逻辑
};

const MAX_OUTPUT_BYTES = 4096;

function truncate(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= MAX_OUTPUT_BYTES) return text;
  const head = new TextDecoder().decode(bytes.slice(0, MAX_OUTPUT_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

function formatShellResult(code: string, stdout: string, stderr: string, exitCode: number): string {
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  const lines = [`$ ${firstLine}`];
  if (stdout) lines.push("[stdout]", truncate(stdout));
  if (stderr) lines.push("[stderr]", truncate(stderr));
  // exit 124 是 GNU coreutils timeout 的约定退出码
  lines.push(exitCode === 124 ? "[timeout 30s]" : `[exit ${exitCode}]`);
  return lines.join("\n");
}

async function runShell(code: string): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["sh", "-c", code], {
      cwd: process.cwd(),
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

/** 执行 program command；当前阶段仅支持 language="shell"。 */
export async function executeProgramCommand(ctx: CommandExecutionContext): Promise<string | undefined> {
  const language = (ctx.args.language ?? ctx.args.lang) as string | undefined;
  const code = ctx.args.code as string | undefined;

  if (language !== "shell") {
    return `[program] 本阶段仅支持 language="shell"，收到 language="${language ?? "<undefined>"}"`;
  }
  if (typeof code !== "string" || code.trim() === "") {
    return `[program.shell] 缺少 code 参数`;
  }

  return runShell(code);
}

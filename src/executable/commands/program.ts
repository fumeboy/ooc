import type { CommandExecutionContext, CommandTableEntry } from "./types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { deriveStoneFromThread } from "../../persistable/index.js";
import { executeUserCode } from "../sandbox/executor.js";
import { createProgramSelf } from "../server/self.js";

/** program command 暴露给 LLM 的知识说明。 */
export const KNOWLEDGE = `
program 用于执行一段代码，或调用对象 server 暴露的方法。

参数说明：
- code: 模式 A，待执行的代码字符串
- language: 可选，ts / js / shell
- function: 模式 B，目标函数名
- args: 模式 B，函数调用参数对象

shell 环境变量：
- shell 命令的 cwd 是 OOC 进程的工作目录（一般是 OOC 项目根），不是你自己的 stone 目录。
- 想读写自己的 stone 目录（self.dir），请用 env $OOC_SELF_DIR：
  例如 \`cat > "$OOC_SELF_DIR/server/index.ts" <<EOF ... EOF\`。
- ts/js 中可用 self.dir / self.callMethod / self.getData / self.setData。

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

async function runShell(code: string, env: Record<string, string>): Promise<string> {
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

/** 把 ts/js executor 的结果与 function path 的返回值统一格式化为单一字符串。 */
function formatProgramResult(
  header: string,
  stdout: string,
  returnValue: unknown,
  error?: string,
): string {
  const lines = [header];
  if (stdout) lines.push("[stdout]", truncate(stdout));
  if (returnValue !== undefined) {
    const text = typeof returnValue === "string" ? returnValue : JSON.stringify(returnValue, null, 2);
    lines.push("[returnValue]", truncate(text));
  }
  if (error) {
    lines.push("[error]", truncate(error), "[exit 1]");
  } else {
    lines.push("[exit 0]");
  }
  return lines.join("\n");
}

async function runUserCode(thread: ThreadContext, code: string): Promise<string> {
  const persistence = thread.persistence;
  const self = persistence ? createProgramSelf(deriveStoneFromThread(persistence), thread) : null;
  const exec = await executeUserCode(code, self);
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  return formatProgramResult(`# ts/js: ${firstLine}`, exec.stdout, exec.returnValue, exec.error);
}

async function runFunction(
  thread: ThreadContext,
  fn: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!thread.persistence) {
    return `[program.function] 当前线程无 persistence ref，无法调用 server 方法`;
  }
  const stoneRef = deriveStoneFromThread(thread.persistence);
  try {
    const self = createProgramSelf(stoneRef, thread);
    const returnValue = await self.callMethod(fn, args);
    return formatProgramResult(`# function: ${fn}`, "", returnValue);
  } catch (error) {
    return formatProgramResult(`# function: ${fn}`, "", undefined, (error as Error).message);
  }
}

/** 缺少 program 执行参数时，给 LLM 一个明确可操作的 refine 提示。 */
function missingProgramArgsMessage(): string {
  return [
    "[program] program form 参数不完整：缺少 language/code，或缺少 function/args。",
    "请先用 refine(args={ language: \"shell\", code: \"...\" })，",
    "或 refine(args={ function: \"name\", args: {...} })，再 submit(form_id)。"
  ].join("");
}

/** 执行 program command；按 args 路由到 function / shell / ts/js。 */
export async function executeProgramCommand(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;

  // function 模式优先
  const fn = ctx.args.function as string | undefined;
  if (typeof fn === "string" && fn.length > 0) {
    return runFunction(thread, fn, (ctx.args.args as Record<string, unknown>) ?? {});
  }

  const language = (ctx.args.language ?? ctx.args.lang) as string | undefined;
  const code = ctx.args.code as string | undefined;

  if (language === "shell") {
    if (typeof code !== "string" || code.trim() === "") {
      return `[program.shell] 缺少 code 参数`;
    }
    // 把 self.dir 注入为 OOC_SELF_DIR env var，让 shell 命令可以稳定定位 stone 目录，
    // 例如：cat > "$OOC_SELF_DIR/server/index.ts" <<EOF ... EOF
    const env: Record<string, string> = {};
    if (thread.persistence) {
      const stoneRef = deriveStoneFromThread(thread.persistence);
      env.OOC_SELF_DIR = `${stoneRef.baseDir}/stones/${stoneRef.objectId}`;
    }
    return runShell(code, env);
  }

  if (language === "ts" || language === "typescript" || language === "js" || language === "javascript") {
    if (typeof code !== "string" || code.trim() === "") {
      return `[program.${language}] 缺少 code 参数`;
    }
    return runUserCode(thread, code);
  }

  if (typeof code !== "string" && typeof fn !== "string") {
    return missingProgramArgsMessage();
  }

  return `[program] 未知 language="${language ?? "<undefined>"}"，支持 shell / ts / js / function`;
}

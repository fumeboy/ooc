import type { CommandExecutionContext, CommandTableEntry } from "./types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { createProgramSelf } from "../server/self.js";
import { executeUserCode } from "../program/sandbox/executor.js";
import { runFunctionProgram } from "../program/function.js";
import { formatProgramResult } from "../program/format.js";
import { buildProgramShellEnv } from "../program/self-env.js";
import { runShellProgram } from "../program/shell.js";

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

async function runUserCode(thread: ThreadContext, code: string): Promise<string> {
  const persistence = thread.persistence;
  const self = persistence ? createProgramSelf(persistence, thread) : null;
  const exec = await executeUserCode(code, self);
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  return formatProgramResult(`# ts/js: ${firstLine}`, exec.stdout, exec.returnValue, exec.error);
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
    return runFunctionProgram(thread, fn, (ctx.args.args as Record<string, unknown>) ?? {});
  }

  const language = (ctx.args.language ?? ctx.args.lang) as string | undefined;
  const code = ctx.args.code as string | undefined;

  if (language === "shell") {
    if (typeof code !== "string" || code.trim() === "") {
      return `[program.shell] 缺少 code 参数`;
    }
    return runShellProgram(code, buildProgramShellEnv(thread));
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

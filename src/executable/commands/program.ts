import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

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

/** 执行 program 命令（占位实现，暂未实现具体逻辑） */
export async function executeProgramCommand(_ctx: CommandExecutionContext): Promise<void> {
  // 暂未实现具体逻辑
}

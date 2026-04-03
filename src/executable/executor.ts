/**
 * CodeExecutor —— 代码执行引擎
 *
 * 将 JavaScript 代码写入临时文件，通过 dynamic import() 加载执行。
 * 支持注入 self 和 world 等上下文变量。
 * 捕获返回值、console.log 输出和异常。
 * 执行完毕后自动删除临时文件。
 *
 * @ref docs/哲学文档/gene.md#G4 — implements — 程序沙箱执行（临时文件 + dynamic import + 结果捕获）
 */

import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { consola } from "consola";

/** 代码执行结果 */
export interface ExecutionResult {
  success: boolean;
  returnValue: unknown;
  stdout: string;
  error: string | null;
  errorType: string | null;
  /** 是否为解析阶段的 SyntaxError（整块未执行） */
  isSyntaxError: boolean;
  /** 运行时错误发生的行号（相对于用户代码，非包装后的模块），null 表示未知 */
  errorLine: number | null;
}

/** 全局递增计数器，确保每次执行的文件名唯一 */
let _execCounter = 0;

export class CodeExecutor {
  /** 临时文件目录 */
  private _tmpDir: string;

  constructor() {
    this._tmpDir = join(tmpdir(), "ooc", "exec");
    mkdirSync(this._tmpDir, { recursive: true });
  }

  /**
   * 执行 JavaScript 代码
   *
   * 将用户代码包装为一个 async 函数并导出，
   * 通过 dynamic import() 加载后调用，传入 context 变量。
   */
  async execute(
    code: string,
    context?: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    // 清理 LLM 可能回显的输出格式标记（截断式：分隔符后的一切内容全部丢弃）
    const cleanCode = code
      .replace(/\n?---\s*执行结果\s*---[\s\S]*$/m, "")
      .replace(/\n?>>>\s*output:[\s\S]*$/m, "")
      .replace(/\n?\[output\][\s\S]*$/m, "")
      .trim();

    const logs: string[] = [];
    const id = ++_execCounter;
    const fileName = `exec_${id}_${Date.now()}.mjs`;
    const filePath = join(this._tmpDir, fileName);

    // 构建 context 参数名列表和值
    const paramNames = Object.keys(context ?? {});
    const paramValues = paramNames.map(
      (k) => (context as Record<string, unknown>)[k],
    );

    // 构建自定义 console（捕获输出）
    const customConsole = {
      log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      warn: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      error: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    };

    // JS 保留字集合 — 不能作为函数参数名
    const RESERVED = new Set([
      "break", "case", "catch", "continue", "debugger", "default", "delete",
      "do", "else", "finally", "for", "function", "if", "in", "instanceof",
      "new", "return", "switch", "this", "throw", "try", "typeof", "var",
      "void", "while", "with", "class", "const", "enum", "export", "extends",
      "import", "super", "implements", "interface", "let", "package", "private",
      "protected", "public", "static", "yield", "await",
    ]);
    const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

    // 检查是否有保留字或非法标识符作为 context key
    const invalidKeys = paramNames.filter((n) => RESERVED.has(n) || !IDENTIFIER_RE.test(n));
    if (invalidKeys.length > 0) {
      consola.warn(`[CodeExecutor] context 包含无法作为函数参数的 key: ${invalidKeys.join(", ")}，将跳过这些 key 的直接注入`);
    }

    // 过滤掉保留字/非法标识符（无法作为函数参数名）
    const safeNames: string[] = [];
    const safeValues: unknown[] = [];
    for (let i = 0; i < paramNames.length; i++) {
      if (!RESERVED.has(paramNames[i]!) && IDENTIFIER_RE.test(paramNames[i]!)) {
        safeNames.push(paramNames[i]!);
        safeValues.push(paramValues[i]);
      }
    }

    // 提取 import 语句（必须在模块顶层，不能在函数内部）
    const importLines: string[] = [];
    const nonImportLines: string[] = [];
    for (const line of cleanCode.split("\n")) {
      // 匹配 import 语句：
      // - import { x } from "module"
      // - import x from "module"
      // - import "module"
      // - const { x } = await import("module")
      if (line.match(/^\s*import\s+/) || line.match(/await\s+import\s*\(/)) {
        importLines.push(line);
      } else {
        nonImportLines.push(line);
      }
    }

    // 生成临时模块：
    // - import 语句在模块顶层
    // - 其他代码在 async 函数内部
    const paramList = ["console", ...safeNames].join(", ");
    const moduleCode = [
      ...importLines,
      `export default async function(${paramList}) {`,
      `  let _result_;`,
      nonImportLines.join("\n"),
      `  return _result_;`,
      `}`,
    ].join("\n");

    try {
      writeFileSync(filePath, moduleCode, "utf-8");

      // dynamic import 加载并执行
      const mod = await import(`${filePath}?t=${id}`);
      const fn = mod.default as Function;
      const returnValue = await fn(customConsole, ...safeValues);

      // flush 异步操作（如 setCode 的 import）
      const self = context?.self as any;
      if (self?.flushPendingOps) {
        await self.flushPendingOps();
      }

      return {
        success: true,
        returnValue: returnValue ?? null,
        stdout: logs.join("\n"),
        error: null,
        errorType: null,
        isSyntaxError: false,
        errorLine: null,
      };
    } catch (e) {
      const err = e as Error;

      // 判断是否为解析阶段 SyntaxError（整块未执行）
      // Bun 的 BuildError 发生在 import() 解析阶段，属于 SyntaxError
      // Bun 1.x 也可能抛出 AggregateError（包含多个 BuildMessage）
      const isSyntaxError =
        err.constructor.name === "SyntaxError" ||
        err.constructor.name === "AggregateError" ||
        ("logs" in err && Array.isArray((err as any).logs));

      // 提取错误信息
      let errorDetail = err.message;
      if ("logs" in err && Array.isArray((err as any).logs)) {
        const buildLogs = (err as any).logs
          .map((log: any) => log?.message ?? String(log))
          .filter(Boolean);
        if (buildLogs.length > 0) {
          errorDetail = buildLogs.join("\n");
        }
      } else if ("errors" in err && Array.isArray((err as any).errors)) {
        const aggErrors = (err as any).errors
          .map((e: any) => e?.message ?? String(e))
          .filter(Boolean);
        if (aggErrors.length > 0) {
          errorDetail = aggErrors.join("\n");
        }
      }

      // 提取运行时错误行号（从 stack trace 中解析）
      // 模块包装头占 2 行（export default async function(...) { + let _result_;）
      // 用户代码从第 3 行开始，所以 userLine = stackLine - 2
      let errorLine: number | null = null;
      if (!isSyntaxError && err.stack) {
        const match = err.stack.match(/:(\d+):\d+\)?/);
        if (match) {
          const stackLine = parseInt(match[1]!, 10);
          const userLine = stackLine - 2;
          if (userLine > 0) errorLine = userLine;
        }
      }

      return {
        success: false,
        returnValue: null,
        stdout: logs.join("\n"),
        error: errorDetail,
        errorType: err.constructor.name,
        isSyntaxError,
        errorLine,
      };
    } finally {
      // 清理临时文件
      try {
        unlinkSync(filePath);
      } catch {
        // 忽略删除失败
      }
    }
  }
}

/**
 * 执行 Shell 脚本
 *
 * 通过 sh -c 执行，捕获 stdout/stderr。
 * 默认 timeout 30 秒，cwd 限制在指定目录。
 */
export async function executeShell(
  code: string,
  cwd: string,
  timeout: number = 30000,
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const proc = spawn("sh", ["-c", code], {
      cwd,
      timeout,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (exitCode) => {
      resolve({
        success: exitCode === 0,
        returnValue: exitCode,
        stdout: stdout.trim(),
        error: exitCode !== 0 ? stderr.trim() || `exit code ${exitCode}` : null,
        errorType: exitCode !== 0 ? "ShellError" : null,
        isSyntaxError: false,
        errorLine: null,
      });
    });

    proc.on("error", (err: Error) => {
      resolve({
        success: false,
        returnValue: null,
        stdout: "",
        error: err.message,
        errorType: "SpawnError",
        isSyntaxError: false,
        errorLine: null,
      });
    });
  });
}

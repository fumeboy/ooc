import { consola } from "consola";
import { executeShell } from "../executor.js";
import type { MethodContext } from "../../extendable/trait/registry.js";
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const programCommand: CommandTableEntry = {
  paths: ["program", "program.shell", "program.ts"],
  match: (args) => {
    const hit: string[] = ["program"];
    const lang = (args.language ?? args.lang) as string | undefined;
    if (lang === "shell") hit.push("program.shell");
    if (lang === "ts") hit.push("program.ts");
    return hit;
  },
  openable: true,
};

export async function executeProgramCommand(ctx: CommandExecutionContext): Promise<void> {
  const args = ctx.args;
  const form = ctx.form;
  if (form.trait || args.trait || form.method || args.method) {
    const trait = form.trait ?? (args.trait as string | undefined);
    const method = form.method ?? (args.method as string | undefined);
    const { context: execCtx } = ctx.buildExecContext(ctx.threadId);
    const rawArgs = args.args;
    const executed = await ctx.executeProgramTraitMethod({
      methodRegistry: ctx.methodRegistry,
      trait,
      method,
      args: rawArgs,
      execCtx: execCtx as unknown as MethodContext,
    });
    const td = ctx.tree.readThreadData(ctx.threadId);
    if (td) {
      td.actions.push({
        type: "program",
        content: `${trait ?? "(missing trait)"}.${method ?? "(missing method)"}`,
        success: executed.success,
        result: `>>> ${trait ?? "(missing trait)"}.${method ?? "(missing method)"} 结果:\n${executed.resultText}`,
        timestamp: Date.now(),
      });
      ctx.tree.writeThreadData(ctx.threadId, td);
    }
    if (executed.success) {
      const hookInject = await ctx.triggerBuildHooksAfterCall({
        trait,
        methodName: method,
        args: rawArgs,
        rootDir: ctx.rootDir,
        threadId: ctx.threadId,
      });
      if (hookInject) {
        const td2 = ctx.tree.readThreadData(ctx.threadId);
        if (td2) {
          td2.actions.push({ type: "inject", content: hookInject, timestamp: Date.now() });
          ctx.tree.writeThreadData(ctx.threadId, td2);
        }
      }
    }
    consola.info(`[Engine] program trait/method ${executed.success ? "成功" : "失败"}: ${trait}.${method}`);
    return;
  }

  if (!args.code) return;
  const { context: execCtx, getOutputs, getWrittenPaths } = ctx.buildExecContext(ctx.threadId);
  const lang = (args.lang as string) ?? "javascript";
  const execResult = lang === "shell"
    ? await executeShell(args.code as string, ctx.rootDir)
    : await ctx.executor.execute(args.code as string, execCtx);
  const allOutputs = [...getOutputs()];
  if (execResult.stdout) allOutputs.push(execResult.stdout);
  if (execResult.returnValue != null) {
    allOutputs.push(typeof execResult.returnValue === "string"
      ? execResult.returnValue
      : JSON.stringify(execResult.returnValue, null, 2));
  }
  const outputText = allOutputs.join("\n").trim();
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (td) {
    td.actions.push({
      type: "program",
      content: args.code as string,
      success: execResult.success,
      result: execResult.success
        ? (outputText ? `>>> output:\n${outputText}` : ">>> output: (无输出)")
        : `>>> error: ${execResult.error}`,
      timestamp: Date.now(),
    });
    ctx.tree.writeThreadData(ctx.threadId, td);
  }

  if (execResult.success) {
    const paths = getWrittenPaths();
    if (paths.length > 0) {
      consola.info(`[build_hooks] program 结束，扫描写入路径 count=${paths.length} paths=${paths.join(",")}`);
      try {
        const feedback = await ctx.runBuildHooks(paths, { rootDir: ctx.rootDir, threadId: ctx.threadId });
        const failing = feedback.filter((f) => !f.success);
        if (failing.length > 0) {
          const lines = [`[build_hooks] ${failing.length} 个检查未通过（下一轮 Context 的 <knowledge name="build_feedback"> 会展开）:`];
          for (const f of failing) {
            lines.push(`- [${f.hookName}] ${f.path}: ${(f.errors?.[0] ?? f.output).slice(0, 200)}`);
          }
          const td2 = ctx.tree.readThreadData(ctx.threadId);
          if (td2) {
            td2.actions.push({ type: "inject", content: lines.join("\n"), timestamp: Date.now() });
            ctx.tree.writeThreadData(ctx.threadId, td2);
          }
        }
      } catch (e) {
        consola.warn(`[build_hooks] 执行异常: ${(e as Error).message}`);
      }
    }
  }
  consola.info(`[Engine] program ${execResult.success ? "成功" : "失败"}`);
}

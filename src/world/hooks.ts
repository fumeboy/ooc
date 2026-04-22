/**
 * Build Hooks —— 写文件后自动跑检查（tsc / lint / format / install）
 *
 * 设计：
 * - BuildHook = { name, match(path), run(path, ctx) }
 * - 注册一组默认 hook（TS check / Prettier / ESLint），world 启动时注入
 * - 当 file_ops 类 action 完成后，engine 调用 runBuildHooks(paths, ctx)
 * - runBuildHooks 执行匹配的 hook，把失败结果追加到 per-thread feedback window
 * - context-builder 下一轮构建时从 getBuildFeedback(threadId) 读出来注入 knowledge
 *
 * 防循环：
 * - hook 内部不得调 writeFile 造成递归；若确有需要（如 prettier autofix），
 *   hook.run 返回 { success: true } 但在 feedback 中标记 "auto-formatted"。
 * - feedback 按 threadId 维度聚合；过期策略：超过 5 分钟或同路径下一次写时清除。
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_build_feedback_loop.md
 */

/** 单个 hook 返回 */
export interface HookResult {
  success: boolean;
  /** 人读的文本输出（给 LLM 看） */
  output: string;
  /** 失败时的结构化 errors（每条一行文本即可） */
  errors?: string[];
  /** 执行耗时 ms */
  durationMs?: number;
}

/** Hook 定义 */
export interface BuildHook {
  /** 名称（展示用） */
  name: string;
  /** 是否对该路径应用 */
  match: (path: string) => boolean;
  /** 实际执行；返回 HookResult */
  run: (path: string, ctx: HookCtx) => Promise<HookResult>;
}

/** Hook 执行上下文 */
export interface HookCtx {
  /** 项目根目录 */
  rootDir: string;
  /** 发起写入的线程 id（用于 feedback 隔离） */
  threadId?: string;
}

/** 一次 hook 执行的记录 */
export interface HookFeedback {
  hookName: string;
  path: string;
  success: boolean;
  output: string;
  errors?: string[];
  timestamp: number;
  durationMs?: number;
}

/** feedback 过期时间：5 分钟 */
const FEEDBACK_TTL_MS = 5 * 60 * 1000;

/** 全局 hook 注册表 */
const hooks: BuildHook[] = [];
/** 每线程 feedback（threadId → 时间序 HookFeedback 列表） */
const feedbackByThread = new Map<string, HookFeedback[]>();
/** 全局 feedback（当 threadId 缺失时） */
const globalFeedback: HookFeedback[] = [];

/** 注册 hook */
export function registerBuildHook(hook: BuildHook): void {
  hooks.push(hook);
}

/** 清空注册（测试用） */
export function __clearHooks(): void {
  hooks.length = 0;
  feedbackByThread.clear();
  globalFeedback.length = 0;
}

/** 取当前已注册的 hook 数 */
export function hookCount(): number {
  return hooks.length;
}

/**
 * 对一组路径跑所有匹配的 hook，结果记到 feedback 缓冲区
 *
 * @returns 触发的 feedback 条目（只含本次执行产生的）
 */
export async function runBuildHooks(
  paths: string[],
  ctx: HookCtx,
): Promise<HookFeedback[]> {
  if (paths.length === 0 || hooks.length === 0) return [];

  const produced: HookFeedback[] = [];
  for (const path of paths) {
    // 同路径旧 feedback 失效（不论成功失败都以最新一次为准）
    if (ctx.threadId) {
      const arr = feedbackByThread.get(ctx.threadId);
      if (arr) {
        const filtered = arr.filter((f) => f.path !== path);
        feedbackByThread.set(ctx.threadId, filtered);
      }
    } else {
      for (let i = globalFeedback.length - 1; i >= 0; i--) {
        if (globalFeedback[i]!.path === path) globalFeedback.splice(i, 1);
      }
    }

    for (const h of hooks) {
      if (!h.match(path)) continue;
      const start = Date.now();
      let res: HookResult;
      try {
        res = await h.run(path, ctx);
      } catch (err: any) {
        res = {
          success: false,
          output: `hook ${h.name} 抛异常: ${err?.message ?? err}`,
          errors: [String(err?.message ?? err)],
        };
      }
      const fb: HookFeedback = {
        hookName: h.name,
        path,
        success: res.success,
        output: res.output,
        errors: res.errors,
        timestamp: Date.now(),
        durationMs: res.durationMs ?? Date.now() - start,
      };
      produced.push(fb);
      if (ctx.threadId) {
        const arr = feedbackByThread.get(ctx.threadId) ?? [];
        arr.push(fb);
        feedbackByThread.set(ctx.threadId, arr);
      } else {
        globalFeedback.push(fb);
      }
    }
  }
  return produced;
}

/**
 * 读某线程最近的 feedback（过滤掉过期 + 成功的）
 *
 * context-builder 每轮构建调此函数获取未解决的 build 错误注入 knowledge。
 */
export function getBuildFeedback(threadId?: string): HookFeedback[] {
  const now = Date.now();
  const arr = threadId ? feedbackByThread.get(threadId) ?? [] : globalFeedback;
  const filtered = arr.filter((f) => now - f.timestamp < FEEDBACK_TTL_MS && !f.success);
  return [...filtered];
}

/** 手动清除某线程 feedback（例如 tsc 通过后） */
export function clearFeedback(threadId?: string): void {
  if (threadId) feedbackByThread.delete(threadId);
  else globalFeedback.length = 0;
}

/** 格式化 feedback 为 markdown，供 knowledge window 注入 */
export function formatFeedbackForContext(feedback: HookFeedback[]): string {
  if (feedback.length === 0) return "";
  const lines: string[] = ["# Build Feedback（自动触发的检查失败）", ""];
  for (const f of feedback) {
    lines.push(`## [${f.hookName}] ${f.path}`);
    if (f.errors && f.errors.length > 0) {
      for (const e of f.errors.slice(0, 10)) lines.push(`- ${e}`);
    }
    if (f.output) {
      const snippet = f.output.length > 1200 ? f.output.slice(0, 1200) + "...(truncated)" : f.output;
      lines.push("");
      lines.push("```");
      lines.push(snippet);
      lines.push("```");
    }
    lines.push("");
  }
  return lines.join("\n");
}

/* ========== 默认 hooks ========== */

/** tsc --noEmit 片段 check（只检查指定文件，快速模式） */
export const tscCheckHook: BuildHook = {
  name: "tsc-check",
  match: (p) => /\.tsx?$/.test(p),
  run: async (path, ctx) => {
    const start = Date.now();
    try {
      const proc = Bun.spawn(
        ["bun", "x", "tsc", "--noEmit", "--skipLibCheck", "--allowJs", path],
        { cwd: ctx.rootDir, stdout: "pipe", stderr: "pipe" },
      );
      const [stdoutText, stderrText] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;
      const combined = (stdoutText + stderrText).trim();
      const success = proc.exitCode === 0;
      const errors = success ? undefined : combined.split("\n").filter((l) => l.trim().length > 0);
      return {
        success,
        output: combined.slice(0, 4000),
        errors,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `tsc 执行失败: ${err?.message ?? err}`,
        errors: [String(err?.message ?? err)],
        durationMs: Date.now() - start,
      };
    }
  },
};

/** JSON 语法 check（只解析不执行） */
export const jsonSyntaxHook: BuildHook = {
  name: "json-syntax",
  match: (p) => /\.json$/.test(p),
  run: async (path, ctx) => {
    const start = Date.now();
    try {
      const abs = path.startsWith("/") ? path : `${ctx.rootDir}/${path}`;
      const text = await Bun.file(abs).text();
      JSON.parse(text);
      return { success: true, output: "", durationMs: Date.now() - start };
    } catch (err: any) {
      return {
        success: false,
        output: `JSON 解析失败: ${err?.message ?? err}`,
        errors: [String(err?.message ?? err)],
        durationMs: Date.now() - start,
      };
    }
  },
};

/**
 * 注册默认 hook 集合（world 启动时调用）
 *
 * 开关：`OOC_BUILD_HOOKS=0` 完全关闭；默认只注册 json-syntax（轻量、零风险）。
 * tsc-check 因为速度较慢（冷启动 >5s），默认不注册，需要 `OOC_BUILD_HOOKS_TSC=1` 开启。
 */
export function registerDefaultHooks(): void {
  if (process.env.OOC_BUILD_HOOKS === "0") return;
  registerBuildHook(jsonSyntaxHook);
  if (process.env.OOC_BUILD_HOOKS_TSC === "1") {
    registerBuildHook(tscCheckHook);
  }
}

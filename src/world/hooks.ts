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
  /**
   * 防循环计数（Phase 5）
   *
   * 仅在 success=false 时有值；同一 (path, errorHash) 在同一 bucket 内连续出现的次数。
   * formatFeedbackForContext 读取此字段决定是否追加"已重复失败 N 次"告警文本。
   */
  repeatCount?: number;
}

/** feedback 过期时间：5 分钟 */
const FEEDBACK_TTL_MS = 5 * 60 * 1000;

/** 防循环阈值：同一 (path, errorHash) 连续失败此数后 formatFeedbackForContext 注入告警 */
const REPEAT_FAIL_THRESHOLD = 3;

/** 全局 hook 注册表 */
const hooks: BuildHook[] = [];
/** 每线程 feedback（threadId → 时间序 HookFeedback 列表） */
const feedbackByThread = new Map<string, HookFeedback[]>();
/** 全局 feedback（当 threadId 缺失时） */
const globalFeedback: HookFeedback[] = [];

/**
 * 防循环计数表：bucket(threadId) → key(path + errHash) → count
 *
 * 每当同一路径同一错误再次出现时递增；同路径一旦成功则清零。
 * key 由 `${path}||${errorHash}` 构成，errorHash 是 errors 文本的简单哈希。
 */
const repeatCountsByBucket = new Map<string, Map<string, number>>();

/** 简易字符串哈希（非加密，够把错误文本区分开即可） */
function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** 计算 feedback 的重复 key（path + 错误文本哈希） */
function feedbackRepeatKey(fb: HookFeedback): string {
  const src = fb.errors && fb.errors.length > 0 ? fb.errors.join("\n") : fb.output;
  return `${fb.path}||${hashText(src)}`;
}

/** 获取 / 初始化某 bucket 的计数 map */
function getRepeatMap(bucketId: string): Map<string, number> {
  let m = repeatCountsByBucket.get(bucketId);
  if (!m) {
    m = new Map();
    repeatCountsByBucket.set(bucketId, m);
  }
  return m;
}

/** 注册 hook */
export function registerBuildHook(hook: BuildHook): void {
  hooks.push(hook);
}

/** 清空注册（测试用） */
export function __clearHooks(): void {
  hooks.length = 0;
  feedbackByThread.clear();
  globalFeedback.length = 0;
  repeatCountsByBucket.clear();
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
  /* bucket 语义：threadId 存在则按线程隔离计数；否则落 __global__ 桶 */
  const bucketId = ctx.threadId ?? "__global__";
  const repeatMap = getRepeatMap(bucketId);

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

    /* 先预设当前路径的成功状态——只要本轮所有 match 的 hook 都返回 success，
     * 该路径下所有历史 repeat count 都会被清零。此处先默认 true，任一失败置 false。 */
    let pathAllSuccess = true;

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

      /* 防循环计数：
       * - 失败：按 (path, errorHash) 累加；阈值 REPEAT_FAIL_THRESHOLD 达到后
       *   后续注入会附带"已重复失败 N 次"告警（由 formatFeedbackForContext 读取 fb.repeatCount）
       * - 成功：仅将该 hook 的结果排除在 feedback 外；path 级清零延后到循环末统一处理 */
      if (!fb.success) {
        pathAllSuccess = false;
        const key = feedbackRepeatKey(fb);
        const prev = repeatMap.get(key) ?? 0;
        const next = prev + 1;
        repeatMap.set(key, next);
        fb.repeatCount = next;
      }

      produced.push(fb);
      if (ctx.threadId) {
        const arr = feedbackByThread.get(ctx.threadId) ?? [];
        arr.push(fb);
        feedbackByThread.set(ctx.threadId, arr);
      } else {
        globalFeedback.push(fb);
      }
    }

    /* 同一 path 本轮所有 hook 都 pass → 清空该 path 下所有历史 repeatCount
     * 避免"先失败 N 次、后修好一次、再失败"被误判为"已重复失败 N+1 次"。 */
    if (pathAllSuccess) {
      for (const k of [...repeatMap.keys()]) {
        if (k.startsWith(`${path}||`)) repeatMap.delete(k);
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

/** 格式化 feedback 为 markdown，供 knowledge window 注入
 *
 * 防循环（Phase 5）：若 feedback 中任一条 `repeatCount >= REPEAT_FAIL_THRESHOLD`，
 * 在头部追加全局告警段，提示 LLM 停手换思路（而非继续以同样方式改同一文件）。
 * 单条 feedback 里 repeatCount >= 阈值时，在该条 section 开头也标注本条的计数。
 */
export function formatFeedbackForContext(feedback: HookFeedback[]): string {
  if (feedback.length === 0) return "";
  const lines: string[] = ["# Build Feedback（自动触发的检查失败）", ""];

  /* 挑出已达阈值的条目用于全局告警 */
  const repeated = feedback.filter((f) => (f.repeatCount ?? 0) >= REPEAT_FAIL_THRESHOLD);
  if (repeated.length > 0) {
    lines.push("> ⚠️ 以下错误已重复失败多次，请停下来换思路：");
    for (const f of repeated) {
      lines.push(`> - [${f.hookName}] ${f.path} 已重复失败 ${f.repeatCount} 次（阈值 ${REPEAT_FAIL_THRESHOLD}）。不要再以同样方式修这个文件。`);
    }
    lines.push("");
  }

  for (const f of feedback) {
    let header = `## [${f.hookName}] ${f.path}`;
    if ((f.repeatCount ?? 0) >= REPEAT_FAIL_THRESHOLD) {
      header += ` ⚠️ 已重复失败 ${f.repeatCount} 次`;
    }
    lines.push(header);
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

/** 导出阈值用于测试 / 文档引用 */
export function getRepeatFailThreshold(): number {
  return REPEAT_FAIL_THRESHOLD;
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

/**
 * Prettier 格式化 hook —— 调 `bun x prettier --write {path}` 自动格式化
 *
 * 设计：
 * - 不把"格式化结果不同于原文件"视为失败——prettier 的正常产出就是 autofix，
 *   成功时 output 返回"已 prettier format"给 LLM 一个看得见的提示即可
 * - 仅在命令非零退出（prettier 崩 / 配置错误）时 success=false
 * - 支持 .ts/.tsx/.js/.jsx/.json/.md/.css/.html
 */
export const prettierFormatHook: BuildHook = {
  name: "prettier-format",
  match: (p) => /\.(tsx?|jsx?|json|md|css|html|ya?ml)$/.test(p),
  run: async (path, ctx) => {
    const start = Date.now();
    try {
      const abs = path.startsWith("/") ? path : `${ctx.rootDir}/${path}`;
      const proc = Bun.spawn(
        ["bun", "x", "prettier", "--write", abs],
        { cwd: ctx.rootDir, stdout: "pipe", stderr: "pipe" },
      );
      const [stdoutText, stderrText] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;
      const combined = (stdoutText + stderrText).trim();
      const success = proc.exitCode === 0;
      return {
        success,
        output: success ? "prettier 已格式化" : combined.slice(0, 2000),
        errors: success ? undefined : combined.split("\n").filter((l) => l.trim().length > 0),
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `prettier 执行失败: ${err?.message ?? err}`,
        errors: [String(err?.message ?? err)],
        durationMs: Date.now() - start,
      };
    }
  },
};

/**
 * ESLint 检查 hook —— 调 `bun x eslint {path}` 检查代码错误
 *
 * 设计：
 * - 非零退出码视为失败，把 stdout/stderr 作为错误给 LLM
 * - 仅匹配 js/ts 家族（eslint 默认不处理其他）
 */
export const eslintCheckHook: BuildHook = {
  name: "eslint-check",
  match: (p) => /\.(tsx?|jsx?|mjs|cjs)$/.test(p),
  run: async (path, ctx) => {
    const start = Date.now();
    try {
      const abs = path.startsWith("/") ? path : `${ctx.rootDir}/${path}`;
      const proc = Bun.spawn(
        ["bun", "x", "eslint", abs],
        { cwd: ctx.rootDir, stdout: "pipe", stderr: "pipe" },
      );
      const [stdoutText, stderrText] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;
      const combined = (stdoutText + stderrText).trim();
      const success = proc.exitCode === 0;
      return {
        success,
        output: combined.slice(0, 4000),
        errors: success ? undefined : combined.split("\n").filter((l) => l.trim().length > 0),
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `eslint 执行失败: ${err?.message ?? err}`,
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
 * Code Index 增量刷新 hook —— 写/改文件后触发 `code_index.index_refresh({ paths })`
 *
 * 设计：
 * - 只匹配 tree-sitter 支持的语言扩展（ts/tsx/js/jsx/mjs/cjs/py/go/rs）
 * - 调 index_refresh 增量版本，只重扫本路径（全量避免）
 * - success 始终为 true（索引更新失败只告警，不阻塞 LLM 的下一轮；feedback
 *   不向 LLM 展示，避免制造噪声——真正的"build 错误"由 tsc/eslint 专职 hook 负责）
 * - 默认不注册；打开 `OOC_CODE_INDEX_HOOK=1` 才启用
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_code_index_v2.md — Phase 3
 */
export const codeIndexRefreshHook: BuildHook = {
  name: "code-index-refresh",
  match: (p) => /\.(tsx?|jsx?|mjs|cjs|py|go|rs)$/.test(p),
  run: async (path, ctx) => {
    const start = Date.now();
    try {
      /* 动态 import 避免 hooks 模块对 trait 产生静态依赖 */
      const mod: any = await import("../../traits/computable/code_index/index.js");
      const res = await mod.index_refresh({ rootDir: ctx.rootDir }, [path]);
      const ok = res?.ok === true;
      return {
        success: true, /* 始终视为"非阻塞" */
        output: ok
          ? `code_index 已增量刷新: ${path} (touched=${res.data?.touched ?? 1})`
          : `code_index 刷新失败（已忽略）: ${res?.error ?? "unknown"}`,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: true,
        output: `code_index 刷新异常（已忽略）: ${err?.message ?? err}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

/**
 * 注册默认 hook 集合（world 启动时调用）
 *
 * 开关：
 * - `OOC_BUILD_HOOKS=0` 完全关闭所有 hook
 * - `OOC_BUILD_HOOKS_TSC=1` 启用 tsc-check（冷启动 >5s，默认关）
 * - `OOC_BUILD_HOOKS_PRETTIER=1` 启用 prettier-format（默认关，autofix 风险）
 * - `OOC_BUILD_HOOKS_ESLINT=1` 启用 eslint-check（默认关）
 * - `OOC_CODE_INDEX_HOOK=1` 启用 code_index 增量刷新（默认关；开启后写文件自动 index_refresh）
 *
 * 默认只注册 json-syntax（轻量、零风险）。
 */
export function registerDefaultHooks(): void {
  if (process.env.OOC_BUILD_HOOKS === "0") return;
  registerBuildHook(jsonSyntaxHook);
  if (process.env.OOC_BUILD_HOOKS_TSC === "1") {
    registerBuildHook(tscCheckHook);
  }
  if (process.env.OOC_BUILD_HOOKS_PRETTIER === "1") {
    registerBuildHook(prettierFormatHook);
  }
  if (process.env.OOC_BUILD_HOOKS_ESLINT === "1") {
    registerBuildHook(eslintCheckHook);
  }
  if (process.env.OOC_CODE_INDEX_HOOK === "1") {
    registerBuildHook(codeIndexRefreshHook);
  }
}

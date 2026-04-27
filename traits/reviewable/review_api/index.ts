/**
 * reviewable/review_api —— 代码审查的操作工具集（kernel trait）
 *
 * 提供给 reviewer 分身/线程使用的 4 个方法：
 *
 * 1. `read_diff({ref1?, ref2?, pr?})` — 获取结构化 diff（file / hunk / contextLine）
 * 2. `post_review({findings, prNumber?, filePath?})` — 产出 review 报告；
 *    有 prNumber 时通过 gh CLI 评论；有 filePath 时写 markdown 文件。
 * 3. `multi_perspective_review({personas?, diffRef1?, diffRef2?})` — 返回
 *    多视角审查的 **编排模板**（每个 persona 的 bias prompt + 建议 fork 语句），
 *    让调用者 LLM 通过 `[create_sub_thread]` / `talk` 实际发起多线程审查。
 *    ——不自己 fork 线程，只生成 recipe；避免在 kernel trait 里强耦合 thread/engine。
 * 4. `suggest_fixes({findings})` — 把 findings 翻译为 edit_plan 骨架
 *    （file + hunk anchor + suggested text），供 multi-file transaction 迭代消费。
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_code_review_trait.md — implements
 */

import type { TraitMethod } from "../../../src/types/index";
import { toolOk, toolErr } from "../../../src/types/tool-result";
import type { ToolResult } from "../../../src/types/tool-result";

// ─── 内部辅助 ─────────────────────────────────────────────

/**
 * 执行 shell 命令，返回 stdout/stderr/exitCode
 */
async function runCmd(
  cwd: string,
  cmd: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { stdout, stderr, exitCode };
}

// ─── 类型定义 ─────────────────────────────────────────────

/** 结构化 diff 中一个 hunk（`@@ -a,b +c,d @@` 块） */
export interface DiffHunk {
  /** 原始 hunk header，如 `@@ -10,7 +10,8 @@ function foo()` */
  header: string;
  /** 旧文件起始行 */
  oldStart: number;
  /** 旧文件行数 */
  oldLines: number;
  /** 新文件起始行 */
  newStart: number;
  /** 新文件行数 */
  newLines: number;
  /** 纯 context 行（无前缀 ± 号；便于 review 时引用） */
  contextLines: string[];
  /** 被删除的行 */
  removedLines: string[];
  /** 被新增的行 */
  addedLines: string[];
}

/** 结构化 diff 中一个文件条目 */
export interface DiffFile {
  /** 文件路径（新文件名） */
  path: string;
  /** 变更模式：added / modified / deleted / renamed */
  mode: "added" | "modified" | "deleted" | "renamed" | "unknown";
  /** 若重命名，旧路径 */
  oldPath?: string;
  /** hunk 列表 */
  hunks: DiffHunk[];
}

export interface ReadDiffInput {
  /** 起点 ref（如 "main"），与 ref2 成对传 */
  ref1?: string;
  /** 终点 ref（如 "HEAD"） */
  ref2?: string;
  /** 若指定 PR 号，通过 `gh pr diff {pr}` 获取 */
  pr?: number;
}

export interface ReadDiffResult {
  files: DiffFile[];
  /** 原始 diff 文本（调试用） */
  rawLength: number;
}

export interface ReviewFinding {
  /** 文件路径 */
  path: string;
  /** 关联行号（新文件） */
  line?: number;
  /** 严重度 */
  severity: "critical" | "high" | "medium" | "low" | "info";
  /** 分类（如 security / perf / readability / architecture） */
  category?: string;
  /** 问题描述 */
  message: string;
  /** 建议 */
  suggestion?: string;
}

export interface PostReviewInput {
  findings: ReviewFinding[];
  /** 摘要（一段话） */
  summary?: string;
  /** 如提供 PR number → 通过 gh 发评论 */
  prNumber?: number;
  /** 如提供 filePath → 写 markdown 文件（绝对路径或相对 cwd） */
  filePath?: string;
  /** 用于 git/gh 的 rootDir（默认 process.cwd()） */
  rootDir?: string;
}

export interface MultiPerspectiveInput {
  /** personas；默认 ["security", "performance", "readability", "architecture"] */
  personas?: string[];
  /** diff 范围 ref1 */
  diffRef1?: string;
  /** diff 范围 ref2 */
  diffRef2?: string;
  /** PR 号（与 diffRef 二选一） */
  pr?: number;
}

export interface PerspectiveRecipe {
  persona: string;
  /** bias prompt（注入到子线程 system 指令） */
  biasPrompt: string;
  /** 建议的 fork 描述（title + description） */
  forkTitle: string;
  forkDescription: string;
}

export interface MultiPerspectiveResult {
  recipes: PerspectiveRecipe[];
  /** 预置的合并策略提示 */
  mergeHint: string;
}

export interface SuggestFixesInput {
  findings: ReviewFinding[];
}

export interface EditPlanStep {
  path: string;
  line?: number;
  /** 粗粒度改动描述（suggestion 或根据 message 推断） */
  change: string;
  /** 严重度 → 优先级映射 */
  priority: number;
}

export interface SuggestFixesResult {
  steps: EditPlanStep[];
}

// ─── Diff 解析（unified diff → 结构化） ─────────────────────

/**
 * 解析 unified diff 文本为结构化 DiffFile[]
 *
 * 支持：
 * - `diff --git a/x b/y` 开头的标准块
 * - `@@ -a,b +c,d @@` hunk header
 * - new/deleted/renamed file 标记
 */
export function parseUnifiedDiff(raw: string): DiffFile[] {
  if (!raw || raw.trim().length === 0) return [];

  const files: DiffFile[] = [];
  const lines = raw.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.startsWith("diff --git ")) {
      i++;
      continue;
    }

    /* 抽取 a/b 路径 */
    const m = line.match(/^diff --git a\/(.*?) b\/(.*)$/);
    const oldPath = m?.[1] ?? "";
    const newPath = m?.[2] ?? "";

    let mode: DiffFile["mode"] = "modified";
    let finalOldPath: string | undefined;

    /* 扫描文件头几行（直到第一个 @@ 或下一个 diff --git） */
    i++;
    while (i < lines.length && !(lines[i] ?? "").startsWith("@@") && !(lines[i] ?? "").startsWith("diff --git ")) {
      const h = lines[i] ?? "";
      if (h.startsWith("new file mode")) mode = "added";
      else if (h.startsWith("deleted file mode")) mode = "deleted";
      else if (h.startsWith("rename from ")) {
        mode = "renamed";
        finalOldPath = h.slice("rename from ".length).trim();
      }
      i++;
    }

    const hunks: DiffHunk[] = [];

    /* 解析 hunks */
    while (i < lines.length && (lines[i] ?? "").startsWith("@@")) {
      const header = lines[i] ?? "";
      const hm = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      const hunk: DiffHunk = {
        header,
        oldStart: hm?.[1] ? parseInt(hm[1], 10) : 0,
        oldLines: hm && hm[2] ? parseInt(hm[2], 10) : 1,
        newStart: hm?.[3] ? parseInt(hm[3], 10) : 0,
        newLines: hm && hm[4] ? parseInt(hm[4], 10) : 1,
        contextLines: [],
        removedLines: [],
        addedLines: [],
      };
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("@@") && !(lines[i] ?? "").startsWith("diff --git ")) {
        const bodyLine = lines[i] ?? "";
        if (bodyLine.startsWith("+") && !bodyLine.startsWith("+++")) {
          hunk.addedLines.push(bodyLine.slice(1));
        } else if (bodyLine.startsWith("-") && !bodyLine.startsWith("---")) {
          hunk.removedLines.push(bodyLine.slice(1));
        } else if (bodyLine.startsWith(" ")) {
          hunk.contextLines.push(bodyLine.slice(1));
        }
        /* 忽略 "\\ No newline at end of file" 等元信息 */
        i++;
      }
      hunks.push(hunk);
    }

    files.push({
      path: mode === "deleted" ? oldPath : newPath,
      mode,
      oldPath: finalOldPath ?? (mode === "renamed" ? oldPath : undefined),
      hunks,
    });
  }

  return files;
}

// ─── llm_methods 实现 ────────────────────────────────────

/**
 * read_diff —— 拉取 diff 文本并解析为结构化
 */
async function readDiffImpl(
  ctx: any,
  input: ReadDiffInput,
): Promise<ToolResult<ReadDiffResult>> {
  const rootDir = ctx?.rootDir ?? process.cwd();
  try {
    let raw = "";
    if (input.pr !== undefined) {
      const r = await runCmd(rootDir, ["gh", "pr", "diff", String(input.pr)]);
      if (r.exitCode !== 0) {
        return toolErr(`gh pr diff 失败: ${r.stderr.trim() || "unknown"}`);
      }
      raw = r.stdout;
    } else {
      const ref1 = input.ref1 ?? "HEAD~1";
      const ref2 = input.ref2 ?? "HEAD";
      const r = await runCmd(rootDir, ["git", "diff", ref1, ref2]);
      if (r.exitCode !== 0) {
        return toolErr(`git diff 失败: ${r.stderr.trim() || "unknown"}`);
      }
      raw = r.stdout;
    }

    const files = parseUnifiedDiff(raw);
    return toolOk({ files, rawLength: raw.length });
  } catch (err: any) {
    return toolErr(`read_diff 执行失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * post_review —— 写 markdown 或发 PR 评论
 */
async function postReviewImpl(
  ctx: any,
  input: PostReviewInput,
): Promise<ToolResult<{ mode: "pr" | "file" | "text"; target: string }>> {
  if (!Array.isArray(input?.findings)) {
    return toolErr("post_review: findings 必须是数组");
  }
  const rootDir = input.rootDir ?? ctx?.rootDir ?? process.cwd();

  /* 渲染 markdown */
  const body = renderReviewMarkdown(input.summary ?? "", input.findings);

  if (input.prNumber !== undefined) {
    if (!Number.isInteger(input.prNumber) || input.prNumber <= 0) {
      return toolErr("post_review: prNumber 必须是正整数");
    }
    try {
      const r = await runCmd(rootDir, [
        "gh",
        "pr",
        "comment",
        String(input.prNumber),
        "--body",
        body,
      ]);
      if (r.exitCode !== 0) {
        return toolErr(`gh pr comment 失败: ${r.stderr.trim() || "unknown"}`);
      }
      return toolOk({ mode: "pr", target: `PR #${input.prNumber}` });
    } catch (err: any) {
      return toolErr(`post_review(pr) 失败: ${err?.message ?? String(err)}`);
    }
  }

  if (input.filePath) {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const abs = path.isAbsolute(input.filePath)
        ? input.filePath
        : path.join(rootDir, input.filePath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, body, "utf-8");
      return toolOk({ mode: "file", target: abs });
    } catch (err: any) {
      return toolErr(`post_review(file) 失败: ${err?.message ?? String(err)}`);
    }
  }

  /* 没指定 PR 也没文件 → 只返回渲染好的 markdown（text mode） */
  return toolOk({ mode: "text", target: body });
}

/**
 * 把 summary + findings 渲染成 markdown 审查报告
 */
export function renderReviewMarkdown(
  summary: string,
  findings: ReviewFinding[],
): string {
  const lines: string[] = [];
  lines.push("# Code Review Report");
  lines.push("");
  if (summary.trim()) {
    lines.push("## Summary");
    lines.push("");
    lines.push(summary.trim());
    lines.push("");
  }

  if (findings.length === 0) {
    lines.push("## Findings");
    lines.push("");
    lines.push("_无发现。_");
    return lines.join("\n");
  }

  /* 按 severity 分组渲染 */
  const order: ReviewFinding["severity"][] = [
    "critical",
    "high",
    "medium",
    "low",
    "info",
  ];
  lines.push("## Findings");
  lines.push("");
  for (const sev of order) {
    const group = findings.filter(f => f.severity === sev);
    if (group.length === 0) continue;
    lines.push(`### ${sev.toUpperCase()} (${group.length})`);
    lines.push("");
    for (const f of group) {
      const loc = f.line !== undefined ? `${f.path}:${f.line}` : f.path;
      const cat = f.category ? ` [${f.category}]` : "";
      lines.push(`- **${loc}**${cat} — ${f.message}`);
      if (f.suggestion) lines.push(`  - 建议：${f.suggestion}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * multi_perspective_review —— 返回各视角的 bias prompt + fork 配方
 *
 * 不真正 fork 线程（避免 kernel trait 反向依赖 thread/engine），
 * 而是产出配方让调用 LLM 用 `[create_sub_thread]` TOML 自行发起。
 */
export function buildMultiPerspectiveRecipes(
  personas: string[],
): PerspectiveRecipe[] {
  const templates: Record<string, { bias: string; desc: string }> = {
    security: {
      bias:
        "你是 security reviewer。只关注：输入校验、认证授权、SQL/XSS/CSRF 注入、密钥泄露、越权访问、超时/拒绝服务。忽略风格和性能。",
      desc: "从安全角度审查这份 diff，列出 finding（path/line/severity/suggestion）",
    },
    performance: {
      bias:
        "你是 performance reviewer。只关注：算法复杂度、N+1 查询、不必要的循环/拷贝、内存泄漏、阻塞 I/O、缓存缺失。忽略风格和安全。",
      desc: "从性能角度审查这份 diff，列出 finding",
    },
    readability: {
      bias:
        "你是 readability reviewer。只关注：命名、结构、注释、函数长度、圈复杂度、魔法数字。忽略性能和安全。",
      desc: "从可读性角度审查这份 diff，列出 finding",
    },
    architecture: {
      bias:
        "你是 architecture reviewer。只关注：分层边界、依赖方向、抽象合理性、重复代码、关注点分离。忽略细节实现。",
      desc: "从架构角度审查这份 diff，列出 finding",
    },
  };

  return personas.map(p => {
    const t = templates[p] ?? {
      bias: `你是 ${p} reviewer。从 ${p} 视角审查。`,
      desc: `从 ${p} 角度审查这份 diff，列出 finding`,
    };
    return {
      persona: p,
      biasPrompt: t.bias,
      forkTitle: `${p} review`,
      forkDescription: t.desc,
    };
  });
}

async function multiPerspectiveReviewImpl(
  _ctx: any,
  input: MultiPerspectiveInput,
): Promise<ToolResult<MultiPerspectiveResult>> {
  const personas =
    input.personas && input.personas.length > 0
      ? input.personas
      : ["security", "performance", "readability", "architecture"];
  const recipes = buildMultiPerspectiveRecipes(personas);
  const mergeHint =
    "对每个 persona，通过 [create_sub_thread] fork 子线程并注入对应 biasPrompt（via open(type='trait', path=...) 或直接 talk）。" +
    "子线程 return 时带 findings[]，主线程收集后去重/合并为最终 review。" +
    "合并策略：同 path:line 且同 severity 的视为重复，保留视角标签集合。";
  return toolOk({ recipes, mergeHint });
}

/**
 * suggest_fixes —— 把 findings 翻译成 edit_plan 骨架
 */
async function suggestFixesImpl(
  _ctx: any,
  input: SuggestFixesInput,
): Promise<ToolResult<SuggestFixesResult>> {
  if (!Array.isArray(input?.findings)) {
    return toolErr("suggest_fixes: findings 必须是数组");
  }
  const severityPriority: Record<ReviewFinding["severity"], number> = {
    critical: 1,
    high: 2,
    medium: 3,
    low: 4,
    info: 5,
  };
  const steps: EditPlanStep[] = input.findings.map(f => ({
    path: f.path,
    line: f.line,
    change: f.suggestion ?? `根据 review 修正: ${f.message}`,
    priority: severityPriority[f.severity] ?? 5,
  }));
  /* 按 priority 排序（高优先级在前） */
  steps.sort((a, b) => a.priority - b.priority);
  return toolOk({ steps });
}

// ─── 导出 ────────────────────────────────────────────────

export const llm_methods: Record<string, TraitMethod> = {
  read_diff: {
    name: "read_diff",
    description:
      "获取并解析 diff 为结构化 {files:[{path, mode, hunks:[{header, oldStart, newStart, addedLines, removedLines, contextLines}]}]}。可传 ref1/ref2 或 pr。",
    params: [
      { name: "ref1", type: "string", description: "起点 ref（默认 HEAD~1）", required: false },
      { name: "ref2", type: "string", description: "终点 ref（默认 HEAD）", required: false },
      { name: "pr", type: "number", description: "PR 编号（与 ref 二选一）", required: false },
    ],
    fn: ((ctx: any, args: ReadDiffInput) => readDiffImpl(ctx, args)) as TraitMethod["fn"],
  },
  post_review: {
    name: "post_review",
    description:
      "产出 review 报告：有 prNumber 则发 PR 评论；有 filePath 则写 markdown；都没有则返回渲染好的文本。",
    params: [
      { name: "findings", type: "object[]", description: "ReviewFinding 数组", required: true },
      { name: "summary", type: "string", description: "摘要", required: false },
      { name: "prNumber", type: "number", description: "PR 编号", required: false },
      { name: "filePath", type: "string", description: "文件路径（相对 rootDir 或绝对）", required: false },
      { name: "rootDir", type: "string", description: "git/gh 执行根目录", required: false },
    ],
    fn: ((ctx: any, args: PostReviewInput) => postReviewImpl(ctx, args)) as TraitMethod["fn"],
  },
  multi_perspective_review: {
    name: "multi_perspective_review",
    description:
      "返回多视角审查的编排配方（每个 persona 的 biasPrompt + 建议 fork 描述）。不自己 fork——由调用者 LLM 用 [create_sub_thread] 发起。",
    params: [
      { name: "personas", type: "string[]", description: "视角列表（默认 security/performance/readability/architecture）", required: false },
      { name: "diffRef1", type: "string", description: "起点 ref", required: false },
      { name: "diffRef2", type: "string", description: "终点 ref", required: false },
      { name: "pr", type: "number", description: "PR 编号", required: false },
    ],
    fn: ((ctx: any, args: MultiPerspectiveInput) =>
      multiPerspectiveReviewImpl(ctx, args)) as TraitMethod["fn"],
  },
  suggest_fixes: {
    name: "suggest_fixes",
    description:
      "把 findings[] 翻译为 edit_plan 骨架（path/line/change/priority），供多文件 transaction 迭代消费。",
    params: [
      { name: "findings", type: "object[]", description: "ReviewFinding 数组", required: true },
    ],
    fn: ((ctx: any, args: SuggestFixesInput) =>
      suggestFixesImpl(ctx, args)) as TraitMethod["fn"],
  },
};

export const ui_methods: Record<string, TraitMethod> = {};

/**
 * EditDiffCard — 文件编辑 Diff 卡片
 *
 * 用于在 thread view 中可视化 file_ops.editFile / writeFile / applyEdits 的
 * 每文件 before/after 变更（绿+/红- 高亮 + +N -N delta + 文件名标题）。
 *
 * 后端 trait method 调用方式不变，仅 result 多了 before/after 字段（详见
 * `kernel/traits/computable/file_ops/index.ts` 与 `kernel/src/persistence/edit-plans.ts`）。
 *
 * 设计选择：
 *  - 复用项目已有的 `FileDiffViewer`（基于 @codemirror/merge），不再额外引入
 *    `react-diff-viewer-continued`——已有依赖足够实现 spec 描述的 split / unified +
 *    collapseUnchanged + 语法高亮，符合"最小改动"原则
 *  - 默认 unified（更紧凑，适合 thread inline 流式阅读）；有 prop 可切 split
 *  - 头部统计行 +N -N delta 在前端用 line-level 比较计算（避免后端再增字段）
 *
 * @ref docs/工程管理/迭代/all/20260423_feature_edit_diff_展示.md
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Columns, AlignJustify } from "lucide-react";
import { cn } from "../lib/utils";
import { FileDiffViewer } from "./ui/FileDiffViewer";

/** 单个文件的 before/after 数据 */
export interface EditDiffEntry {
  /** 文件路径（用于卡片标题 + 语法高亮推断） */
  path: string;
  /** 写盘前内容（写新文件时为空串） */
  before: string;
  /** 写盘后内容 */
  after: string;
}

interface EditDiffCardProps {
  /** 单个文件的变更（多文件传 entries[]） */
  entry: EditDiffEntry;
  /** 是否默认折叠（thread 中堆叠较多时，可考虑默认折叠） */
  defaultCollapsed?: boolean;
  /** 渲染高度上限（超出滚动） */
  maxHeight?: string;
}

/** 简单 line-level 行差统计：不追求 myers diff 精度，给个 +N -N 直观感受即可 */
function computeLineDelta(before: string, after: string): { adds: number; removes: number } {
  if (before === after) return { adds: 0, removes: 0 };
  /** 写新文件：全文绿色 */
  if (before === "") {
    const adds = after === "" ? 0 : after.split("\n").length;
    return { adds, removes: 0 };
  }
  /** 写空（理论不太会出现，但兜底处理）：全文红色 */
  if (after === "") {
    return { adds: 0, removes: before.split("\n").length };
  }
  /** 通用：用 line set diff 估算（不计顺序，够看个量级） */
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Map<string, number>();
  for (const l of beforeLines) beforeSet.set(l, (beforeSet.get(l) ?? 0) + 1);
  const afterSet = new Map<string, number>();
  for (const l of afterLines) afterSet.set(l, (afterSet.get(l) ?? 0) + 1);
  let adds = 0;
  let removes = 0;
  for (const [line, count] of afterSet) {
    const matched = Math.min(count, beforeSet.get(line) ?? 0);
    adds += count - matched;
  }
  for (const [line, count] of beforeSet) {
    const matched = Math.min(count, afterSet.get(line) ?? 0);
    removes += count - matched;
  }
  return { adds, removes };
}

/** 从路径推断 codemirror 用语言名 */
function languageFromPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    py: "python",
    sh: "shell",
    bash: "shell",
    yaml: "yaml",
    yml: "yaml",
    html: "html",
    css: "css",
    rs: "rust",
    go: "go",
    java: "java",
  };
  return map[ext] ?? ext;
}

/**
 * EditDiffCard — 单文件 diff 卡片
 *
 * 头部：path · (new file)? · +N -N · split/unified 切换 · 折叠
 * 主体：FileDiffViewer
 */
export function EditDiffCard({ entry, defaultCollapsed = false, maxHeight = "320px" }: EditDiffCardProps) {
  const { path, before, after } = entry;
  const isNewFile = before === "" && after !== "";
  const isDeleted = before !== "" && after === "";
  const noOp = before === after;

  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

  const language = useMemo(() => languageFromPath(path), [path]);
  const { adds, removes } = useMemo(() => computeLineDelta(before, after), [before, after]);

  return (
    <div className="my-1.5 border border-[var(--border)] rounded-md overflow-hidden bg-[var(--card)]">
      {/* 头部 */}
      <div
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono select-none",
          "bg-[var(--accent)]/30 border-b border-[var(--border)]",
        )}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          title={collapsed ? "展开 diff" : "折叠 diff"}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <span className="truncate text-[var(--foreground)] flex-1 min-w-0" title={path}>{path}</span>
        {isNewFile && (
          <span className="shrink-0 px-1 py-px rounded text-[9px] bg-green-500/20 text-green-700 dark:text-green-300">
            new file
          </span>
        )}
        {isDeleted && (
          <span className="shrink-0 px-1 py-px rounded text-[9px] bg-red-500/20 text-red-700 dark:text-red-300">
            deleted
          </span>
        )}
        {noOp && !isNewFile && !isDeleted && (
          <span className="shrink-0 px-1 py-px rounded text-[9px] bg-gray-500/20 text-[var(--muted-foreground)]">
            no change
          </span>
        )}
        {/* +N -N delta */}
        {(adds > 0 || removes > 0) && (
          <span className="shrink-0 inline-flex items-center gap-1.5">
            {adds > 0 && <span className="text-green-600 dark:text-green-400">+{adds}</span>}
            {removes > 0 && <span className="text-red-600 dark:text-red-400">-{removes}</span>}
          </span>
        )}
        {!collapsed && (
          <button
            onClick={() => setViewMode(viewMode === "unified" ? "split" : "unified")}
            className="shrink-0 inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            title={viewMode === "unified" ? "切换到 split view" : "切换到 unified view"}
          >
            {viewMode === "unified" ? (
              <Columns className="w-3 h-3" />
            ) : (
              <AlignJustify className="w-3 h-3" />
            )}
          </button>
        )}
      </div>

      {/* 主体：diff viewer */}
      {!collapsed && (
        <div className="text-[12px]">
          <FileDiffViewer
            oldContent={before}
            newContent={after}
            language={language}
            viewMode={viewMode}
            showGutter={true}
            collapseUnchanged={true}
            maxHeight={maxHeight}
          />
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 *  detectEditDiffEntries — 从一个 action 中提取 EditDiffEntry[]
 *
 *  覆盖的 action 形态（向后兼容：识别失败时返回空数组，调用方 fallback 到原渲染）：
 *
 *  1. inject.content 形如 `>>> file_ops.editFile 结果:\n<JSON>`
 *     —— LLM 走 open(call_function) → submit 路径，engine 把 method 结果 inject 给下一轮
 *     JSON 形态（参考 file_ops/index.ts editFileImpl/writeFileImpl 返回）：
 *       { ok: true, data: { matchCount, before, after } }
 *
 *  2. inject.content 形如 `>>> file_ops.applyEdits 结果:\n<JSON>`
 *     JSON 形态（参考 edit-plans.ts ApplyResult）：
 *       { ok: true, data: { ok, applied, perChange: [{path, ok, before, after}, ...] } }
 *
 *  3. program.result 形如 `>>> output:\n<...>`，文本中含一段 JSON 包含 before/after
 *     —— LLM 在 program 里 callMethod 后 return 结果。这里只在结果"看起来就是单个
 *     方法 JSON" 时识别（避免误判 LLM 自由 println）。
 * ────────────────────────────────────────────────────────────────────── */

/**
 * 尝试从字符串中抽出最外层的 JSON 对象并 parse
 *
 * 容错策略：
 *  - 直接 JSON.parse 整段
 *  - 失败则正则定位首个 `{...}` 配对块（最外层）
 */
function tryParseJsonBlob(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fallthrough */
  }
  /** 正则定位首个 `{` 到匹配 `}` 的子串：用栈匹配 */
  const start = trimmed.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const blob = trimmed.slice(start, i + 1);
        try {
          return JSON.parse(blob);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 类型卫士：判断对象有 string before / string after 字段 */
function hasBeforeAfter(x: unknown): x is { before: string; after: string; path?: string } {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Record<string, unknown>).before === "string" &&
    typeof (x as Record<string, unknown>).after === "string"
  );
}

/**
 * 从一个 action（任意类型）中抽出 EditDiffEntry[]
 *
 * @returns 命中时返回 entries（≥1）；不命中返回 []
 */
export function detectEditDiffEntries(action: {
  type: string;
  content?: string;
  result?: string;
  args?: Record<string, unknown>;
  name?: string;
}): EditDiffEntry[] {
  /** 把 method 调用结果 JSON → 一组 EditDiffEntry */
  const fromMethodResult = (parsed: unknown, fallbackPath?: string): EditDiffEntry[] => {
    if (parsed === null || typeof parsed !== "object") return [];
    const obj = parsed as Record<string, unknown>;
    /* tool-result 标准包装：{ ok: true, data: {...} } */
    const data = (obj.ok === true && typeof obj.data === "object" && obj.data !== null)
      ? (obj.data as Record<string, unknown>)
      : obj;

    /* 1) applyEdits / planEdits → perChange[] */
    const perChange = data.perChange;
    if (Array.isArray(perChange)) {
      const entries: EditDiffEntry[] = [];
      for (const item of perChange) {
        if (hasBeforeAfter(item) && typeof (item as Record<string, unknown>).path === "string") {
          entries.push({
            path: (item as Record<string, unknown>).path as string,
            before: (item as Record<string, unknown>).before as string,
            after: (item as Record<string, unknown>).after as string,
          });
        }
      }
      return entries;
    }

    /* 2) editFile / writeFile → 单个 { before, after } */
    if (hasBeforeAfter(data)) {
      const path = (data as Record<string, unknown>).path as string | undefined;
      return [{
        path: path ?? fallbackPath ?? "(unknown)",
        before: data.before,
        after: data.after,
      }];
    }
    return [];
  };

  /* inject 路径：>>> trait.method 结果:\n<JSON> */
  if (action.type === "inject" && typeof action.content === "string") {
    /* 兼容 file_ops 各种方法名（editFile/writeFile/applyEdits 命中即可，但只在含 before/after 才返回） */
    const m = action.content.match(/^>>>\s*([^\s]+?)\s*结果:\n([\s\S]+)$/);
    if (m) {
      const fnId = m[1] ?? "";
      /* 只关心 file_ops 系列，避免无谓 parse 其他 method 输出 */
      if (fnId.includes("file_ops") || /editFile|writeFile|applyEdits/.test(fnId)) {
        const blob = m[2] ?? "";
        const parsed = tryParseJsonBlob(blob);
        if (parsed) {
          /* 尝试从 args 里取 path 作 fallback */
          const fallbackPath = typeof action.args?.path === "string"
            ? (action.args.path as string)
            : undefined;
          return fromMethodResult(parsed, fallbackPath);
        }
      }
    }
    return [];
  }

  /* program 路径：result = `>>> output:\n<...>`，里面可能是 JSON */
  if (action.type === "program" && typeof action.result === "string") {
    /* 仅在 result 文本里包含 "before" 与 "after" 两个 key 字面值时才 parse，避免无谓开销 */
    const text = action.result;
    if (!text.includes('"before"') || !text.includes('"after"')) return [];
    const stripped = text.replace(/^>>>\s*output:\s*/i, "");
    const parsed = tryParseJsonBlob(stripped);
    if (parsed) return fromMethodResult(parsed);
    return [];
  }

  return [];
}

/**
 * file_ops —— 文件操作 kernel trait
 *
 * 提供文件读写、编辑、目录操作能力。Phase 2 协议：
 * 通过沙箱 `callMethod("computable/file_ops", method, args)` 调用，args 永远是对象。
 *
 * 所有路径支持相对路径（相对于 ctx.rootDir）和绝对路径。
 */

import { resolve, join } from "path";
import { toolOk, toolErr } from "../../../src/types/tool-result";
import type { ToolResult } from "../../../src/types/tool-result";
import type { TraitMethod } from "../../../src/types/index";
import {
  createEditPlan,
  readEditPlan,
  previewEditPlan,
  applyEditPlan,
  cancelEditPlan,
  type EditChange,
  type EditPlan,
  type ApplyResult,
} from "../../../src/persistence/edit-plans";

/** 路径解析：绝对路径直接用，相对路径基于 rootDir */
const resolvePath = (rootDir: string, p: string) =>
  p.startsWith("/") ? p : resolve(rootDir, p);

/**
 * 读取文件内容，返回带行号的文本
 */
async function readFileImpl(
  ctx: { rootDir?: string },
  { path, offset = 0, limit = 200 }: { path: string; offset?: number; limit?: number },
): Promise<ToolResult<{ content: string; totalLines: number; truncated: boolean }>> {
  const fullPath = resolvePath(ctx.rootDir ?? "", path);

  try {
    const file = Bun.file(fullPath);
    const exists = await file.exists();
    if (!exists) {
      return toolErr(`文件不存在: ${path}`);
    }

    const text = await file.text();
    const allLines = text.split("\n");
    const totalLines = allLines.length;
    const sliced = allLines.slice(offset, offset + limit);
    const truncated = offset + limit < totalLines;

    // 带行号格式化
    const padWidth = String(offset + sliced.length).length;
    const content = sliced
      .map((line, i) => {
        const lineNum = String(offset + i + 1).padStart(padWidth, " ");
        return `${lineNum} | ${line}`;
      })
      .join("\n");

    return toolOk({ content, totalLines, truncated });
  } catch (err: any) {
    return toolErr(`读取文件失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 在文件中搜索并替换文本。
 * 两级容错：先精确匹配，再尝试 trim 空白匹配。
 *
 * 返回值除 matchCount 外，还附带 before/after 完整文本，供前端渲染绿+/红- 风格的
 * diff 卡片。before = 写盘前内容，after = 写盘后内容。
 */
async function editFileImpl(
  ctx: { rootDir?: string },
  {
    path,
    oldStr,
    newStr,
    replaceAll = false,
  }: { path: string; oldStr: string; newStr: string; replaceAll?: boolean },
): Promise<ToolResult<{ matchCount: number; before: string; after: string; path: string }>> {
  const fullPath = resolvePath(ctx.rootDir ?? "", path);

  try {
    const file = Bun.file(fullPath);
    const exists = await file.exists();
    if (!exists) {
      return toolErr(`文件不存在: ${path}`);
    }

    const text = await file.text();
    /** 写盘前快照——用于 diff 渲染的 before 字段 */
    const before = text;

    // 第一级：精确匹配
    let matchCount = 0;
    let idx = -1;
    let searchFrom = 0;
    while ((idx = text.indexOf(oldStr, searchFrom)) !== -1) {
      matchCount++;
      searchFrom = idx + oldStr.length;
    }

    // 第二级：trim 空白容错匹配
    if (matchCount === 0) {
      const trimmedOld = oldStr.split("\n").map((l) => l.trim()).join("\n");
      const lines = text.split("\n");

      const oldLines = trimmedOld.split("\n");
      const matches: number[] = [];

      for (let i = 0; i <= lines.length - oldLines.length; i++) {
        let found = true;
        for (let j = 0; j < oldLines.length; j++) {
          if (lines[i + j]!.trim() !== oldLines[j]) {
            found = false;
            break;
          }
        }
        if (found) {
          matches.push(i);
        }
      }

      matchCount = matches.length;

      if (matchCount === 0) {
        const snippet = text.slice(0, 500);
        return toolErr(`未找到匹配文本`, `文件前 500 字符:\n${snippet}`);
      }

      if (matchCount > 1 && !replaceAll) {
        return toolErr(`找到 ${matchCount} 处匹配，请设置 replaceAll: true 或提供更精确的文本`);
      }

      const newLines = newStr.split("\n");
      const resultLines = [...lines];
      const toReplace = replaceAll ? matches : [matches[0]!];
      for (let m = toReplace.length - 1; m >= 0; m--) {
        resultLines.splice(toReplace[m]!, oldLines.length, ...newLines);
      }

      const after = resultLines.join("\n");
      await Bun.write(fullPath, after);
      return toolOk({ matchCount: toReplace.length, before, after, path });
    }

    if (matchCount > 1 && !replaceAll) {
      return toolErr(`找到 ${matchCount} 处匹配，请设置 replaceAll: true 或提供更精确的文本`);
    }

    let after: string;
    if (replaceAll) {
      after = text.split(oldStr).join(newStr);
    } else {
      const firstIdx = text.indexOf(oldStr);
      after = text.slice(0, firstIdx) + newStr + text.slice(firstIdx + oldStr.length);
    }

    await Bun.write(fullPath, after);
    return toolOk({ matchCount: replaceAll ? matchCount : 1, before, after, path });
  } catch (err: any) {
    return toolErr(`编辑文件失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 创建或覆盖文件，自动创建父目录
 *
 * 返回值附带 before/after 完整文本以支持前端 diff 渲染：
 * - 文件原本不存在：before 为空串、after 为新内容（前端渲染为"全文绿色 (new file)"）
 * - 文件已存在：before 为旧内容、after 为新内容（前端渲染绿+/红- diff）
 */
async function writeFileImpl(
  ctx: { rootDir?: string },
  { path, content }: { path: string; content: string },
): Promise<ToolResult<{ bytesWritten: number; before: string; after: string; path: string }>> {
  const fullPath = resolvePath(ctx.rootDir ?? "", path);

  try {
    /** 写盘前快照：文件不存在视为空串（用于 diff 的 before） */
    let before = "";
    try {
      const existing = Bun.file(fullPath);
      if (await existing.exists()) {
        before = await existing.text();
      }
    } catch {
      // 读旧内容失败不影响写入；before 留空串
    }

    const dir = fullPath.slice(0, fullPath.lastIndexOf("/"));
    if (dir) {
      const { mkdir } = await import("fs/promises");
      await mkdir(dir, { recursive: true });
    }

    const bytesWritten = await Bun.write(fullPath, content);
    return toolOk({ bytesWritten, before, after: content, path });
  } catch (err: any) {
    return toolErr(`写入文件失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 列出目录内容
 */
async function listDirImpl(
  ctx: { rootDir?: string },
  {
    path,
    recursive = false,
    includeHidden = false,
    limit = 100,
  }: { path: string; recursive?: boolean; includeHidden?: boolean; limit?: number },
): Promise<ToolResult<{ entries: Array<{ name: string; type: string; size: number }> }>> {
  const fullPath = resolvePath(ctx.rootDir ?? "", path);

  try {
    const { readdir, stat } = await import("fs/promises");
    const raw = await readdir(fullPath, { recursive });
    const entries: Array<{ name: string; type: string; size: number }> = [];

    for (const entry of raw) {
      if (entries.length >= limit) break;

      const name = String(entry);
      const baseName = name.split("/").pop() ?? name;
      if (!includeHidden && baseName.startsWith(".")) continue;

      try {
        const entryPath = resolve(fullPath, name);
        const st = await stat(entryPath);
        entries.push({
          name,
          type: st.isDirectory() ? "directory" : "file",
          size: st.size,
        });
      } catch {
        // 跳过无法 stat 的条目
      }
    }

    return toolOk({ entries });
  } catch (err: any) {
    return toolErr(`列出目录失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 检查文件或目录是否存在
 */
async function fileExistsImpl(
  ctx: { rootDir?: string },
  { path }: { path: string },
): Promise<boolean> {
  const fullPath = resolvePath(ctx.rootDir ?? "", path);
  try {
    const file = Bun.file(fullPath);
    return await file.exists();
  } catch {
    return false;
  }
}

/**
 * 删除文件或目录
 */
async function deleteFileImpl(
  ctx: { rootDir?: string },
  { path, recursive = false }: { path: string; recursive?: boolean },
): Promise<ToolResult<{ success: boolean }>> {
  const fullPath = resolvePath(ctx.rootDir ?? "", path);

  try {
    const { rm } = await import("fs/promises");
    await rm(fullPath, { recursive, force: false });
    return toolOk({ success: true });
  } catch (err: any) {
    return toolErr(`删除失败: ${err?.message ?? String(err)}`);
  }
}

/* ========== 多文件 Transaction（Edit Plan） ========== */

/** 从 ctx 推断 flowsRoot：默认 `${rootDir}/flows`；若已有 ctx.flowsRoot 则优先 */
function inferFlowsRoot(ctx: any): string | undefined {
  if (ctx?.flowsRoot && typeof ctx.flowsRoot === "string") return ctx.flowsRoot;
  if (ctx?.rootDir) return join(ctx.rootDir, "flows");
  return undefined;
}

/**
 * 创建 edit plan（不真写，返回 plan_id + preview）
 */
async function planEditsImpl(
  ctx: { rootDir?: string; sessionId?: string } & any,
  { changes }: { changes: EditChange[] },
): Promise<ToolResult<{ planId: string; changesCount: number; preview: string }>> {
  const rootDir = ctx.rootDir ?? "";
  if (!rootDir) return toolErr("rootDir 未设置");
  try {
    const plan = await createEditPlan({
      rootDir,
      changes,
      sessionId: ctx.sessionId,
      flowsRoot: inferFlowsRoot(ctx),
    });
    const preview = await previewEditPlan(plan);
    return toolOk({ planId: plan.planId, changesCount: plan.changes.length, preview });
  } catch (err: any) {
    return toolErr(`plan_edits 失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 预览 edit plan 的 unified diff
 */
async function previewEditPlanImpl(
  ctx: { rootDir?: string; sessionId?: string } & any,
  { planId }: { planId: string },
): Promise<ToolResult<{ plan: EditPlan; preview: string }>> {
  try {
    const plan = await readEditPlan(planId, {
      sessionId: ctx.sessionId,
      flowsRoot: inferFlowsRoot(ctx),
    });
    if (!plan) return toolErr(`plan 不存在: ${planId}`);
    const preview = await previewEditPlan(plan);
    return toolOk({ plan, preview });
  } catch (err: any) {
    return toolErr(`preview_edit_plan 失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 原子应用 edit plan；任一失败全部回滚
 */
async function applyEditsImpl(
  ctx: { rootDir?: string; sessionId?: string; threadId?: string } & any,
  { planId }: { planId: string },
): Promise<ToolResult<ApplyResult>> {
  try {
    const plan = await readEditPlan(planId, {
      sessionId: ctx.sessionId,
      flowsRoot: inferFlowsRoot(ctx),
    });
    if (!plan) return toolErr(`plan 不存在: ${planId}`);
    const result = await applyEditPlan(plan, {
      sessionId: ctx.sessionId,
      flowsRoot: inferFlowsRoot(ctx),
      /* 把 threadId 传进去 —— applyEditPlan 在多文件写入成功后会对每个 changedPath
       * 依次跑 runBuildHooks，feedback 按此 threadId 落到 feedbackByThread。 */
      threadId: ctx.threadId,
    });
    if (!result.ok) return toolErr(result.error ?? "apply 失败", JSON.stringify(result.perChange, null, 2));
    return toolOk(result);
  } catch (err: any) {
    return toolErr(`apply_edits 失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 取消 edit plan
 */
async function cancelEditsImpl(
  ctx: { rootDir?: string; sessionId?: string } & any,
  { planId }: { planId: string },
): Promise<ToolResult<{ status: string }>> {
  try {
    const plan = await readEditPlan(planId, {
      sessionId: ctx.sessionId,
      flowsRoot: inferFlowsRoot(ctx),
    });
    if (!plan) return toolErr(`plan 不存在: ${planId}`);
    const cancelled = await cancelEditPlan(plan, {
      sessionId: ctx.sessionId,
      flowsRoot: inferFlowsRoot(ctx),
    });
    return toolOk({ status: cancelled.status });
  } catch (err: any) {
    return toolErr(`cancel_edits 失败: ${err?.message ?? String(err)}`);
  }
}

/* ========== 兼容导出（位置参数）：单元测试和内部直接调用用 ========== */

export const readFile = (ctx: any, path: string, options?: { offset?: number; limit?: number }) =>
  readFileImpl(ctx, { path, offset: options?.offset, limit: options?.limit });

export const editFile = (
  ctx: any,
  path: string,
  oldStr: string,
  newStr: string,
  options?: { replaceAll?: boolean },
) => editFileImpl(ctx, { path, oldStr, newStr, replaceAll: options?.replaceAll });

export const writeFile = (ctx: any, path: string, content: string) =>
  writeFileImpl(ctx, { path, content });

export const listDir = (
  ctx: any,
  path: string,
  options?: { recursive?: boolean; includeHidden?: boolean; limit?: number },
) =>
  listDirImpl(ctx, {
    path,
    recursive: options?.recursive,
    includeHidden: options?.includeHidden,
    limit: options?.limit,
  });

export const fileExists = (ctx: any, path: string) => fileExistsImpl(ctx, { path });

export const deleteFile = (ctx: any, path: string, options?: { recursive?: boolean }) =>
  deleteFileImpl(ctx, { path, recursive: options?.recursive });

/** 位置参数形式：创建 edit plan */
export const planEdits = (ctx: any, changes: EditChange[]) => planEditsImpl(ctx, { changes });

/** 位置参数形式：预览 */
export const previewEditPlanMethod = (ctx: any, planId: string) =>
  previewEditPlanImpl(ctx, { planId });

/** 位置参数形式：应用 */
export const applyEdits = (ctx: any, planId: string) => applyEditsImpl(ctx, { planId });

/** 位置参数形式：取消 */
export const cancelEdits = (ctx: any, planId: string) => cancelEditsImpl(ctx, { planId });

/* ========== Phase 2 新协议：llm_methods 对象导出（供沙箱 callMethod 使用） ========== */

export const llm_methods: Record<string, TraitMethod> = {
  readFile: {
    name: "readFile",
    description: "读取文件内容，返回带行号的文本",
    params: [
      { name: "path", type: "string", description: "文件路径（相对或绝对）", required: true },
      { name: "offset", type: "number", description: "起始行号（从 0 开始）", required: false },
      { name: "limit", type: "number", description: "最多读取行数（默认 200）", required: false },
    ],
    fn: readFileImpl as TraitMethod["fn"],
  },
  editFile: {
    name: "editFile",
    description: "在文件中搜索并替换文本（两级容错：精确/trim 空白）",
    params: [
      { name: "path", type: "string", description: "文件路径", required: true },
      { name: "oldStr", type: "string", description: "要查找的原文本", required: true },
      { name: "newStr", type: "string", description: "替换后的文本", required: true },
      { name: "replaceAll", type: "boolean", description: "是否替换所有匹配（默认 false）", required: false },
    ],
    fn: editFileImpl as TraitMethod["fn"],
  },
  writeFile: {
    name: "writeFile",
    description: "创建或覆盖文件，自动创建父目录",
    params: [
      { name: "path", type: "string", description: "文件路径", required: true },
      { name: "content", type: "string", description: "文件内容", required: true },
    ],
    fn: writeFileImpl as TraitMethod["fn"],
  },
  listDir: {
    name: "listDir",
    description: "列出目录内容",
    params: [
      { name: "path", type: "string", description: "目录路径", required: true },
      { name: "recursive", type: "boolean", description: "是否递归（默认 false）", required: false },
      { name: "includeHidden", type: "boolean", description: "是否包含隐藏文件（默认 false）", required: false },
      { name: "limit", type: "number", description: "最大返回数（默认 100）", required: false },
    ],
    fn: listDirImpl as TraitMethod["fn"],
  },
  fileExists: {
    name: "fileExists",
    description: "检查文件或目录是否存在",
    params: [{ name: "path", type: "string", description: "路径", required: true }],
    fn: fileExistsImpl as TraitMethod["fn"],
  },
  deleteFile: {
    name: "deleteFile",
    description: "删除文件或目录",
    params: [
      { name: "path", type: "string", description: "路径", required: true },
      { name: "recursive", type: "boolean", description: "递归删除目录（默认 false）", required: false },
    ],
    fn: deleteFileImpl as TraitMethod["fn"],
  },
  plan_edits: {
    name: "plan_edits",
    description: "创建多文件编辑计划（不真写），返回 planId + unified diff 预览",
    params: [
      {
        name: "changes",
        type: "array",
        description:
          '变更列表。每项：{ kind: "edit"|"write", path, oldText?, newText?, replaceAll?, newContent? }',
        required: true,
      },
    ],
    fn: planEditsImpl as TraitMethod["fn"],
  },
  preview_edit_plan: {
    name: "preview_edit_plan",
    description: "预览 edit plan 的 unified diff",
    params: [{ name: "planId", type: "string", description: "plan id", required: true }],
    fn: previewEditPlanImpl as TraitMethod["fn"],
  },
  apply_edits: {
    name: "apply_edits",
    description: "原子应用 edit plan；任一失败全部回滚",
    params: [{ name: "planId", type: "string", description: "plan id", required: true }],
    fn: applyEditsImpl as TraitMethod["fn"],
  },
  cancel_edits: {
    name: "cancel_edits",
    description: "取消 edit plan（仅 pending 状态）",
    params: [{ name: "planId", type: "string", description: "plan id", required: true }],
    fn: cancelEditsImpl as TraitMethod["fn"],
  },
};

/** 此 trait 不对 UI 暴露方法 */
export const ui_methods: Record<string, TraitMethod> = {};

/**
 * file_ops —— 文件操作 kernel trait
 *
 * 提供文件读写、编辑、目录操作能力，任何对象激活即可用。
 * 所有路径支持相对路径（相对于 ctx.rootDir）和绝对路径。
 */

import { resolve } from "path";
import { toolOk, toolErr } from "../../../src/types/tool-result";
import type { ToolResult } from "../../../src/types/tool-result";

/** 路径解析：绝对路径直接用，相对路径基于 rootDir */
const resolvePath = (rootDir: string, p: string) =>
  p.startsWith("/") ? p : resolve(rootDir, p);

/**
 * 读取文件内容，返回带行号的文本
 * @param ctx - 上下文（需要 ctx.rootDir）
 * @param path - 文件路径
 * @param options - 可选参数：offset（起始行，默认 0）、limit（最大行数，默认 200）
 */
export async function readFile(
  ctx: any,
  path: string,
  options?: { offset?: number; limit?: number },
): Promise<ToolResult<{ content: string; totalLines: number; truncated: boolean }>> {
  const fullPath = resolvePath(ctx.rootDir ?? "", path);
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 200;

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
 * 在文件中搜索并替换文本
 * 两级容错：先精确匹配，再尝试 trim 空白匹配
 * @param ctx - 上下文
 * @param path - 文件路径
 * @param oldStr - 要查找的原始文本
 * @param newStr - 替换后的文本
 * @param options - 可选参数：replaceAll（是否替换所有匹配，默认 false）
 */
export async function editFile(
  ctx: any,
  path: string,
  oldStr: string,
  newStr: string,
  options?: { replaceAll?: boolean },
): Promise<ToolResult<{ matchCount: number }>> {
  const fullPath = resolvePath(ctx.rootDir ?? "", path);
  const replaceAll = options?.replaceAll ?? false;

  try {
    const file = Bun.file(fullPath);
    const exists = await file.exists();
    if (!exists) {
      return toolErr(`文件不存在: ${path}`);
    }

    const text = await file.text();

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

      // 逐行滑动窗口匹配
      const oldLines = trimmedOld.split("\n");
      const matches: number[] = []; // 记录匹配起始行号

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
        // 返回上下文片段帮助 LLM 修正
        const snippet = text.slice(0, 500);
        return toolErr(
          `未找到匹配文本`,
          `文件前 500 字符:\n${snippet}`,
        );
      }

      if (matchCount > 1 && !replaceAll) {
        return toolErr(
          `找到 ${matchCount} 处匹配，请设置 replaceAll: true 或提供更精确的文本`,
        );
      }

      // 执行 fuzzy 替换
      const newLines = newStr.split("\n");
      const resultLines = [...lines];
      // 从后往前替换，避免索引偏移
      const toReplace = replaceAll ? matches : [matches[0]!];
      for (let m = toReplace.length - 1; m >= 0; m--) {
        resultLines.splice(toReplace[m]!, oldLines.length, ...newLines);
      }

      await Bun.write(fullPath, resultLines.join("\n"));
      return toolOk({ matchCount: toReplace.length });
    }

    // 精确匹配的情况
    if (matchCount > 1 && !replaceAll) {
      return toolErr(
        `找到 ${matchCount} 处匹配，请设置 replaceAll: true 或提供更精确的文本`,
      );
    }

    let result: string;
    if (replaceAll) {
      result = text.split(oldStr).join(newStr);
    } else {
      // 只替换第一处
      const firstIdx = text.indexOf(oldStr);
      result =
        text.slice(0, firstIdx) +
        newStr +
        text.slice(firstIdx + oldStr.length);
    }

    await Bun.write(fullPath, result);
    return toolOk({ matchCount: replaceAll ? matchCount : 1 });
  } catch (err: any) {
    return toolErr(`编辑文件失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 创建或覆盖文件，自动创建父目录
 * @param ctx - 上下文
 * @param path - 文件路径
 * @param content - 文件内容
 */
export async function writeFile(
  ctx: any,
  path: string,
  content: string,
): Promise<ToolResult<{ bytesWritten: number }>> {
  const fullPath = resolvePath(ctx.rootDir ?? "", path);

  try {
    // 自动创建父目录
    const dir = fullPath.slice(0, fullPath.lastIndexOf("/"));
    if (dir) {
      const { mkdir } = await import("fs/promises");
      await mkdir(dir, { recursive: true });
    }

    const bytesWritten = await Bun.write(fullPath, content);
    return toolOk({ bytesWritten });
  } catch (err: any) {
    return toolErr(`写入文件失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 列出目录内容
 * @param ctx - 上下文
 * @param path - 目录路径
 * @param options - 可选参数：recursive、includeHidden、limit（默认 100）
 */
export async function listDir(
  ctx: any,
  path: string,
  options?: { recursive?: boolean; includeHidden?: boolean; limit?: number },
): Promise<ToolResult<{ entries: Array<{ name: string; type: string; size: number }> }>> {
  const fullPath = resolvePath(ctx.rootDir ?? "", path);
  const recursive = options?.recursive ?? false;
  const includeHidden = options?.includeHidden ?? false;
  const limit = options?.limit ?? 100;

  try {
    const { readdir, stat } = await import("fs/promises");
    const raw = await readdir(fullPath, { recursive });
    const entries: Array<{ name: string; type: string; size: number }> = [];

    for (const entry of raw) {
      if (entries.length >= limit) break;

      const name = String(entry);
      // 过滤隐藏文件
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
        // 跳过无法 stat 的条目（如断开的符号链接）
      }
    }

    return toolOk({ entries });
  } catch (err: any) {
    return toolErr(`列出目录失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 检查文件或目录是否存在
 * @param ctx - 上下文
 * @param path - 文件/目录路径
 * @returns 布尔值（不是 ToolResult）
 */
export async function fileExists(ctx: any, path: string): Promise<boolean> {
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
 * @param ctx - 上下文
 * @param path - 文件/目录路径
 * @param options - 可选参数：recursive（是否递归删除目录，默认 false）
 */
export async function deleteFile(
  ctx: any,
  path: string,
  options?: { recursive?: boolean },
): Promise<ToolResult<{ success: boolean }>> {
  const fullPath = resolvePath(ctx.rootDir ?? "", path);
  const recursive = options?.recursive ?? false;

  try {
    const { rm } = await import("fs/promises");
    await rm(fullPath, { recursive, force: false });
    return toolOk({ success: true });
  } catch (err: any) {
    return toolErr(`删除失败: ${err?.message ?? String(err)}`);
  }
}

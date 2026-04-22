/**
 * reflective/super —— 对象反思镜像分身的沉淀工具集（kernel trait）
 *
 * SuperFlow 转型后（2026-04-22），本 trait 仅提供 **沉淀工具方法体**：
 * - `persist_to_memory({ key, content })` — append 到 `stones/{name}/memory.md`
 * - `create_trait({ relativePath, content })` — 在 `stones/{name}/traits/**` 下新建 TRAIT.md
 *
 * 投递通道已从 `callMethod("reflective/reflect_flow", "talkToSelf", ...)`
 * 改为通用的 `talk(target="super", message)`——本 trait 不再暴露 talkToSelf。
 *
 * 落盘路径：`stones/{name}/super/threads.json + threads/{id}/thread.json`
 * 线程生命周期独立于任何 session——每个对象只有一个 super 分身。
 *
 * 权限隔离：本 trait `when: never`，只有 super 对象（显式激活者）才能调用
 * `persist_to_memory` / `create_trait`——普通对象无法越权。
 *
 * @ref docs/哲学文档/gene.md#G12 — implements — 经验沉淀循环的工程通道
 * @ref kernel/src/world/super.ts — references — talk(super) 落盘 API
 * @ref docs/工程管理/迭代/all/20260422_refactor_SuperFlow转型.md — references — SuperFlow 转型迭代
 */

import type { TraitMethod } from "../../../src/types/index";
import { toolOk, toolErr } from "../../../src/types/tool-result";
import type { ToolResult } from "../../../src/types/tool-result";

/**
 * 行号前缀 sanity check —— 剥离 `file_ops.readFile` 等工具输出中常见的
 * `NN | xxx` 行号前缀格式，防止 memory.md / TRAIT.md 被污染（bugfix 2026-04-22）
 *
 * 触发条件（全部满足才剥离）：
 * 1. 文本按行拆分后有 **至少 2 行**
 * 2. 所有**非空行**都以 `^\s*\d+\s*\|` 开头（连续的行号伪装，纯文本不满足）
 *
 * 剥离方式：
 * - 逐行去掉 `^\s*\d+\s*\|\s?` 前缀（保留原本的正文内容，包括末尾空格）
 * - 空行保持为空行
 *
 * 不误伤：
 * - markdown 表格行（如 `| 1 | xxx |`）——表格行以 `|` 开头，非数字开头，不匹配
 * - 混合文本（部分行带前缀、部分不带）——必须所有非空行都满足才剥离
 * - 单行纯文本（如 "hello"）——没有行号前缀，不满足条件
 *
 * 同时用于 key 校验：若 key 本身就像 `"  1 | 标题"`，同样剥离。
 */
export function stripLineNumberPrefix(text: string): string {
  if (!text) return text;

  const linePrefixRe = /^\s*\d+\s*\|/;
  const lines = text.split("\n");

  /* 非空行必须全部匹配前缀；至少要有一行非空匹配才算"整段被污染" */
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return text;
  const allPolluted = nonEmpty.every(l => linePrefixRe.test(l));
  if (!allPolluted) return text;

  /* 逐行剥离前缀 `^\s*\d+\s*\|\s?`（最多吃掉一个 pipe 后的空格，保留正文空白） */
  const stripRe = /^\s*\d+\s*\|\s?/;
  return lines.map(l => l.replace(stripRe, "")).join("\n");
}

/**
 * 把一条经验条目 append 到对象的 `stones/{name}/memory.md`（SuperFlow 沉淀工具）
 *
 * 格式规范：
 *   ## {key}（{YYYY-MM-DD HH:MM}）
 *
 *   {content}
 *
 * 幂等说明：**不去重**——同一 key 多次写入会产生多条记录（经验可能随时间演进，
 * LLM 自己决定是否要把旧条目也留着）。
 *
 * 约束：
 * - key 非空字符串
 * - content 非空字符串
 * - memory.md 最终内容是 append-only（不支持删除/修改历史条目）
 */
async function persistToMemoryImpl(
  ctx: { selfDir: string; stoneName: string },
  { key, content }: { key: string; content: string },
): Promise<ToolResult<{ stoneName: string; memoryPath: string; keyPreview: string }>> {
  if (typeof key !== "string" || key.trim().length === 0) {
    return toolErr("persist_to_memory: key 必须是非空字符串");
  }
  if (typeof content !== "string" || content.trim().length === 0) {
    return toolErr("persist_to_memory: content 必须是非空字符串");
  }

  /* Sanity check —— 防御 readFile 带行号格式污染 memory.md（bugfix 2026-04-22）
     若 LLM 把 `callMethod("computable/file_ops", "readFile", ...)` 返回的 content
     直接传进来（形如 "  1 | xxx\n  2 | yyy"），这里剥离前缀再落盘。 */
  const cleanKey = stripLineNumberPrefix(key).trim();
  const cleanContent = stripLineNumberPrefix(content).trim();
  if (cleanKey.length === 0) {
    return toolErr(
      "persist_to_memory: key 剥离行号前缀后为空（请传 raw 文本，不要 wrap 为 `NN | xxx` 格式）",
    );
  }
  if (cleanContent.length === 0) {
    return toolErr(
      "persist_to_memory: content 剥离行号前缀后为空（请传 raw 文本，不要 wrap 为 `NN | xxx` 格式）",
    );
  }
  key = cleanKey;
  content = cleanContent;

  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const memoryPath = path.join(ctx.selfDir, "memory.md");

    /* 读现有（不存在视为空），按规范 append */
    let prev = "";
    try {
      prev = await fs.readFile(memoryPath, "utf-8");
    } catch {
      /* 不存在 → 空 */
    }

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const entry = `\n## ${key.trim()}（${stamp}）\n\n${content.trim()}\n`;
    const next = prev.endsWith("\n") || prev.length === 0 ? `${prev}${entry}` : `${prev}\n${entry}`;

    /* 确保目录存在 */
    await fs.mkdir(ctx.selfDir, { recursive: true });
    await fs.writeFile(memoryPath, next, "utf-8");

    return toolOk({
      stoneName: ctx.stoneName,
      memoryPath,
      keyPreview: key.length > 40 ? `${key.slice(0, 40)}…` : key,
    });
  } catch (err: any) {
    return toolErr(`persist_to_memory 失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 在对象 self 目录下 `traits/` 创建新的 trait（方案 B Phase 2 沉淀工具）
 *
 * 安全校验（必须全部通过）：
 * - relativePath 非空字符串
 * - 规范化后不得含 `..`、不得是绝对路径
 * - 只允许落在 `{selfDir}/traits/` 子树内
 * - 目标 TRAIT.md 不得已存在（防止意外覆盖已沉淀 trait）
 *
 * 成功后写入 `{selfDir}/traits/{relativePath}/TRAIT.md`。
 */
async function createTraitImpl(
  ctx: { selfDir: string; stoneName: string },
  { relativePath, content }: { relativePath: string; content: string },
): Promise<ToolResult<{ stoneName: string; traitPath: string }>> {
  if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
    return toolErr("create_trait: relativePath 必须是非空字符串");
  }
  if (typeof content !== "string" || content.trim().length === 0) {
    return toolErr("create_trait: content 必须是非空字符串");
  }

  /* Sanity check —— 同 persist_to_memory，防御带行号前缀的污染（bugfix 2026-04-22） */
  const cleanContent = stripLineNumberPrefix(content);
  if (cleanContent.trim().length === 0) {
    return toolErr(
      "create_trait: content 剥离行号前缀后为空（请传 raw TRAIT.md 内容，不要 wrap 为 `NN | xxx` 格式）",
    );
  }
  content = cleanContent;

  /* 安全检查 */
  const trimmed = relativePath.trim();
  if (trimmed.startsWith("/") || trimmed.match(/^[A-Za-z]:[\\/]/)) {
    return toolErr(`create_trait: relativePath 不允许是绝对路径: ${trimmed}`);
  }
  if (trimmed.split(/[\\/]/).some(seg => seg === "..")) {
    return toolErr(`create_trait: relativePath 不允许含 '..'（越权）: ${trimmed}`);
  }

  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const traitsRoot = path.resolve(ctx.selfDir, "traits");
    const targetDir = path.resolve(traitsRoot, trimmed);

    /* 二次兜底：规范化后必须仍在 traitsRoot 内 */
    if (!targetDir.startsWith(traitsRoot + path.sep) && targetDir !== traitsRoot) {
      return toolErr(`create_trait: 路径越权，不在 stones/{self}/traits/ 子树内`);
    }

    const traitMdPath = path.join(targetDir, "TRAIT.md");

    /* 已存在 → 拒绝（反思工具是 append-only，不覆盖） */
    try {
      await fs.access(traitMdPath);
      return toolErr(`create_trait: ${trimmed}/TRAIT.md 已存在（本工具不覆盖已有 trait）`);
    } catch {
      /* 不存在——正常路径 */
    }

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(traitMdPath, content, "utf-8");

    return toolOk({
      stoneName: ctx.stoneName,
      traitPath: traitMdPath,
    });
  } catch (err: any) {
    return toolErr(`create_trait 失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * llm 通道方法（SuperFlow 沉淀工具集）：
 * 仅由 super 线程消费（普通对象因 when: never 不会激活本 trait）。
 * 投递通道见通用 `talk(target="super", message)`——本 trait 不再暴露 talkToSelf。
 */
export const llm_methods: Record<string, TraitMethod> = {
  persist_to_memory: {
    name: "persist_to_memory",
    description:
      "把一条沉淀下来的经验/规律追加到当前对象的 memory.md（长期记忆，每次 Context 会被注入）。key 是短标题，content 是完整描述。",
    params: [
      { name: "key", type: "string", description: "经验的短标题（如 \"调试 API 的正确姿势\"）", required: true },
      { name: "content", type: "string", description: "经验的完整描述（含具体场景、做法、反例等）", required: true },
    ],
    fn: persistToMemoryImpl as TraitMethod["fn"],
  },
  create_trait: {
    name: "create_trait",
    description:
      "在当前对象的 stones/{self}/traits/** 下创建一个新的 trait（TRAIT.md）。适合把沉淀出的「做法」固化为对象能力。路径必须相对 stones/{self}/traits/，不允许 ..、绝对路径、已存在的 trait。",
    params: [
      { name: "relativePath", type: "string", description: "相对 stones/{self}/traits/ 的路径（如 \"learned/debug_api\"）", required: true },
      { name: "content", type: "string", description: "TRAIT.md 完整内容（含 frontmatter + markdown 正文）", required: true },
    ],
    fn: createTraitImpl as TraitMethod["fn"],
  },
};

/** 此 trait 暂不对 UI 暴露方法 */
export const ui_methods: Record<string, TraitMethod> = {};

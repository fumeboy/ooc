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
 * 把消息投递到当前对象的常驻反思线程
 *
 * 典型用法：当对象在任务过程中意识到"刚才那个 X 做法值得记下来"时调用本方法，
 * 反思线程会在未来（接入调度器后）消费这条消息，判断是否沉淀到 memory.md 或 trait。
 *
 * 方案 A 当前返回后消息只是落入反思线程 inbox（不触发执行）。
 */
async function talkToSelfImpl(
  ctx: { selfDir: string; stoneName: string },
  { message }: { message: string },
): Promise<ToolResult<{ stoneName: string; messagePreview: string }>> {
  if (typeof message !== "string" || message.trim().length === 0) {
    return toolErr("talkToSelf: message 必须是非空字符串");
  }

  try {
    const { talkToReflect } = await import("../../../src/thread/reflect");
    await talkToReflect(ctx.selfDir, ctx.stoneName, message);
    const preview = message.length > 80 ? `${message.slice(0, 80)}…` : message;
    return toolOk({ stoneName: ctx.stoneName, messagePreview: preview });
  } catch (err: any) {
    return toolErr(`talkToSelf 失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 查看反思线程当前 inbox 状态
 *
 * 用于 LLM 自检"我累计向反思线程投递了多少条经验？"。
 */
async function getReflectStateImpl(
  ctx: { selfDir: string; stoneName: string },
  _args: Record<string, never>,
): Promise<
  ToolResult<{
    stoneName: string;
    initialized: boolean;
    inboxTotal: number;
    inboxUnread: number;
    recentContents: string[];
  }>
> {
  try {
    const { getReflectThreadDir } = await import("../../../src/thread/reflect");
    const { ThreadsTree } = await import("../../../src/thread/tree");

    const dir = getReflectThreadDir(ctx.selfDir);
    const tree = ThreadsTree.load(dir);
    if (!tree) {
      return toolOk({
        stoneName: ctx.stoneName,
        initialized: false,
        inboxTotal: 0,
        inboxUnread: 0,
        recentContents: [],
      });
    }
    const data = tree.readThreadData(tree.rootId);
    const inbox = data?.inbox ?? [];
    const recent = inbox
      .slice(-5)
      .map((m) => (m.content.length > 120 ? `${m.content.slice(0, 120)}…` : m.content));
    return toolOk({
      stoneName: ctx.stoneName,
      initialized: true,
      inboxTotal: inbox.length,
      inboxUnread: inbox.filter((m) => m.status === "unread").length,
      recentContents: recent,
    });
  } catch (err: any) {
    return toolErr(`getReflectState 失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * 把一条经验条目 append 到对象的 `stones/{name}/memory.md`（方案 B Phase 2 沉淀工具）
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
 * llm 通道方法：LLM 沙箱里通过 `callMethod("reflective/reflect_flow", "talkToSelf", { message })` 调用
 */
export const llm_methods: Record<string, TraitMethod> = {
  talkToSelf: {
    name: "talkToSelf",
    description:
      "把一段值得反思的经验投递到对象的常驻反思线程 inbox。调用后消息落盘在 stones/{name}/reflect/，由反思线程后续消费用于沉淀。",
    params: [
      { name: "message", type: "string", description: "要反思的内容（完整的经验描述）", required: true },
    ],
    fn: talkToSelfImpl as TraitMethod["fn"],
  },
  getReflectState: {
    name: "getReflectState",
    description: "查看当前对象反思线程的 inbox 状态（是否初始化、消息数、最近 5 条预览）。",
    params: [],
    fn: getReflectStateImpl as TraitMethod["fn"],
  },
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

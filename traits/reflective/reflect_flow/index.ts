/**
 * reflect_flow —— 常驻反思线程能力（kernel trait）
 *
 * 方案 A 最小可用：提供 `talkToSelf` / `getReflectState` 两个 llm_methods。
 * - talkToSelf：把一段"值得反思的经验"投递到对象的常驻反思线程 inbox
 * - getReflectState：查看反思线程当前 inbox 状态（未读/已标记计数 + 最近几条内容）
 *
 * 落盘位置：`stones/{name}/reflect/threads.json + threads/{id}/thread.json`
 * 线程生命周期独立于任何 session——对象每次新 session 都共享同一条反思线程。
 *
 * **方案 A 限制**：投递仅落盘到 inbox，反思线程暂不触发 ThinkLoop 执行。
 * 等待后续迭代接入跨 session 常驻调度器，反思线程才会真正消费消息并做沉淀。
 *
 * @ref docs/哲学文档/gene.md#G12 — implements — 经验沉淀循环的工程通道
 * @ref kernel/src/thread/reflect.ts — references — 底层落盘 API
 * @ref docs/工程管理/迭代/all/20260421_feature_ReflectFlow线程树化.md — references — 迭代文档
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
};

/** 此 trait 暂不对 UI 暴露方法 */
export const ui_methods: Record<string, TraitMethod> = {};

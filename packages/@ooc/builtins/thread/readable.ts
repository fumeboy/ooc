/**
 * thread —— readable 维度（S3.1 最小投影）。
 *
 * thread 窗是 thread 对自身的 self-view：渲染身份（thread id / status / creator）+ 一句导向
 * "这是本次运行，过程跑在 thinkloop 上"。过程数据（context / inbox / events）不在此重复——
 * 它们各自有自己的展示通道；本窗只投影 thread 的"我是谁、跑到哪"。
 * boot 校验要求每个 window class 配齐 readable hook，故本文件必需。
 * 本文件只导出 readable hook；类的单处声明（registerWindowClass）在 executable/index.ts。
 * 完善（events / inbox 摘要等）留待后续子步。
 */
import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { ThreadWindow } from "./types.js";

export function readable(ctx: RenderContext): XmlNode[] {
  const w = ctx.window as ThreadWindow;
  const attrs: Record<string, string> = { thread_id: w.id, status: w.threadStatus };
  if (w.creatorThreadId) attrs.creator_thread_id = w.creatorThreadId;
  return [
    xmlElement("self_view", attrs, [
      xmlText("thread window (self-view) —— 本次运行的载体，过程跑在 thinkloop 上。"),
    ]),
  ];
}

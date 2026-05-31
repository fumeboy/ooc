/**
 * talk_window 类型注册（OOC-4 L5c Phase C：agent-facing behavior 已下线）。
 *
 * agent 不再创建 / 操作 talk_window：
 * - root.talk(target, content, wait?) 经 window-free deliverMessage 派送（talks.json 路由）
 * - 会话历史经 <self_view><talks> 自视切片呈现（render.ts 跳过 talk_window 渲染）
 * - say / wait / close / set_transcript_window 方法已删除
 *
 * 但 TalkWindow 类型 + WindowType "talk" 仍保留（Phase D 才整体擦除）：
 * - service.ts（HTTP user→object chat 入口）仍建 talk_window + deliverTalkMessage
 * - initContextWindows 仍给跨对象 callee 注入 creator talk_window（作为 wait 兜底标记）
 * - deriveRelationWindow（synthesizer.ts）仍按 talk_window 播种 relation（L6a 解耦）
 *
 * 故本模块只保留：
 * - onClose hook（creator talk_window 不可关闭，保护与 caller 的恒在通道）
 * - 把 talk type 的 renderXml 声明为"由原型链提供（实为不渲染）"，让 boot 期
 *   assertAllRenderHooksRegistered 不把 talk 误判为缺 renderXml；render.ts 在
 *   renderContextWindowsNode 阶段已剔除 talk 窗口，永不走到 renderXml 调度。
 */

import {
  registerWindowType,
  markRenderXmlViaPrototype,
  type OnCloseContext,
} from "../_shared/registry.js";

/** talk_window 的 onClose hook：creator talk_window 不可关闭（与 caller 的恒在通道）。 */
function onCloseTalkWindow(ctx: OnCloseContext): boolean | void {
  const w = ctx.window;
  if (w.type !== "talk") return;
  if (w.isCreatorWindow) {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] talk_window "${w.id}" 是初始 creator talk_window，与 caller 的恒在通道，不可关闭。`,
    });
    return false;
  }
  return true;
}

registerWindowType("talk", {
  onClose: onCloseTalkWindow,
});

// talk 不渲染（agent 经自视 talk 切片看会话）。声明为原型链提供，让 boot 校验豁免 talk；
// render.ts 在 renderContextWindowsNode 已剔除 talk 窗口，不会调度到 renderXml。
markRenderXmlViaPrototype("talk");

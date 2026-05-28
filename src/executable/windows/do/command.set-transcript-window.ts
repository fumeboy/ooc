/**
 * do_window.set_transcript_window — transcript 渲染窗口精细化调整。
 *
 * - 默认 viewport = { tail: 20 } —— 仅渲染末 20 条 transcript
 * - 通过 set_transcript_window 切换：
 *     args={ tail: 50 }                     → 末 50 条
 *     args={ range_start: 0, range_end: 30 } → 固定区间 [0, 30)
 * - tail 与 range_* 互斥；同一次调用只传其一
 * - 详见 _shared/transcript-viewport.ts
 */

import type {
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
import {
  executeWindowSetTranscriptViewport,
  hasAnyTranscriptViewportField,
} from "../_shared/transcript-viewport.js";

const DO_SET_TRANSCRIPT_BASIC = "internal/windows/do/set_transcript_window/basic";
const DO_SET_TRANSCRIPT_INPUT = "internal/windows/do/set_transcript_window/input";

const KNOWLEDGE = `
do_window.set_transcript_window 精细化调整 transcript 渲染窗口。

打开 do_window 时默认 transcriptViewport = { tail: 20 } —— 只渲染末 20 条消息；
更早的消息以 \`<transcript_viewport tail=20 total=37/>\` 形式提示前部还有多少条。

参数（**择一传**，二选一）：
- tail: 末 N 条（必须是正整数）
- range_start + range_end: 固定区间 transcript[range_start, range_end)（非负整数；range_start ≤ range_end；必须同时出现）

**tail 与 range_* 互斥**：传 tail 的 args 清空 range；传 range 的 args 清空 tail。

约束（fail-loud）：
- tail 必须是正整数（>= 1）
- range_start / range_end 必须是非负整数
- range_start ≤ range_end
- range_start 与 range_end 必须同时出现

例：
- refine(form, args={ tail: 50 })                       → 看末 50 条
- refine(form, args={ range_start: 0, range_end: 30 })  → 看前 30 条
- refine(form, args={ range_start: 5, range_end: 15 })  → 看中间 10 条

**注意**：viewport 只影响**渲染**给 LLM 的内容；continue / wait / close / move 等命令仍基于完整 transcript。
`.trim();

export const setTranscriptWindowCommandForDo: CommandTableEntry = {
  paths: ["set_transcript_window"],
  match: () => ["set_transcript_window"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = {
      [DO_SET_TRANSCRIPT_BASIC]: KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyTranscriptViewportField(args)) {
      entries[DO_SET_TRANSCRIPT_INPUT] =
        "set_transcript_window 至少需要传入 tail / range_start+range_end 之一。\n" +
        "tail 与 range_* 互斥，请 refine 后 submit。";
    }
    return entries;
  },
  exec: (ctx) => executeWindowSetTranscriptViewport(ctx, ["do"]),
};

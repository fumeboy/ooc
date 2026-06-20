import { describe, expect, it } from "bun:test";
import { clampTranscriptToBudget } from "../transcript-clamp";
import type { LlmInputItem } from "../../llm/types";

function msg(n: number): LlmInputItem {
  return { type: "message", role: "assistant", content: "x".repeat(n) };
}
function call(id: string): LlmInputItem {
  return { type: "function_call", call_id: id, name: "exec", arguments: {} };
}
function out(id: string): LlmInputItem {
  return { type: "function_call_output", call_id: id, name: "exec", output: "r" };
}

describe("clampTranscriptToBudget", () => {
  it("空 transcript / 预算充足 → 不钳制", () => {
    expect(clampTranscriptToBudget([], 100)).toEqual({ kept: [], omittedCount: 0 });
    const items = [msg(40), msg(40), msg(40)];
    expect(clampTranscriptToBudget(items, 1_000_000)).toEqual({ kept: items, omittedCount: 0 });
  });

  it("预算不足 → 保留最近后缀、丢最早", () => {
    const items = [msg(400), msg(400), msg(400), msg(400), msg(400)]; // 每条 ~110 token
    const { kept, omittedCount } = clampTranscriptToBudget(items, 250);
    expect(omittedCount).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(items.length);
    // kept 是原数组的后缀（最近项）。
    expect(kept).toEqual(items.slice(items.length - kept.length));
    expect(kept[kept.length - 1]).toBe(items[items.length - 1]);
  });

  it("floor：预算为 0 也至少保留最近 1 条（不清空）", () => {
    const items = [msg(40), msg(40), msg(40)];
    const { kept, omittedCount } = clampTranscriptToBudget(items, 0);
    expect(kept.length).toBe(1);
    expect(kept[0]).toBe(items[items.length - 1]);
    expect(omittedCount).toBe(2);
  });

  it("tool-pair 安全：孤儿 function_call_output（其 call 在被丢前缀）被剔；成对的保留", () => {
    const items = [
      call("c1"), // idx0 被丢
      msg(2000), // idx1 大、被丢
      out("c1"), // idx2 在后缀但孤儿（c1 的 call 已被丢）→ 应剔
      call("c2"), // idx3 后缀内
      out("c2"), // idx4 后缀内、成对 → 保留
    ];
    const { kept, omittedCount } = clampTranscriptToBudget(items, 200);
    expect(omittedCount).toBe(2); // idx0,idx1 前缀被丢
    // 孤儿 out(c1) 被 sanitize 掉，只剩成对的 call(c2)+out(c2)。
    const outputCallIds = kept
      .filter((i) => i.type === "function_call_output")
      .map((i) => (i as { call_id: string }).call_id);
    const callIds = new Set(
      kept.filter((i) => i.type === "function_call").map((i) => (i as { call_id: string }).call_id),
    );
    expect(outputCallIds).toEqual(["c2"]);
    // 无孤儿：每个 output 的 call_id 都有对应 call。
    for (const cid of outputCallIds) expect(callIds.has(cid)).toBe(true);
  });
});

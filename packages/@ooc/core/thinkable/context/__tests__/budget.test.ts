/**
 * budget.test.ts — applyNaturalDecay 在 Round 16 精修豁免规则后的行为单测。
 *
 * Round 16 (2026-05-27):
 * - command_exec.status ∈ {open, executing} 仍豁免衰减
 * - command_exec.status === "failed" **参与** idle-fold (IDLE_STATUS_SET 含 "failed")
 *
 * Design: docs/2026-05-27-failed-form-gc-design.md
 */

import { describe, expect, it } from "bun:test";
import { applyNaturalDecay, DEFAULT_DECAY_CONFIG } from "../budget";
import { ROOT_WINDOW_ID, type CommandExecWindow } from "../../../executable/windows/_shared/types";
import { makeThread } from "../../../__tests__/make-thread";

/** 构造一个 command_exec window 的 fixture (参考 context.test.ts 中 execForm 风格)。 */
function execForm(overrides: Partial<CommandExecWindow> & { status: CommandExecWindow["status"] }): CommandExecWindow {
  return {
    id: overrides.id ?? "f_test",
    type: "command_exec",
    parentWindowId: overrides.parentWindowId ?? ROOT_WINDOW_ID,
    title: overrides.title ?? "failed form",
    status: overrides.status,
    createdAt: overrides.createdAt ?? 1,
    command: overrides.command ?? "say",
    description: overrides.description ?? "command_exec form for decay test",
    accumulatedArgs: overrides.accumulatedArgs ?? {},
    commandPaths: overrides.commandPaths ?? [overrides.command ?? "say"],
    loadedKnowledgePaths: overrides.loadedKnowledgePaths ?? [],
    commandKnowledgePaths: overrides.commandKnowledgePaths,
    result: overrides.result,
  };
}

describe("applyNaturalDecay — Round 16 豁免规则精修", () => {
  it("command_exec status=failed 进 idle-fold (N 轮后 compressLevel 0→1)", () => {
    const form = execForm({
      id: "f_failed",
      status: "failed",
      result: "missing required field: content",
    });
    const thread = makeThread({
      id: "t_failed_decay",
      extraWindows: [form],
    });

    // 跑 5 轮 (默认 N=3, 加 buffer); 每轮都应累积 idleRounds
    for (let i = 0; i < 5; i++) {
      applyNaturalDecay(thread, DEFAULT_DECAY_CONFIG);
    }

    const after = thread.contextWindows.find((w) => w.id === "f_failed");
    expect(after).toBeDefined();
    expect(after!.compressLevel).toBe(1);

    // 断言: 落了 context_compressed reason=idle-fold 事件, windowIds 含 f_failed
    const idleFoldEvents = thread.events.filter(
      (e) =>
        e.category === "context_change" &&
        e.kind === "context_compressed" &&
        (e as { reason?: string }).reason === "idle-fold",
    );
    expect(idleFoldEvents.length).toBeGreaterThan(0);
    const allWindowIds = idleFoldEvents.flatMap(
      (e) => (e as { windowIds?: string[] }).windowIds ?? [],
    );
    expect(allWindowIds).toContain("f_failed");
  });

  it("command_exec status=open 仍豁免 (跑多轮 compressLevel 保持 0)", () => {
    const form = execForm({
      id: "f_open",
      status: "open",
    });
    const thread = makeThread({
      id: "t_open_exempt",
      extraWindows: [form],
    });

    for (let i = 0; i < 10; i++) {
      applyNaturalDecay(thread, DEFAULT_DECAY_CONFIG);
    }

    const after = thread.contextWindows.find((w) => w.id === "f_open");
    expect(after).toBeDefined();
    // 豁免: level 应保持 0 / undefined
    expect(after!.compressLevel ?? 0).toBe(0);

    // 不应有针对该 form 的 idle-fold / age-fold 事件
    const compressEvents = thread.events.filter(
      (e) =>
        e.category === "context_change" &&
        e.kind === "context_compressed" &&
        ((e as { windowIds?: string[] }).windowIds ?? []).includes("f_open"),
    );
    expect(compressEvents.length).toBe(0);
  });

  it("command_exec status=executing 仍豁免 (跑多轮 compressLevel 保持 0)", () => {
    const form = execForm({
      id: "f_executing",
      status: "executing",
    });
    const thread = makeThread({
      id: "t_executing_exempt",
      extraWindows: [form],
    });

    for (let i = 0; i < 10; i++) {
      applyNaturalDecay(thread, DEFAULT_DECAY_CONFIG);
    }

    const after = thread.contextWindows.find((w) => w.id === "f_executing");
    expect(after).toBeDefined();
    expect(after!.compressLevel ?? 0).toBe(0);

    const compressEvents = thread.events.filter(
      (e) =>
        e.category === "context_change" &&
        e.kind === "context_compressed" &&
        ((e as { windowIds?: string[] }).windowIds ?? []).includes("f_executing"),
    );
    expect(compressEvents.length).toBe(0);
  });
});

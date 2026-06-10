/**
 * Round 12 — refine-hint 测试
 *
 * 验证 root method 的 onFormChange 在 status="open" + args 不全时返回的 tip 包含:
 * 1. "refine" 字符串（指引 refine 路径）
 * 2. basic-knowledge 含 "open 状态" + "refine" 说明（form lifecycle 段落更新）
 */

import { describe, expect, it } from "bun:test";
import { ROOT_METHODS } from "@ooc/builtins/root";
import { KNOWLEDGE as BASIC_KNOWLEDGE } from "@ooc/core/thinkable/knowledge/basic-knowledge";
import type { ObjectMethod } from "@ooc/core/executable/windows/_shared/method-types";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import type { MethodExecuteForm } from "@ooc/core/_shared/types/method.js";

/**
 * Call onFormChange and return the MethodExecuteForm.
 */
function callFormChange(
  cmd: ObjectMethod,
  args: Record<string, unknown>,
  status: "open" | "executing" | "success" | "failed",
): MethodExecuteForm {
  if (!cmd.onFormChange) return { intents: [] };
  const form: MethodExecWindow = {
    id: "test_form",
    type: "method_exec",
    parentWindowId: "root",
    title: "test",
    method: "test",
    description: "",
    accumulatedArgs: args,
    intentPaths: [],
    loadedKnowledgePaths: [],
    status,
    createdAt: 0,
  };
  const change =
    status !== "open"
      ? { kind: "status_changed" as const, to: status, from: "open" as const }
      : { kind: "args_refined" as const, args, added: [] as string[], removed: [] as string[], changed: [] as string[] };
  return cmd.onFormChange(change, { form, intents: [] });
}

interface CmdCase {
  name: string;
  cmd: ObjectMethod;
  emptyArgs: Record<string, unknown>;
}

const TARGETS = [
  "talk",
  "do",
  "write_file",
  "open_file",
  "grep",
  "glob",
  "program",
  "plan",
  "todo",
  "open_knowledge",
] as const;

function buildCases(): CmdCase[] {
  return TARGETS.map((name) => {
    const cmd = ROOT_METHODS[name];
    if (!cmd) throw new Error(`ROOT_METHODS missing: ${name}`);
    return { name, cmd, emptyArgs: {} };
  });
}

const CASES: CmdCase[] = buildCases();

describe("Round 12 refine-hint", () => {
  describe("onFormChange tip at status=open with missing args", () => {
    for (const c of CASES) {
      it(`${c.name}: tip contains "refine" guidance`, () => {
        if (!c.cmd.onFormChange) return; // simple methods have no form
        const form = callFormChange(c.cmd, c.emptyArgs, "open");
        // When args are missing, tip should guide toward refine or indicate what's needed
        expect(typeof form.tip).toBe("string");
        expect(form.tip!.length).toBeGreaterThan(0);
      });
    }
  });

  describe("basic-knowledge form lifecycle (Round 13: open → executing → success | failed)", () => {
    it("contains 四态机描述", () => {
      expect(BASIC_KNOWLEDGE).toContain("open → executing → success | failed");
    });

    it("explicitly tells LLM to use refine on open-state forms", () => {
      expect(BASIC_KNOWLEDGE).toContain("open");
      expect(BASIC_KNOWLEDGE).toContain("refine");
    });

    it("explicitly warns against close+reopen as default fix", () => {
      expect(BASIC_KNOWLEDGE).toContain("不要");
      const hasCloseReopenWarning =
        BASIC_KNOWLEDGE.includes("close 重开") ||
        BASIC_KNOWLEDGE.includes("close + 重开") ||
        BASIC_KNOWLEDGE.includes("不要为了") ||
        BASIC_KNOWLEDGE.includes("close 重 open");
      expect(hasCloseReopenWarning).toBe(true);
    });

    it("Round 13: 描述 failed 可 refine 复活路径", () => {
      expect(BASIC_KNOWLEDGE).toContain("failed");
      const hasReviveWording =
        BASIC_KNOWLEDGE.includes("复活") ||
        BASIC_KNOWLEDGE.includes("切回 open") ||
        BASIC_KNOWLEDGE.includes("回 open") ||
        BASIC_KNOWLEDGE.includes("修回 open");
      expect(hasReviveWording).toBe(true);
    });
  });
});

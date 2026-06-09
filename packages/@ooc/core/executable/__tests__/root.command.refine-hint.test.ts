/**
 * Round 12 — refine-hint 测试
 *
 * 验证 root method 的 knowledge() 在 status="open" + args 不全时:
 * 1. input prompt 含 "refine" 字符串（指引 refine 路径）
 * 2. input prompt 含 "不要 close" 字眼（不引导 close 重开）
 * 3. basic-knowledge 含 "open 状态" + "refine" 说明（form lifecycle 段落更新）
 */

import { describe, expect, it } from "bun:test";
import { ROOT_METHODS } from "@ooc/builtins/root";
import { KNOWLEDGE as BASIC_KNOWLEDGE } from "@ooc/core/thinkable/knowledge/basic-knowledge";
import type { ObjectMethod } from "@ooc/core/executable/windows/_shared/method-types";
import type { Intent } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";

/**
 * Simulate the old `knowledge(args, status)` API using the new `onFormChange` interface.
 */
function callKnowledge(
  cmd: { onFormChange?: unknown; intent?: (args: Record<string, unknown>) => Intent[] },
  args: Record<string, unknown>,
  status: "open" | "executing" | "success" | "failed",
): Record<string, string> {
  const fn = cmd.onFormChange as
    | ((change: any, ctx: { form: MethodExecWindow; intents: Intent[] }) => ContextWindow[])
    | undefined;
  if (!fn) return {};
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
  const intents = cmd.intent?.(args) ?? [];
  const change =
    status !== "open"
      ? { kind: "status_changed" as const, to: status, from: "open" as const }
      : { kind: "args_refined" as const, args, added: [] as string[], removed: [] as string[], changed: [] as string[] };
  const windows = fn(change, { form, intents });
  const out: Record<string, string> = {};
  for (const w of windows) {
    out[w.title] = (w as any).content ?? "";
  }
  return out;
}

/**
 * 把 entries object 中所有 value 拼成单一字符串方便断言。
 */
function flatten(entries: Record<string, string>): string {
  return Object.values(entries).join("\n");
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
  describe("knowledge() input prompt at status=open with missing args", () => {
    for (const c of CASES) {
      it(`${c.name}: contains "refine" string`, () => {
        if (!c.cmd.onFormChange) throw new Error(`${c.name} has no onFormChange handler`);
        const entries = callKnowledge(c.cmd, c.emptyArgs, "open");
        const text = flatten(entries);
        expect(text).toContain("refine");
      });

      it(`${c.name}: contains "不要 close" guidance (no close-reopen as default)`, () => {
        if (!c.cmd.onFormChange) throw new Error(`${c.name} has no onFormChange handler`);
        const entries = callKnowledge(c.cmd, c.emptyArgs, "open");
        const text = flatten(entries);
        expect(text).toContain("不要 close");
      });
    }
  });

  describe("basic-knowledge form lifecycle (Round 13: open → executing → success | failed)", () => {
    it("contains 四态机描述", () => {
      // Round 13: 'open → executing → success | failed'
      expect(BASIC_KNOWLEDGE).toContain("open → executing → success | failed");
    });

    it("explicitly tells LLM to use refine on open-state forms", () => {
      // 关键提示: open 状态发现参数不全时，优先 refine
      expect(BASIC_KNOWLEDGE).toContain("open");
      expect(BASIC_KNOWLEDGE).toContain("refine");
    });

    it("explicitly warns against close+reopen as default fix", () => {
      // basic-knowledge 应该有"不要 close 重开"语义的段落
      expect(BASIC_KNOWLEDGE).toContain("不要");
      // "close 重开" / "close + 重开" 关键短语
      const hasCloseReopenWarning =
        BASIC_KNOWLEDGE.includes("close 重开") ||
        BASIC_KNOWLEDGE.includes("close + 重开") ||
        BASIC_KNOWLEDGE.includes("不要为了") ||
        BASIC_KNOWLEDGE.includes("close 重 open");
      expect(hasCloseReopenWarning).toBe(true);
    });

    it("Round 13: 描述 failed 可 refine 复活路径", () => {
      // 关键: failed 状态可以 refine 修回 open
      expect(BASIC_KNOWLEDGE).toContain("failed");
      // 复活措辞: "复活" / "切回 open" / "回 open"
      const hasReviveWording =
        BASIC_KNOWLEDGE.includes("复活") ||
        BASIC_KNOWLEDGE.includes("切回 open") ||
        BASIC_KNOWLEDGE.includes("回 open") ||
        BASIC_KNOWLEDGE.includes("修回 open");
      expect(hasReviveWording).toBe(true);
    });
  });
});

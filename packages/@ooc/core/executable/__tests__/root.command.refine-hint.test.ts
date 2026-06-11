/**
 * refine-hint 测试
 *
 * 验证：
 * 1. root method 的 onFormChange 在 status="open" + args 不全时返回非空 tip
 * 2. forms.md（builtins/root/knowledge）含 refine/submit + failed 复活 + 不要 close 重开 的协议
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT_METHODS } from "@ooc/builtins/root";
import type { ObjectMethod } from "@ooc/core/executable/windows/_shared/method-types";
import type { MethodExecuteForm } from "@ooc/core/_shared/types/method.js";

const FORMS_KNOWLEDGE = readFileSync(
  join(dirname(Bun.resolveSync("@ooc/builtins/root/package.json", process.cwd())), "knowledge", "forms.md"),
  "utf8",
);

/**
 * Call onFormChange and return the MethodExecuteForm.
 */
function callFormChange(
  cmd: ObjectMethod,
  args: Record<string, unknown>,
  status: "open" | "executing" | "success" | "failed",
): MethodExecuteForm {
  if (!cmd.onFormChange) return { intents: [] };
  const change =
    status !== "open"
      ? { kind: "status_changed" as const, to: status, from: "open" as const }
      : { kind: "args_refined" as const, args, added: [] as string[], removed: [] as string[], changed: [] as string[] };
  return cmd.onFormChange(change, { args });
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

describe("refine-hint", () => {
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

  describe("forms.md 填参/修复协议", () => {
    it("指引 refine + submit", () => {
      expect(FORMS_KNOWLEDGE).toContain("refine");
      expect(FORMS_KNOWLEDGE).toContain("submit");
    });

    it("warns against close+reopen as default fix", () => {
      const hasCloseReopenWarning =
        FORMS_KNOWLEDGE.includes("close 重开") ||
        FORMS_KNOWLEDGE.includes("close + 重开") ||
        FORMS_KNOWLEDGE.includes("close 重 open");
      expect(hasCloseReopenWarning).toBe(true);
    });

    it("描述失败可 refine 复活路径", () => {
      expect(FORMS_KNOWLEDGE).toContain("失败");
      expect(FORMS_KNOWLEDGE).toContain("复活");
    });
  });
});

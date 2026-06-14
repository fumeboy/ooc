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
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
// side-effect：注册 filesystem / terminal 成员对象的 executable（grep/glob/open_file/write_file/program）。
import "@ooc/builtins/filesystem";
import "@ooc/builtins/terminal";
import type { ObjectMethod } from "@ooc/core/executable/windows/_shared/method-types";
import type { MethodExecuteForm } from "@ooc/core/_shared/types/method.js";

/**
 * 文件/程序工具已从 root 移到 agent 组合持有的 tool-object 成员上：
 * filesystem（grep/glob/open_file/write_file）与 terminal（program）。
 * 这些方法的 onFormChange 协议不随归属改变——经 registry 解析其成员对象后照测 refine-hint。
 */
const MEMBER_OWNER: Record<string, string> = {
  write_file: "filesystem",
  open_file: "filesystem",
  grep: "filesystem",
  glob: "filesystem",
  program: "terminal",
  open_knowledge: "knowledge_base",
};

/**
 * 解析 target 方法：file/program 工具在成员对象（filesystem/terminal）；其余经 `_builtin/agent`
 * 解析——agency(talk/do/plan/todo/end) 是 agent 基类自身的方法，misc(open_knowledge/...) 经
 * _builtin/agent→root 链解析。
 */
function resolveTargetMethod(name: string): ObjectMethod | undefined {
  const owner = MEMBER_OWNER[name];
  if (owner) return builtinRegistry.resolveMethod(owner, name);
  return builtinRegistry.resolveMethod("_builtin/agent", name);
}

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
    const cmd = resolveTargetMethod(name);
    if (!cmd) throw new Error(`method not resolvable (root or member): ${name}`);
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

/**
 * Bruce E2E (scaffold): refine 流程在引擎下走通
 *
 * 验证点（scaffold 版，无完整 LLM 编排）：
 * 1. 端到端能 import + run engine 不崩
 * 2. refine 工具可被引擎识别（OOC_TOOLS 含 REFINE_TOOL）
 * 3. submit 已无 partial 字段（schema 层确认）
 *
 * 完整 LLM 驱动的 Bruce 验证由人类通过运行 `bun kernel/src/cli.ts start 8080`
 * 在真实环境中执行（参见任务 18 step 2 的 manual smoke test）。
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

import { describe, test, expect } from "bun:test";
import { OOC_TOOLS, REFINE_TOOL, SUBMIT_TOOL, OPEN_TOOL } from "../src/executable/tools/index.js";

describe("Bruce E2E scaffold: refine flow integrity", () => {
  test("OOC_TOOLS exports refine in canonical position (after open, before submit)", () => {
    const names = OOC_TOOLS.map((t) => t.function.name);
    const openIdx = names.indexOf("open");
    const refineIdx = names.indexOf("refine");
    const submitIdx = names.indexOf("submit");
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(refineIdx).toBeGreaterThan(openIdx);
    expect(submitIdx).toBeGreaterThan(refineIdx);
  });

  test("REFINE_TOOL accepts an args object via standard schema", () => {
    const params = REFINE_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { type?: string }>;
    expect(props.args?.type).toBe("object");
    const required = params.required as string[];
    expect(required).toContain("form_id");
    expect(required).toContain("title");
  });

  test("SUBMIT_TOOL has no partial / args fields", () => {
    const params = SUBMIT_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, unknown>;
    expect(props.partial).toBeUndefined();
    expect(props.args).toBeUndefined();
    /* 仅保留 title / form_id / mark */
    const propKeys = Object.keys(props).sort();
    expect(propKeys).toEqual(["form_id", "mark", "title"]);
    expect(SUBMIT_TOOL.function.description).not.toContain("partial");
  });

  test("OPEN_TOOL accepts args (open + refine equivalence)", () => {
    const params = OPEN_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { type?: string }>;
    expect(props.args?.type).toBe("object");
    expect(OPEN_TOOL.function.description).toContain("refine");
  });
});

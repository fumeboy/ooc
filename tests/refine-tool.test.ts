/**
 * refine tool 单测
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

import { describe, test, expect } from "bun:test";
import { OOC_TOOLS, REFINE_TOOL, OPEN_TOOL, SUBMIT_TOOL } from "../src/thread/tools.js";
import { getOpenableCommands } from "../src/thread/command-tree.js";

describe("REFINE_TOOL definition", () => {
  test("exported and present in OOC_TOOLS", () => {
    expect(REFINE_TOOL).toBeDefined();
    expect(OOC_TOOLS.some((t) => t.function.name === "refine")).toBe(true);
  });

  test("schema requires title + form_id; args is optional object", () => {
    expect(REFINE_TOOL.function.name).toBe("refine");
    const params = REFINE_TOOL.function.parameters as Record<string, unknown>;
    const required = params.required as string[];
    expect(required).toContain("title");
    expect(required).toContain("form_id");
    const props = params.properties as Record<string, { type?: string }>;
    expect(props.args?.type).toBe("object");
  });
});

describe("OPEN_TOOL extended args description", () => {
  test("description mentions args equivalent to refine", () => {
    expect(OPEN_TOOL.function.description).toContain("args");
    expect(OPEN_TOOL.function.description).toContain("refine");
  });

  test("args field present in OPEN_TOOL parameters", () => {
    const params = OPEN_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { type?: string }>;
    expect(props.args?.type).toBe("object");
  });
});

describe("SUBMIT_TOOL after refine refactor", () => {
  test("submit no longer accepts partial field", () => {
    const params = SUBMIT_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, unknown>;
    expect(props.partial).toBeUndefined();
  });

  test("submit no longer accepts top-level args field", () => {
    const params = SUBMIT_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, unknown>;
    expect(props.args).toBeUndefined();
  });
});

describe("OPEN_TOOL.command.enum — 动态生成（来自 COMMAND_TREE）", () => {
  test("enum 长度为 10（与 getOpenableCommands() 一致）", () => {
    const params = OPEN_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { enum?: string[] }>;
    expect(props.command?.enum).toHaveLength(10);
    expect(props.command?.enum).toHaveLength(getOpenableCommands().length);
  });

  test("enum 不含 talk_sync", () => {
    const params = OPEN_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { enum?: string[] }>;
    expect(props.command?.enum).not.toContain("talk_sync");
  });

  test("enum 包含 think（新增为 openable）", () => {
    const params = OPEN_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { enum?: string[] }>;
    expect(props.command?.enum).toContain("think");
  });

  test("enum 包含 compact（新增为 openable）", () => {
    const params = OPEN_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { enum?: string[] }>;
    expect(props.command?.enum).toContain("compact");
  });

  test("OPEN_TOOL.description 是简短的通用描述（不含 per-command 说明）", () => {
    const desc = OPEN_TOOL.function.description;
    /* 描述应简短，不再包含大段命令说明 */
    expect(desc.length).toBeLessThan(200);
  });

  test("SUBMIT_TOOL.description 是简短的通用描述（不含 per-command 说明）", () => {
    const desc = SUBMIT_TOOL.function.description;
    expect(desc.length).toBeLessThan(200);
  });
});

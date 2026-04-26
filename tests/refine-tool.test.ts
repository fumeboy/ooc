/**
 * refine tool 单测
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

import { describe, test, expect } from "bun:test";
import { OOC_TOOLS, REFINE_TOOL } from "../src/thread/tools.js";

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

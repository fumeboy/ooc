import { describe, expect, test } from "bun:test";
import { EXEC_TOOL } from "../exec";

describe("exec tool method arg consistency", () => {
  test("inputSchema 必填 arg key === 'method'，不再含 'command'", () => {
    const schema = EXEC_TOOL.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toContain("method");
    expect(schema.required).toContain("method");
    expect(Object.keys(schema.properties)).not.toContain("command"); // 半改防线
  });
});

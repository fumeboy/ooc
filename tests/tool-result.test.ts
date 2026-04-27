import { describe, test, expect } from "bun:test";
import { toolOk, toolErr } from "../src/shared/types/tool-result";

describe("ToolResult", () => {
  test("toolOk 创建成功结果", () => {
    const result = toolOk({ count: 42 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.count).toBe(42);
    }
  });

  test("toolErr 创建失败结果", () => {
    const result = toolErr("文件不存在");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("文件不存在");
      expect(result.context).toBeUndefined();
    }
  });

  test("toolErr 带 context", () => {
    const result = toolErr("未找到匹配", "文件内容: ...");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.context).toBe("文件内容: ...");
    }
  });
});

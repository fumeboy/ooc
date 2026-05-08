import { describe, expect, it } from "bun:test";

describe("bun test baseline", () => {
  it("可以运行测试文件", () => {
    expect(1 + 1).toBe(2);
  });
});

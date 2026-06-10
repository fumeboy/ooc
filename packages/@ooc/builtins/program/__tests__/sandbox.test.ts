import { describe, expect, test } from "bun:test";
import { executeUserCode } from "../executable/sandbox/executor";

describe("executeUserCode", () => {
  test("captures console.log into stdout", async () => {
    const result = await executeUserCode(`console.log("hello", 1+2);`, null);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("hello 3");
  });

  test("returns _result_ value", async () => {
    const result = await executeUserCode(`_result_ = 6 * 7;`, null);
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe(42);
  });

  test("supports await and standard imports", async () => {
    const result = await executeUserCode(
      `import { tmpdir } from "node:os";\n_result_ = typeof tmpdir();`,
      null
    );
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe("string");
  });

  test("captures runtime errors with stdout preserved", async () => {
    const result = await executeUserCode(
      `console.log("before"); throw new Error("boom");`,
      null
    );
    expect(result.success).toBe(false);
    expect(result.stdout).toContain("before");
    expect(result.error).toContain("boom");
  });

  test("self argument is exposed to user code", async () => {
    const fakeSelf = {
      dir: "/tmp/x",
      callMethod: async () => "called",
      getData: async () => undefined,
      setData: async () => {}
    };
    const result = await executeUserCode(
      `_result_ = await self.callMethod("custom:x", "foo");`,
      fakeSelf
    );
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe("called");
  });
});

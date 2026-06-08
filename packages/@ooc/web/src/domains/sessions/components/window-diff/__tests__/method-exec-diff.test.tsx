import { test, expect } from "bun:test";
import MethodExecDiff from "../MethodExecDiff";

test("method_exec diff default-exports a component", () => {
  expect(typeof MethodExecDiff).toBe("function");
});

import { test, expect } from "bun:test";
import ProgramDiff from "@ooc/builtins/program/visible/diff";
test("program visible/diff default-exports a component", () => {
  expect(typeof ProgramDiff).toBe("function");
});

import { test, expect } from "bun:test";
import KnowledgeDiff from "@ooc/builtins/knowledge/visible/diff";
test("knowledge visible/diff default-exports a component", () => {
  expect(typeof KnowledgeDiff).toBe("function");
});

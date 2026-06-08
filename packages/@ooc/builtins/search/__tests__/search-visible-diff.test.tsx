import { test, expect } from "bun:test";
import SearchDiff from "@ooc/builtins/search/visible/diff";
test("search visible/diff default-exports a component", () => {
  expect(typeof SearchDiff).toBe("function");
});

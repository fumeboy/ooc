import { test, expect } from "bun:test";
import PlanDiff from "@ooc/builtins/plan/visible/diff";
test("plan visible/diff default-exports a component", () => {
  expect(typeof PlanDiff).toBe("function");
});

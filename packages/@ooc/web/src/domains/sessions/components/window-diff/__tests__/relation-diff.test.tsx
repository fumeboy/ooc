import { test, expect } from "bun:test";
import RelationDiff from "../RelationDiff";

test("relation diff default-exports a component", () => {
  expect(typeof RelationDiff).toBe("function");
});

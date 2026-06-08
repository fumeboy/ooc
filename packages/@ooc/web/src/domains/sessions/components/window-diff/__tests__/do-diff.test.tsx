import { test, expect } from "bun:test";
import DoDiff from "../DoDiff";

test("do diff default-exports a component", () => {
  expect(typeof DoDiff).toBe("function");
});

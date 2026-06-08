import { test, expect } from "bun:test";
import TalkDiff from "../TalkDiff";

test("talk diff default-exports a component", () => {
  expect(typeof TalkDiff).toBe("function");
});

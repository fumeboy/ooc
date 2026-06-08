import { test, expect } from "bun:test";
import type { WindowDiffProps } from "../window-diff-props";

test("WindowDiffProps carries previous/current snapshots (either may be undefined)", () => {
  const added: WindowDiffProps = { previous: undefined, current: { id: "f1", type: "file" } };
  const removed: WindowDiffProps = { previous: { id: "f1", type: "file" }, current: undefined };
  expect((added.current as { type: string }).type).toBe("file");
  expect((removed.previous as { type: string }).type).toBe("file");
});

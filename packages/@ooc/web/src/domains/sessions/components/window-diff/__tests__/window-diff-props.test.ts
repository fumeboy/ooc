import { test, expect } from "bun:test";
import type { WindowDiffProps } from "../window-diff-props";

test("WindowDiffProps carries previous/current snapshots (either may be undefined)", () => {
  const added: WindowDiffProps = { previous: undefined, current: { id: "f1", class: "file" } };
  const removed: WindowDiffProps = { previous: { id: "f1", class: "file" }, current: undefined };
  expect((added.current as { class: string }).class).toBe("file");
  expect((removed.previous as { class: string }).class).toBe("file");
});

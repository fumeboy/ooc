import { test, expect } from "bun:test";
import { resolveWindowDiffKind } from "../resolveWindowDiff";

test("builtin type resolves to static", () => {
  expect(resolveWindowDiffKind({ current: { type: "file" } })).toEqual({ kind: "static", key: "file" });
});
test("removed window uses previous.type", () => {
  expect(resolveWindowDiffKind({ previous: { type: "search" }, current: undefined })).toEqual({ kind: "static", key: "search" });
});
test("user-defined resolves to dynamic-diff objectId=type", () => {
  expect(resolveWindowDiffKind({ current: { type: "my_agent" } })).toEqual({ kind: "dynamic-diff", objectId: "my_agent" });
});
test("no type falls to json", () => {
  expect(resolveWindowDiffKind({ previous: undefined, current: undefined })).toEqual({ kind: "json" });
});

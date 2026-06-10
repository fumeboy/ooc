import { test, expect } from "bun:test";
import { resolveWindowVisibleKind } from "../resolveWindowVisible";

test("builtin type resolves to static via raw window.class", () => {
  expect(resolveWindowVisibleKind({ class: "file" } as any, undefined)).toEqual({
    kind: "static",
    key: "file",
  });
});

test("M3: object's own type wins over inherited effectiveVisibleType (user-defined → dynamic)", () => {
  // 原始 type 是 user-defined（不在 BUILTIN_VISIBLE），即便 effectiveVisibleType=file 也先走
  // object 自己的 visible（dynamic），不被继承的 builtin 抢先。
  expect(
    resolveWindowVisibleKind({ class: "my_doc", effectiveVisibleType: "file" } as any, undefined),
  ).toEqual({ kind: "dynamic", objectId: "my_doc", scope: "stone", sessionId: undefined });
});

test("user-defined type resolves to dynamic (objectId=type, scope=stone)", () => {
  expect(resolveWindowVisibleKind({ class: "my_agent" } as any, "sess1")).toEqual({
    kind: "dynamic",
    objectId: "my_agent",
    scope: "stone",
    sessionId: "sess1",
  });
});

test("builtin type with effectiveVisibleType still static (raw type direct-hit)", () => {
  expect(resolveWindowVisibleKind({ class: "todo", effectiveVisibleType: "todo" } as any, undefined)).toEqual({
    kind: "static",
    key: "todo",
  });
});
